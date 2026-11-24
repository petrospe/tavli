import { oppositePoint, players, type RuleSet } from '../model'

const setup = [[0, 2], [11, 5], [16, 3], [18, 5]] as const

export const portes: RuleSet = {
  point: oppositePoint,
  initial: players.flatMap(player => setup.map(([progress, size]) =>
    [player, oppositePoint(player, progress), size] as const)),
  canLand: (stack, player) => stack.length < 2 || stack[0] === player,
  landing: (stack, player) => stack[0] === player ? [...stack, player] : [player],
}
