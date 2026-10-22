import type { GameState } from './types'
import { otherPlayer } from './logic'

/** v0.15系のフェイズ補助。現在の通常操作では手動進行が基本。 */
function hasEquipmentChoice(state: GameState): boolean {
  return state.board.some(cell => cell.monster && !cell.monster.equippedId && cell.equipments.length > 1)
}
export function switchTurn(state: GameState): GameState {
  return {
    ...state,
    activePlayer: otherPlayer(state.activePlayer),
    phase: 'start',
    turn: state.turn + 1,
    territoryPlayedThisTurn: false,
    mainActionUsedThisTurn: false,
    moveUsedThisTurn: false,
    pendingEffect: null,
  }
}
export function autoFinishAction(state: GameState): GameState {
  if (state.winner || state.pendingEffect || hasEquipmentChoice(state)) return state
  if (state.phase === 'develop' && state.territoryPlayedThisTurn) return { ...state, phase: 'main' }
  if (state.phase === 'move' && state.moveUsedThisTurn) return switchTurn(state)
  return state
}

