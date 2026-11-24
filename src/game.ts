import { applyLegalMove, expandDice, initialPosition, legalMoves, outcome, rules, sameMove } from './engine'
import { emptyCounts, other, type Counts, type Dice, type Move, type Player, type Position, type Result, type Variant } from './model'

const rotation: readonly Variant[] = ['portes', 'plakoto', 'fevga']
export type Mode = Variant | 'match'

type Phase =
  | { kind: 'opening'; tie?: Dice }
  | { kind: 'roll'; passed?: Player }
  | { kind: 'move'; dice: readonly number[]; moves: readonly Move[]; prime: readonly number[] }
  | { kind: 'finished'; result: Result }

export interface Game {
  readonly position: Position
  readonly variant: Variant
  readonly mode: Mode
  readonly target: number
  readonly score: Counts
  readonly player: Player
  readonly opening?: Dice
  readonly phase: Phase
}

export type Action =
  | { type: 'roll'; dice: Dice }
  | { type: 'move'; move: Move }
  | { type: 'next' }

export function newGame(mode: Mode, target = 5): Game {
  const variant = mode === 'match' ? rotation[0] : mode
  return {
    position: initialPosition(variant), variant, mode, target, score: emptyCounts(),
    player: 'ivory', phase: { kind: 'opening' },
  }
}

export function matchWinner(game: Game): Player | undefined {
  if (game.mode !== 'match') return
  if (game.score.ivory >= game.target) return 'ivory'
  if (game.score.red >= game.target) return 'red'
}

export function reduce(game: Game, action: Action): Game {
  const { phase, player, variant, position } = game
  const rule = rules[variant]

  if (action.type === 'roll' && phase.kind === 'opening') {
    const [ivory, red] = action.dice
    if (ivory === red) return { ...game, phase: { kind: 'opening', tie: action.dice } }
    return { ...game, player: ivory > red ? 'ivory' : 'red', opening: action.dice, phase: { kind: 'roll' } }
  }
  if (action.type === 'roll' && phase.kind === 'roll') {
    const dice = expandDice(action.dice)
    const prime = rule.forcedOpening?.(position, player) ?? []
    const moves = legalMoves(rule, position, player, dice, prime)
    return moves.length
      ? { ...game, opening: undefined, phase: { kind: 'move', dice, moves, prime } }
      : { ...game, opening: undefined, player: other(player), phase: { kind: 'roll', passed: player } }
  }
  if (action.type === 'move' && phase.kind === 'move') {
    const move = phase.moves.find(candidate => sameMove(candidate, action.move))
    if (!move) return game
    const next = applyLegalMove(rule, position, player, move)
    const result = outcome(rule, next, player)
    if (result) {
      const score = { ...game.score }
      if (result.winner) score[result.winner] += result.points
      return { ...game, position: next, score, phase: { kind: 'finished', result } }
    }

    const dice = [...phase.dice]
    dice.splice(dice.indexOf(move.die), 1)
    const moves = legalMoves(rule, next, player, dice, phase.prime)
    return moves.length
      ? { ...game, position: next, phase: { ...phase, dice, moves } }
      : { ...game, position: next, player: other(player), phase: { kind: 'roll' } }
  }
  if (action.type === 'next' && phase.kind === 'finished' && game.mode === 'match' && !matchWinner(game)) {
    const winner = phase.result.winner
    const nextVariant = winner ? rotation[(rotation.indexOf(variant) + 1) % rotation.length] : variant
    return {
      ...game, variant: nextVariant, position: initialPosition(nextVariant), opening: undefined,
      player: winner ?? 'ivory', phase: winner ? { kind: 'roll' } : { kind: 'opening' },
    }
  }
  return game
}
