import { type RoomAction, type RoomEvent, type RoomRequest } from './room-protocol'

type Entry = Extract<RoomRequest, { type: 'create' | 'join' }>
type Status = 'connecting' | 'connected' | 'disconnected'
const endpoint = import.meta.env.VITE_TAVLI_WS_URL ||
  (import.meta.env.DEV ? new URL('/rooms', location.href).href.replace(/^http/, 'ws') : '')

export const roomsAvailable = Boolean(endpoint)

function seatToken(code: string, token?: string) {
  try {
    const key = `tavli.room.${code}`
    if (token) localStorage.setItem(key, token)
    return localStorage.getItem(key) ?? undefined
  } catch {
    return token
  }
}

export function joinRequest(code: string): Entry {
  return { type: 'join', code, token: seatToken(code) }
}

export class RoomClient {
  private socket?: WebSocket
  private retry?: number
  private timer?: number
  private stopped = false
  private delay = 500

  constructor(
    private entry: Entry,
    private readonly onEvent: (event: RoomEvent) => void,
    private readonly onStatus: (status: Status) => void,
  ) {}

  connect() {
    if (!endpoint) {
      this.onEvent({ type: 'error', message: 'Η online λειτουργία δεν έχει ρυθμιστεί σε αυτή τη διεύθυνση.', fatal: true })
      return
    }
    this.onStatus('connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(endpoint)
    } catch {
      this.onEvent({ type: 'error', message: 'Η διεύθυνση του online διακομιστή δεν είναι έγκυρη.', fatal: true })
      return
    }

    this.socket = socket
    this.timer = window.setTimeout(() => socket.close(), 8000)
    socket.addEventListener('open', () => this.send(this.entry))
    socket.addEventListener('message', ({ data }) => {
      if (this.stopped || this.socket !== socket) return
      const event = JSON.parse(data) as RoomEvent
      if (event.type === 'joined') {
        window.clearTimeout(this.timer)
        seatToken(event.code, event.token)
        this.entry = { type: 'join', code: event.code, token: event.token }
        this.delay = 500
        this.onStatus('connected')
      }
      if (event.type === 'error' && event.fatal) this.close()
      this.onEvent(event)
    })
    socket.addEventListener('close', ({ code }) => {
      if (this.stopped || this.socket !== socket) return
      window.clearTimeout(this.timer)
      this.onStatus('disconnected')
      if (code === 4001 || this.entry.type === 'create' || !this.entry.token) {
        const message = code === 4001 ? 'Η θέση σου άνοιξε σε άλλη καρτέλα.' : 'Δεν ήταν δυνατή η σύνδεση με το δωμάτιο.'
        this.onEvent({ type: 'error', message, fatal: true })
        return
      }
      this.retry = window.setTimeout(() => this.connect(), this.delay)
      this.delay = Math.min(this.delay * 2, 5000)
    })
  }

  play(revision: number, action: RoomAction) {
    return this.send({ type: 'play', revision, action })
  }

  close() {
    this.stopped = true
    window.clearTimeout(this.retry)
    window.clearTimeout(this.timer)
    this.socket?.close()
  }

  private send(request: RoomRequest) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(request))
    return true
  }
}
