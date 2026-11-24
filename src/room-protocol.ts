import type { Game, Mode } from './game'
import type { Move, Player } from './model'

export const roomCodePattern = /^[A-HJ-NP-Z2-9]{6}$/

export type RoomAction = { type: 'roll' | 'next' } | { type: 'move'; move: Move }

export type RoomRequest =
  | { type: 'create'; mode: Mode; target: number }
  | { type: 'join'; code: string; token?: string }
  | { type: 'play'; revision: number; action: RoomAction }

export type RoomEvent =
  | { type: 'joined'; code: string; token: string; player: Player }
  | { type: 'state'; game: Game; revision: number; ready: boolean; connected: Record<Player, boolean> }
  | { type: 'error'; message: string; fatal: boolean }
