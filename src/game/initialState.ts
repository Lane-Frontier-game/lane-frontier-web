
import type { FieldCell, GameState } from './types'

const ROWS = 6
const COLS = 5

function createEmptyBoard(): FieldCell[] {
  const board: FieldCell[] = Array.from(
    { length: ROWS * COLS },
    () => ({
      castleOwner: null,
      territory: null,
      monster: null,
      equipments: []
    })
  )

  // 上側中央：プレイヤー2の城
  board[2].castleOwner = 'player2'

  // 下側中央：プレイヤー1の城
  board[27].castleOwner = 'player1'

  return board
}

export function createInitialGameState(): GameState {
  return {
    players: {
      player1: {
        deck: [],
        hand: [],
        graveyard: []
      },
      player2: {
        deck: [],
        hand: [],
        graveyard: []
      }
    },
    board: createEmptyBoard(),
    activePlayer: 'player1',
    phase: 'start',
    turn: 1,
territoryPlayedThisTurn: false,
mainActionUsedThisTurn: false,
    moveUsedThisTurn: false,
    winner: null,
    winReason: null,
    pendingEffect: null
  }
}
