export const players = ['ivory', 'red'] as const
export type Player = typeof players[number]
export type Variant = 'portes' | 'plakoto' | 'fevga'
export type Dice = readonly [number, number]
export type Counts = Readonly<Record<Player, number>>

export interface Position {
  // Κάθε στοίβα διαβάζεται από τη βάση προς την κορυφή.
  readonly board: readonly (readonly Player[])[]
  readonly bar: Counts
  readonly off: Counts
  readonly released: Readonly<Record<Player, boolean>>
}

export interface Move {
  readonly from: number | 'bar'
  readonly to: number | 'off'
  readonly die: number
}

export type Result =
  | { winner: Player; points: 1 | 2; reason: 'off' | 'mother' }
  | { winner: null; points: 0; reason: 'mother' }

export interface RuleSet {
  point(player: Player, progress: number): number
  initial: readonly (readonly [Player, number, number])[]
  canLand(stack: readonly Player[], player: Player): boolean
  landing(stack: readonly Player[], player: Player): readonly Player[]
  restrictSource?(position: Position, player: Player, progress: number): boolean
  acceptPosition?(position: Position, player: Player): boolean
  forcedOpening?(position: Position, player: Player): readonly number[]
  result?(position: Position): Result | undefined
}

export const other = (player: Player): Player => player === 'ivory' ? 'red' : 'ivory'
export const count = (stack: readonly Player[], player: Player) =>
  stack.filter(checker => checker === player).length
export const emptyCounts = (): Counts => ({ ivory: 0, red: 0 })
export const oppositePoint = (player: Player, progress: number) =>
  player === 'ivory' ? 23 - progress : progress
