import { other, players, type Player, type RuleSet } from '../model'

const point = (player: Player, progress: number) =>
  (progress + (player === 'ivory' ? 23 : 11)) % 24

export const fevga: RuleSet = {
  point,
  initial: players.map(player => [player, point(player, 0), 15]),
  canLand: (stack, player) => !stack.length || stack[0] === player,
  landing: (stack, player) => [...stack, player],
  restrictSource(position, player, progress) {
    return !position.released[player] && progress === 0 && position.board[point(player, 0)].length < 15
  },
  acceptPosition(position, player) {
    return Array.from({ length: 6 }, (_, progress) => point(player, progress))
      .some(index => position.board[index][0] !== player)
  },
  forcedOpening(position, player) {
    const opponent = other(player)
    if (position.off[opponent]) return []
    const behind = Array.from({ length: 18 }, (_, progress) => progress)
      .find(progress => position.board[point(opponent, progress)].length === 15 &&
        position.board[point(opponent, progress)][0] === opponent)
    if (behind === undefined) return []
    const prime = Array.from({ length: 6 }, (_, offset) => point(opponent, behind + offset + 1))
    return prime.every(index => position.board[index][0] === player) ? prime : []
  },
}
