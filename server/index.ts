import { randomBytes, randomInt } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { matchWinner, newGame, reduce, type Action, type Game, type Mode } from '../src/game'
import { other, players, type Move, type Player } from '../src/model'
import { roomCodePattern, type RoomEvent } from '../src/room-protocol'

type Seat = { token: string; socket?: WebSocket }
type Room = {
  code: string
  game: Game
  revision: number
  touched: number
  seats: Partial<Record<Player, Seat>>
}

const rooms = new Map<string, Room>()
const allowedOrigins = new Set((process.env.TAVLI_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean))
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const idleLimit = 24 * 60 * 60 * 1000
const modes = new Set<Mode>(['portes', 'plakoto', 'fevga', 'match'])

const http = createServer((request, response) => {
  const health = request.url === '/health'
  response.writeHead(health ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(health ? 'OK' : 'Not found')
})
const ws = new WebSocketServer({ noServer: true, maxPayload: 4096 })

http.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin
  const local = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const permitted = origin === undefined || allowedOrigins.has(origin) || (allowedOrigins.size === 0 && local)
  if (request.url !== '/rooms' || !permitted) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  ws.handleUpgrade(request, socket, head, connection => ws.emit('connection', connection))
})

function send(socket: WebSocket, message: RoomEvent) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function publish(room: Room) {
  const connected = {
    ivory: room.seats.ivory?.socket?.readyState === WebSocket.OPEN,
    red: room.seats.red?.socket?.readyState === WebSocket.OPEN,
  }
  const message: RoomEvent = {
    type: 'state', game: room.game, revision: room.revision, ready: Boolean(room.seats.red), connected,
  }
  for (const player of players) {
    const socket = room.seats[player]?.socket
    if (socket) send(socket, message)
  }
}

function roomCode() {
  let code: string
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
  } while (rooms.has(code))
  return code
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPoint = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24

function isMove(value: unknown): value is Move {
  return isRecord(value) && (value.from === 'bar' || isPoint(value.from)) &&
    (value.to === 'off' || isPoint(value.to)) &&
    typeof value.die === 'number' && Number.isInteger(value.die) && value.die >= 1 && value.die <= 6
}

const heartbeat = new WeakSet<WebSocket>()
ws.on('connection', socket => {
  let session: { room: Room; player: Player } | undefined
  let rate = { resetAt: 0, count: 0 }
  const fail = (message: string, fatal = !session) => send(socket, { type: 'error', message, fatal })

  function attach(room: Room, player: Player) {
    const seat = room.seats[player] ?? { token: randomBytes(32).toString('base64url') }
    const previous = seat.socket
    seat.socket = socket
    room.seats[player] = seat
    room.touched = Date.now()
    session = { room, player }
    previous?.close(4001, 'Replaced')
    send(socket, { type: 'joined', code: room.code, token: seat.token, player })
    publish(room)
  }

  socket.on('pong', () => heartbeat.delete(socket))
  socket.on('error', () => socket.terminate())
  socket.on('close', () => {
    if (!session) return
    const { room, player } = session
    if (room.seats[player]?.socket !== socket) return
    room.seats[player].socket = undefined
    room.touched = Date.now()
    publish(room)
  })
  socket.on('message', (data, isBinary) => {
    const now = Date.now()
    if (rate.resetAt <= now) rate = { resetAt: now + 1000, count: 0 }
    if (++rate.count > 15 || isBinary) return socket.close(1008, 'Invalid message rate or format')

    let request: unknown
    try { request = JSON.parse(data.toString()) } catch { return fail('Μη έγκυρο αίτημα.') }
    if (!isRecord(request)) return fail('Μη έγκυρο αίτημα.')

    if (!session) {
      if (request.type === 'create') {
        const { mode, target } = request
        if (typeof mode !== 'string' || !modes.has(mode as Mode) ||
            typeof target !== 'number' || ![3, 5, 7].includes(target)) return fail('Μη έγκυροι κανόνες δωματίου.')
        if (rooms.size >= 2000) return fail('Δεν υπάρχει διαθέσιμο δωμάτιο αυτή τη στιγμή.')
        const code = roomCode()
        const room: Room = { code, game: newGame(mode as Mode, target), revision: 0, touched: now, seats: {} }
        rooms.set(code, room)
        return attach(room, 'ivory')
      }
      if (request.type !== 'join' || typeof request.code !== 'string' || !roomCodePattern.test(request.code)) {
        return fail('Μη έγκυρος κωδικός δωματίου.')
      }
      const room = rooms.get(request.code)
      if (!room) return fail('Το δωμάτιο δεν βρέθηκε ή έχει λήξει.')
      if (typeof request.token === 'string') {
        const seat = players.find(player => room.seats[player]?.token === request.token)
        if (!seat) return fail('Η θέση σου στο δωμάτιο δεν βρέθηκε.')
        return attach(room, seat)
      }
      if (room.seats.red) return fail('Το δωμάτιο είναι γεμάτο.')
      return attach(room, 'red')
    }

    const { room, player } = session
    if (room.seats[player]?.socket !== socket) return
    if (request.type !== 'play' || request.revision !== room.revision || !isRecord(request.action)) {
      return fail('Η παρτίδα έχει ενημερωθεί. Δοκίμασε ξανά.')
    }
    if (room.seats[other(player)]?.socket?.readyState !== WebSocket.OPEN) {
      return fail('Περίμενε να συνδεθεί ο άλλος παίκτης.')
    }

    const { game } = room
    const { phase } = game
    const incoming = request.action
    let action: Action
    if (incoming.type === 'roll' && (phase.kind === 'opening' || (phase.kind === 'roll' && game.player === player))) {
      action = { type: 'roll', dice: [randomInt(1, 7), randomInt(1, 7)] }
    } else if (incoming.type === 'move' && phase.kind === 'move' && game.player === player && isMove(incoming.move)) {
      action = { type: 'move', move: incoming.move }
    } else if (incoming.type === 'next' && phase.kind === 'finished' && game.mode === 'match' && !matchWinner(game)) {
      action = { type: 'next' }
    } else return fail('Η ενέργεια δεν επιτρέπεται τώρα.')

    const next = reduce(game, action)
    if (next === game) return fail('Η κίνηση δεν είναι νόμιμη.')
    room.game = next
    room.revision++
    room.touched = now
    publish(room)
  })
})

const sweep = setInterval(() => {
  for (const socket of ws.clients) {
    if (heartbeat.has(socket)) socket.terminate()
    else {
      heartbeat.add(socket)
      socket.ping()
    }
  }
  for (const [code, room] of rooms) {
    if (!players.some(player => room.seats[player]?.socket) && Date.now() - room.touched >= idleLimit) {
      rooms.delete(code)
    }
  }
}, 30_000)
sweep.unref()

const port = Number(process.env.PORT ?? 8787)
http.listen(port, '0.0.0.0', () => console.log(`Tavli rooms listening on port ${port}`))
