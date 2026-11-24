import { count, emptyCounts, other, type Dice, type Move, type Player, type Position, type Result, type RuleSet, type Variant } from './model'
import { fevga } from './rules/fevga'
import { plakoto } from './rules/plakoto'
import { portes } from './rules/portes'

export const rules = { portes, plakoto, fevga } satisfies Record<Variant, RuleSet>

export function initialPosition(variant: Variant): Position {
  const board = Array.from({ length: 24 }, (): Player[] => [])
  for (const [player, index, size] of rules[variant].initial) {
    board[index] = Array<Player>(size).fill(player)
  }
  return { board, bar: emptyCounts(), off: emptyCounts(), released: { ivory: false, red: false } }
}

export const expandDice = ([first, second]: Dice) =>
  first === second ? [first, first, first, first] : [first, second]

export const sameMove = (left: Move, right: Move) =>
  left.from === right.from && left.to === right.to && left.die === right.die

function advance(rule: RuleSet, position: Position, player: Player, move: Move, progress: number): Position {
  const board = position.board.slice()
  const bar = { ...position.bar }
  const off = { ...position.off }
  const released = { ...position.released }

  if (move.from === 'bar') bar[player]--
  else board[move.from] = board[move.from].slice(0, -1)

  if (move.to === 'off') off[player]++
  else {
    const target = board[move.to]
    const landing = rule.landing(target, player)
    bar[other(player)] += count(target, other(player)) - count(landing, other(player))
    board[move.to] = landing
    if (progress > 12) released[player] = true
  }

  return { board, bar, off, released }
}

interface Step {
  move: Move
  position: Position
}

function candidates(rule: RuleSet, position: Position, player: Player, die: number): Step[] {
  const track = Array.from({ length: 24 }, (_, progress) => rule.point(player, progress))
  const first = position.bar[player] ? -1 : track.findIndex(index => position.board[index].includes(player))
  const sources = first === -1 ? [-1] : track.map((_, progress) => progress).slice(first)
  if (first === -1 && !position.bar[player]) return []

  const steps: Step[] = []
  for (const progress of sources) {
    const from = progress === -1 ? 'bar' : track[progress]
    if (from !== 'bar' && position.board[from].at(-1) !== player) continue
    if (rule.restrictSource?.(position, player, progress)) continue
    const destination = progress + die
    const to = destination >= 24 ? 'off' : track[destination]
    if (to === 'off') {
      if (first < 18 || (destination > 24 && progress !== first)) continue
    } else if (!rule.canLand(position.board[to], player)) continue

    const move: Move = { from, to, die }
    const next = advance(rule, position, player, move, destination)
    if (rule.acceptPosition?.(next, player) === false) continue
    steps.push({ move, position: next })
  }
  return steps
}

export function outcome(rule: RuleSet, position: Position, player: Player): Result | undefined {
  if (position.off[player] === 15) {
    return { winner: player, points: position.off[other(player)] ? 1 : 2, reason: 'off' }
  }
  return rule.result?.(position)
}

interface Line {
  moves: Move[]
  opensPrime: boolean
}

export function legalMoves(
  rule: RuleSet, position: Position, player: Player, dice: readonly number[],
  prime = rule.forcedOpening?.(position, player) ?? [],
): Move[] {
  function search(current: Position, remaining: readonly number[]): Line[] {
    const opened = prime.some(point => current.board[point][0] !== player)
    const lines: Line[] = []
    for (const die of new Set(remaining)) {
      const rest = remaining.slice()
      rest.splice(rest.indexOf(die), 1)
      for (const step of candidates(rule, current, player, die)) {
        const endsGame = outcome(rule, step.position, player)
        const tails = endsGame ? search(step.position, []) : search(step.position, rest)
        for (const tail of tails) {
          lines.push({ moves: [step.move, ...tail.moves], opensPrime: tail.opensPrime })
        }
      }
    }
    return lines.length ? lines : [{ moves: [], opensPrime: opened }]
  }

  const lines = search(position, dice)
  const eligible = lines.some(line => line.opensPrime) ? lines.filter(line => line.opensPrime) : lines
  const length = Math.max(...eligible.map(line => line.moves.length))
  const longest = eligible.filter(line => line.moves.length === length)
  const higher = length === 1 ? Math.max(...longest.map(line => line.moves[0].die)) : 0
  const moves: Move[] = []
  for (const { moves: [move] } of longest) {
    if (move && (!higher || move.die === higher) && !moves.some(existing => sameMove(existing, move))) {
      moves.push(move)
    }
  }
  return moves
}

export function applyLegalMove(rule: RuleSet, position: Position, player: Player, move: Move): Position {
  const step = candidates(rule, position, player, move.die).find(step => sameMove(step.move, move))
  if (!step) throw new Error('Illegal move')
  return step.position
}
