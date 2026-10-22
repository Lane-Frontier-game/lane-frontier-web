import { fixedDeckCards } from './decks'
import { createInitialGameState } from './initialState'
import type { CardInstance, GameState, PlayerId } from './types'

/**
 * 紙版ルールを通常の対戦処理で体験するための決め打ち練習盤面。
 * 必要なカードだけを実際の40枚デッキから取り出し、残りは城（山札）にする。
 * 対戦相手の手番はチュートリアル内では操作せず、必要な場面まで省略する。
 */
export const TUTORIAL = {
  landIndex: 17,
  previousLandIndex: 22,
  enemyIndex: 12,
  landCardId: 'LF-009',
  monsterCardId: 'LF-001',
} as const

export type TutorialStep = 'intro' | 'land' | 'summon' | 'move-intro' | 'move' | 'complete'

export function createTutorialGame(): GameState {
  const state = createInitialGameState()
  const firstDeck = fixedDeckCards('player1', '火', () => 0.42)
  const secondDeck = fixedDeckCards('player2', '水', () => 0.42)

  function take(deck: CardInstance[], owner: PlayerId, cardId: string): CardInstance {
    const position = deck.findIndex(card => card.cardId === cardId && card.owner === owner)
    if (position === -1) throw new Error(`チュートリアル用カードがありません: ${cardId}`)
    return deck.splice(position, 1)[0]
  }

  const establishedLand = take(firstDeck, 'player1', 'LF-009')
  const handLand = take(firstDeck, 'player1', TUTORIAL.landCardId)
  const handMonster = take(firstDeck, 'player1', TUTORIAL.monsterCardId)
  const enemyLand = take(secondDeck, 'player2', 'LF-027')
  const enemyPathLand = take(secondDeck, 'player2', 'LF-027')
  const enemyMonster = take(secondDeck, 'player2', 'LF-020')

  state.board[TUTORIAL.previousLandIndex].territory = establishedLand
  // 相手側も城から上下に連なった合法的な領土の並びを用意する。
  state.board[7].territory = enemyPathLand
  state.board[TUTORIAL.enemyIndex].territory = enemyLand
  state.board[TUTORIAL.enemyIndex].monster = {
    card: enemyMonster,
    summonedTurn: 0,
    equippedId: null,
  }
  state.players.player1.hand = [handLand, handMonster]
  state.players.player1.deck = firstDeck
  state.players.player2.deck = secondDeck
  state.players.player2.hand = []
  state.turn = 3
  state.phase = 'develop'
  return state
}
