import './style.css'
import { matchWinner, newGame, reduce, type Action, type Mode } from './game'
import { type Move, type Player, type Variant } from './model'

const variantNames: Record<Variant, string> = { portes: 'Πόρτες', plakoto: 'Πλακωτό', fevga: 'Φεύγα' }
const playerNames: Record<Player, string> = { ivory: 'Λευκά', red: 'Κόκκινα' }
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const board = byId('board')
const mode = byId<HTMLSelectElement>('mode')
const target = byId<HTMLSelectElement>('target')
const bar = byId<HTMLButtonElement>('bar')
const off = byId('off')
const roll = byId<HTMLButtonElement>('roll')
const diceDisplay = byId('dice')

let game = newGame('portes')
let selected: Move['from'] | undefined

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

function dispatch(action: Action) {
  game = reduce(game, action)
  selected = undefined
  render()
}

function currentMoves() {
  return game.phase.kind === 'move' ? game.phase.moves : []
}

function choosePoint(index: number) {
  const moves = currentMoves()
  const targetMove = moves.find(move => move.from === selected && move.to === index)
  if (targetMove) dispatch({ type: 'move', move: targetMove })
  else if (moves.some(move => move.from === index)) {
    selected = selected === index ? undefined : index
    render()
  }
}

function throwDie() {
  return Math.floor(Math.random() * 6) + 1
}

roll.addEventListener('click', () => {
  if (game.phase.kind === 'move') return
  if (game.phase.kind === 'finished') {
    if (game.mode === 'match' && !matchWinner(game)) dispatch({ type: 'next' })
    else byId<HTMLFormElement>('settings').requestSubmit()
  } else dispatch({ type: 'roll', dice: [throwDie(), throwDie()] })
})

bar.addEventListener('click', () => {
  if (!currentMoves().some(move => move.from === 'bar')) return
  selected = selected === 'bar' ? undefined : 'bar'
  render()
})

mode.addEventListener('change', () => { byId('target-label').hidden = mode.value !== 'match' })
byId('settings').addEventListener('submit', event => {
  event.preventDefault()
  game = newGame(mode.value as Mode, Number(target.value))
  selected = undefined
  render()
})

function render() {
  const { position, player, phase } = game
  const moves = currentMoves()
  byId('variant').textContent = variantNames[game.variant]
  byId('ivory-score').textContent = String(game.score.ivory)
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
    if (move) button.addEventListener('click', () => dispatch({ type: 'move', move }))
    off.append(button)
  }
  roll.setAttribute('aria-disabled', String(phase.kind === 'move'))

  const active = playerNames[player]
  const status = byId('status')
  diceDisplay.replaceChildren()
  if (phase.kind === 'opening') {
    status.textContent = phase.tie ? `Ισοπαλία (${phase.tie[0]}–${phase.tie[1]}). Ρίξτε ξανά.` : 'Ρίξτε από ένα ζάρι για τη σειρά.'
    roll.textContent = 'Ρίψη για σειρά'
  } else if (phase.kind === 'roll') {
    const prefix = phase.passed ? `${playerNames[phase.passed]} δεν έχουν κίνηση. ` :
      game.opening ? `Κλήρωση ${game.opening.join('–')} (Λευκά–Κόκκινα). ` : ''
    status.textContent = `${prefix}Σειρά για τα ${active}.`
    roll.textContent = 'Ρίξε ζάρια'
  } else if (phase.kind === 'move') {
    status.textContent = `Παίζουν τα ${active}. Ζάρια που απομένουν`
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
    status.textContent = champion ? `Τα ${playerNames[champion]} κερδίζουν τον αγώνα.` :
      winner ? `Τα ${playerNames[winner]} κερδίζουν ${points === 1 ? '1 πόντο' : '2 πόντους'}${reason === 'mother' ? ' με πλάκωμα της μάνας' : ''}.` :
      'Ισοπαλία. Πλακώθηκαν και οι δύο μάνες.'
    roll.textContent = game.mode === 'match' && !champion ? 'Επόμενη παρτίδα' : 'Παίξε ξανά'
  }
}

render()
