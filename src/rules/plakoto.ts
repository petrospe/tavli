import { other, oppositePoint, players, type RuleSet } from '../model'

export const plakoto: RuleSet = {
  point: oppositePoint,
  initial: players.map(player => [player, oppositePoint(player, 0), 15]),
  canLand: (stack, player) => stack.length < 2 || stack.at(-1) === player,
  landing: (stack, player) => [...stack, player],
  result(position) {
    const start = (player: typeof players[number]) => position.board[oppositePoint(player, 0)]
    const pinned = players.filter(player => start(player)[0] === player && start(player).at(-1) !== player)
    if (pinned.length === 2) return { winner: null, points: 0, reason: 'mother' }
    const [loser] = pinned
    if (loser && start(other(loser))[0] !== other(loser)) {
      return { winner: other(loser), points: 2, reason: 'mother' }
    }
  },
}
