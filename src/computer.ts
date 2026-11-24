import { rules } from './engine'
import { reduce, type Game } from './game'
import { count, other, type Move, type Player } from './model'

function evaluate(game: Game, player: Player): number {
  const { phase, position, variant } = game
  if (phase.kind === 'finished') {
    if (phase.result.winner === null) return 0
    return (phase.result.winner === player ? 1 : -1) * (10_000 + phase.result.points)
  }

  const rule = rules[variant]
  function sideScore(side: Player): number {
    let score = 29 * position.off[side] - 14 * position.bar[side]
    for (let progress = 0; progress < 24; progress++) {
      const stack = position.board[rule.point(side, progress)]
      const checkers = count(stack, side)
      if (!checkers) continue

      score += progress * checkers
      if (stack.at(-1) !== side) {
        score -= 12
      } else if (variant === 'fevga') {
        score += 3
      } else if (checkers >= 2 || stack[0] !== side) {
        score += progress >= 18 ? 5 : 3
      } else if (variant === 'portes') {
        score -= 2
      }
    }
    if (variant === 'fevga' && position.released[side]) score += 8
    return score
  }

  return sideScore(player) - sideScore(other(player))
}

export function computerMove(game: Game): Move | undefined {
  if (game.phase.kind !== 'move') return

  let best: Move | undefined
  let bestScore = -Infinity
  for (const move of game.phase.moves) {
    const result = reduce(game, { type: 'move', move })
    const score = evaluate(result, game.player)
    if (score > bestScore) {
      best = move
      bestScore = score
    }
  }
  return best
}
