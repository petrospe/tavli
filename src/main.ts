import './style.css'
import { computerMove } from './computer'
import { matchWinner, newGame, reduce, type Action, type Mode } from './game'
import { joinRequest, RoomClient, roomsAvailable } from './room-client'
import { roomCodePattern, type RoomAction, type RoomRequest } from './room-protocol'
import { type Move, type Player, type Variant } from './model'

const variantNames: Record<Variant, string> = { portes: 'Πόρτες', plakoto: 'Πλακωτό', fevga: 'Φεύγα' }
const playerNames: Record<Player, string> = { ivory: 'Λευκά', red: 'Κόκκινα' }
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const board = byId('board')
const playerSetting = byId<HTMLSelectElement>('players')
const mode = byId<HTMLSelectElement>('mode')
const target = byId<HTMLSelectElement>('target')
const bar = byId<HTMLButtonElement>('bar')
const off = byId('off')
const roll = byId<HTMLButtonElement>('roll')
const diceDisplay = byId('dice')

let game = newGame('portes')
let singlePlayer = false
let computerTimer: number | undefined
let selected: Move['from'] | undefined
let roomClient: RoomClient | undefined
let roomSeat: { code: string; player: Player } | undefined
let roomRevision = 0
let roomReady = false
let roomConnected = false
let opponentConnected = false
let roomPending = false
let roomMessage = ''

const settings = byId<HTMLFormElement>('settings')
const startGame = byId<HTMLButtonElement>('start-game')
const roomCode = byId<HTMLInputElement>('room-code')
const inviteUrl = byId<HTMLInputElement>('invite-url')

const pointButtons = new Map<number, HTMLButtonElement>()
const rows = [
  [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

for (const [row, indices] of rows.entries()) {
  for (const [column, index] of indices.entries()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `point ${row ? 'bottom' : 'top'} ${column % 2 === row ? 'light' : 'dark'}`
    button.style.gridColumn = String(column + (column < 6 ? 1 : 2))
    button.style.gridRow = String(row + 1)
    button.addEventListener('click', () => choosePoint(index))
    board.append(button)
    pointButtons.set(index, button)
  }
}

function computerTurn() {
  return singlePlayer && game.player === 'red' &&
    (game.phase.kind === 'roll' || game.phase.kind === 'move')
}

function refresh() {
  window.clearTimeout(computerTimer)
  render()
  if (!computerTurn()) return

  computerTimer = window.setTimeout(() => {
    if (!computerTurn()) return
    if (game.phase.kind === 'roll') {
      dispatch({ type: 'roll', dice: [throwDie(), throwDie()] })
    } else {
      const move = computerMove(game)
      if (move) dispatch({ type: 'move', move })
    }
  }, 450)
}

function dispatch(action: Action) {
  game = reduce(game, action)
  selected = undefined
  refresh()
}

function roomAllows(action: RoomAction['type']) {
  if (!roomSeat || !roomConnected || !opponentConnected || roomPending) return false
  const { phase, player } = game
  if (action === 'next') return phase.kind === 'finished' && game.mode === 'match' && !matchWinner(game)
  if (action === 'roll' && phase.kind === 'opening') return true
  return player === roomSeat.player && phase.kind === action
}

function playOnline(action: RoomAction) {
  if (!roomAllows(action.type)) return
  if (roomClient?.play(roomRevision, action)) {
    roomPending = true
    roomMessage = ''
    selected = undefined
    render()
  }
}

function currentMoves() {
  if (roomClient && !roomAllows('move')) return []
  return !computerTurn() && game.phase.kind === 'move' ? game.phase.moves : []
}

function choosePoint(index: number) {
  const moves = currentMoves()
  const targetMove = moves.find(move => move.from === selected && move.to === index)
  if (targetMove) playMove(targetMove)
  else if (moves.some(move => move.from === index)) {
    selected = selected === index ? undefined : index
    render()
  }
}

function playMove(move: Move) {
  if (roomClient) playOnline({ type: 'move', move })
  else dispatch({ type: 'move', move })
}

function throwDie() {
  return Math.floor(Math.random() * 6) + 1
}

roll.addEventListener('click', () => {
  if (roomClient) {
    playOnline({ type: game.phase.kind === 'finished' ? 'next' : 'roll' })
    return
  }
  if (computerTurn() || game.phase.kind === 'move') return
  if (game.phase.kind === 'finished') {
    if (game.mode === 'match' && !matchWinner(game)) dispatch({ type: 'next' })
    else settings.requestSubmit()
  } else dispatch({ type: 'roll', dice: [throwDie(), throwDie()] })
})

bar.addEventListener('click', () => {
  if (!currentMoves().some(move => move.from === 'bar')) return
  selected = selected === 'bar' ? undefined : 'bar'
  render()
})

function updateRoomUrl(code?: string) {
  const url = new URL(location.href)
  if (code) url.searchParams.set('room', code)
  else url.searchParams.delete('room')
  history.replaceState(null, '', url)
}

function closeRoom() {
  roomClient?.close()
  roomClient = undefined
  roomSeat = undefined
  roomReady = false
  roomConnected = false
  opponentConnected = false
  roomPending = false
  selected = undefined
}

function openRoom(entry: Extract<RoomRequest, { type: 'create' | 'join' }>) {
  closeRoom()
  singlePlayer = false
  window.clearTimeout(computerTimer)
  roomMessage = ''
  inviteUrl.hidden = true
  roomClient = new RoomClient(entry, event => {
    switch (event.type) {
      case 'joined':
        roomSeat = { code: event.code, player: event.player }
        roomCode.value = event.code
        updateRoomUrl(event.code)
        return
      case 'state':
        game = event.game
        roomRevision = event.revision
        roomReady = event.ready
        opponentConnected = event.connected[roomSeat?.player === 'ivory' ? 'red' : 'ivory']
        roomPending = false
        roomMessage = ''
        selected = undefined
        break
      case 'error':
        if (event.fatal) {
          closeRoom()
          game = newGame(mode.value as Mode, Number(target.value))
        }
        roomPending = false
        roomMessage = event.message
        break
    }
    render()
  }, status => {
    roomConnected = status === 'connected'
    if (!roomConnected) {
      opponentConnected = false
      roomPending = false
      roomMessage = roomSeat ? 'Επανασύνδεση…' : 'Σύνδεση…'
    }
    render()
  })
  roomClient.connect()
}

mode.addEventListener('change', () => { byId('target-label').hidden = mode.value !== 'match' })
playerSetting.addEventListener('change', render)
settings.addEventListener('submit', event => {
  event.preventDefault()
  if (roomClient) return
  if (playerSetting.value === 'online') {
    openRoom({ type: 'create', mode: mode.value as Mode, target: Number(target.value) })
    return
  }
  roomMessage = ''
  updateRoomUrl()
  game = newGame(mode.value as Mode, Number(target.value))
  singlePlayer = playerSetting.value === 'one'
  selected = undefined
  refresh()
})

byId<HTMLFormElement>('join-room').addEventListener('submit', event => {
  event.preventDefault()
  if (roomClient) return
  const code = roomCode.value.trim().toUpperCase()
  if (roomCodePattern.test(code)) openRoom(joinRequest(code))
  else {
    roomMessage = 'Πληκτρολόγησε τον κωδικό των 6 χαρακτήρων.'
    render()
  }
})

byId('invite').addEventListener('click', async () => {
  if (!roomSeat) return
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('room', roomSeat.code)
  inviteUrl.value = url.href
  inviteUrl.hidden = false
  inviteUrl.select()
  try {
    await navigator.clipboard.writeText(url.href)
    if (inviteUrl.value === url.href && roomSeat?.code === url.searchParams.get('room')) {
      byId('room-status').textContent = 'Η πρόσκληση αντιγράφηκε.'
    }
  } catch {
    inviteUrl.focus()
    inviteUrl.select()
  }
})

byId('leave-room').addEventListener('click', () => {
  closeRoom()
  updateRoomUrl()
  game = newGame(mode.value as Mode, Number(target.value))
  roomMessage = ''
  render()
})

function renderRoom() {
  const online = playerSetting.value === 'online' || Boolean(roomClient)
  byId('online').hidden = !online
  byId('join-room').hidden = Boolean(roomClient)
  byId('room-info').hidden = !roomSeat
  startGame.disabled = Boolean(roomClient) || (online && !roomsAvailable)
  roomCode.disabled = !roomsAvailable
  startGame.textContent = online ? 'Δημιουργία δωματίου' : 'Νέο παιχνίδι'
  byId('room-id').textContent = roomSeat?.code ?? ''
  byId('room-seat').textContent = roomSeat ? `Παίζεις με τα ${playerNames[roomSeat.player].toLowerCase()}` : ''
  byId('room-status').textContent = roomMessage ||
    (!roomsAvailable ? 'Η online λειτουργία δεν έχει ρυθμιστεί σε αυτή τη διεύθυνση.' :
      roomSeat && !opponentConnected ? roomReady ? 'Ο άλλος παίκτης αποσυνδέθηκε.' : 'Περιμένεις τον δεύτερο παίκτη.' : '')
}

function render() {
  renderRoom()
  const { position, player, phase } = game
  const moves = currentMoves()
  byId('variant').textContent = variantNames[game.variant]
  byId('ivory-score').textContent = String(game.score.ivory)
  byId('red-name').textContent = singlePlayer ? 'Υπολογιστής' : 'Κόκκινα'
  byId('red-score').textContent = String(game.score.red)
  for (const [index, button] of pointButtons) {
    const stack = position.board[index]
    const source = moves.some(move => move.from === index)
    const destination = moves.some(move => move.from === selected && move.to === index)
    button.classList.toggle('source', source)
    button.classList.toggle('destination', destination)
    button.setAttribute('aria-pressed', String(selected === index))
    button.setAttribute('aria-disabled', String(!source && !destination))
    const ivory = stack.filter(checker => checker === 'ivory').length
    const red = stack.length - ivory
    button.setAttribute('aria-label', `Θέση ${index + 1}. ${ivory} λευκά, ${red} κόκκινα${destination ? '. Δυνατή κίνηση' : ''}`)
    const pile = document.createElement('span')
    pile.className = 'pile'
    pile.setAttribute('aria-hidden', 'true')
    const shown = stack.length > 5 ? [...stack.slice(0, 4), stack[stack.length - 1]] : stack
    shown.forEach((checker, offset) => {
      const piece = document.createElement('span')
      piece.className = `token ${checker}`
      if (offset === 4 && stack.length > 5) piece.textContent = String(stack.length)
      pile.append(piece)
    })
    button.replaceChildren(pile)
  }

  bar.hidden = game.variant !== 'portes'
  bar.disabled = !moves.some(move => move.from === 'bar')
  bar.setAttribute('aria-pressed', String(selected === 'bar'))
  bar.textContent = `Μπάρα ${position.bar.ivory}–${position.bar.red}`
  off.replaceChildren()
  const offMoves = moves.filter(move => move.from === selected && move.to === 'off')
  const offLabel = `Μάζεμα ${position.off.ivory}–${position.off.red}`
  for (const move of offMoves.length ? offMoves : [undefined]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary'
    button.disabled = !move
    button.textContent = move && offMoves.length > 1 ? `Μάζεμα με ${move.die}` : offLabel
    if (move) button.addEventListener('click', () => playMove(move))
    off.append(button)
  }
  const onlineAction = phase.kind === 'finished' ? 'next' : 'roll'
  roll.setAttribute('aria-disabled', String(roomClient
    ? !roomAllows(onlineAction)
    : computerTurn() || phase.kind === 'move'))
  roll.hidden = Boolean(roomClient && phase.kind === 'finished' &&
    (game.mode !== 'match' || matchWinner(game)))

  const active = playerNames[player]
  const status = byId('status')
  diceDisplay.replaceChildren()
  if (phase.kind === 'opening') {
    status.textContent = phase.tie ? `Ισοπαλία (${phase.tie[0]}–${phase.tie[1]}). Ρίξτε ξανά.` : 'Ρίξτε από ένα ζάρι για τη σειρά.'
    roll.textContent = 'Ρίψη για σειρά'
  } else if (phase.kind === 'roll') {
    const prefix = phase.passed ? `${playerNames[phase.passed]} δεν έχουν κίνηση. ` :
      game.opening ? `Κλήρωση ${game.opening.join('–')} (Λευκά–Κόκκινα). ` : ''
    status.textContent = prefix + (singlePlayer
      ? computerTurn() ? 'Σειρά του υπολογιστή.' : 'Σειρά σου.'
      : `Σειρά για τα ${active}.`)
    roll.textContent = 'Ρίξε ζάρια'
  } else if (phase.kind === 'move') {
    const turn = singlePlayer
      ? computerTurn() ? 'Παίζει ο υπολογιστής.' : 'Παίζεις με τα λευκά.'
      : `Παίζουν τα ${active}.`
    status.textContent = `${turn} Ζάρια που απομένουν`
    roll.textContent = 'Ρίξε ζάρια'
    for (const die of phase.dice) {
      const chip = document.createElement('span')
      chip.className = 'die'
      chip.textContent = String(die)
      diceDisplay.append(chip)
    }
  } else {
    const { winner, points, reason } = phase.result
    const champion = matchWinner(game)
    const victory = (color: Player) => singlePlayer
      ? color === 'ivory' ? 'Κέρδισες' : 'Ο υπολογιστής κέρδισε'
      : `Τα ${playerNames[color]} κερδίζουν`
    status.textContent = champion ? `${victory(champion)} τον αγώνα.` :
      winner ? `${victory(winner)} ${points === 1 ? '1 πόντο' : '2 πόντους'}${reason === 'mother' ? ' με πλάκωμα της μάνας' : ''}.` :
      'Ισοπαλία. Πλακώθηκαν και οι δύο μάνες.'
    roll.textContent = game.mode === 'match' && !champion ? 'Επόμενη παρτίδα' : 'Παίξε ξανά'
  }
}

const inviteCode = new URLSearchParams(location.search).get('room')?.trim().toUpperCase()
if (inviteCode) {
  playerSetting.value = 'online'
  roomCode.value = inviteCode
  if (roomCodePattern.test(inviteCode)) openRoom(joinRequest(inviteCode))
  else roomMessage = 'Ο σύνδεσμος περιέχει μη έγκυρο κωδικό δωματίου.'
}
render()
