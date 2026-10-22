import { fixedDeckCards } from './decks'
import { createInitialGameState } from './initialState'
import { createTutorialGame, TUTORIAL } from './tutorial'
import type { CardInstance, GameState, PlayerId } from './types'

export type LessonMode = 'develop' | 'summon' | 'move' | 'magic' | 'equipment' | 'victory' | 'all'
export type LessonStep = Exclude<LessonMode, 'all'> | 'turn-change' | 'equip-battle' | 'done'

const take = (deck: CardInstance[], owner: PlayerId, id: string): CardInstance => {
  const index = deck.findIndex(card => card.cardId === id && card.owner === owner)
  if (index === -1) throw new Error(`教材用カードが不足しています: ${id}`)
  return deck.splice(index, 1)[0]
}

export function createLessonScene(step: LessonStep): GameState {
  // 勝利条件の練習は、通常対戦と同じ勝敗判定に委ねる。
  if (step === 'victory') {
    const state = createInitialGameState()
    const ownDeck = fixedDeckCards('player1', '水', () => 0.41)
    const enemyDeck = fixedDeckCards('player2', '火', () => 0.43)
    // 相手の城への到達のみを学ぶ。城の山札切れは、この教材の対象外。
    for (const i of [22, 17, 12, 7]) state.board[i].territory = take(ownDeck, 'player1', 'LF-027')
    state.board[7].monster = { card: take(ownDeck, 'player1', 'LF-020'), summonedTurn: 3, equippedId: null }
    state.phase = 'move'; state.turn = 5
    state.players.player1.deck = ownDeck
    state.players.player2.deck = enemyDeck
    return state
  }
  if (step === 'develop' || step === 'summon' || step === 'move' || step === 'turn-change' || step === 'done') {
    const state = createTutorialGame()
    if (step === 'develop') return state
    const land = state.players.player1.hand.find(card => card.cardId === TUTORIAL.landCardId)!
    state.board[TUTORIAL.landIndex].territory = land
    state.players.player1.hand = state.players.player1.hand.filter(card => card.instanceId !== land.instanceId)
    state.phase = 'main'
    if (step === 'summon' || step === 'turn-change') return state
    const mon = state.players.player1.hand.find(card => card.cardId === TUTORIAL.monsterCardId)!
    state.board[TUTORIAL.landIndex].monster = { card: mon, summonedTurn: 3, equippedId: null }
    state.players.player1.hand = []
    state.turn = 5
    state.phase = 'move'
    return state
  }
  // マジック・装備は水属性。カードの効果と勝敗への影響が目に見える練習盤面。
  const state = createInitialGameState()
  const ownDeck = fixedDeckCards('player1', '水', () => 0.41)
  const enemyDeck = fixedDeckCards('player2', '火', () => 0.43)
  for (const i of [22, 17, 16]) state.board[i].territory = take(ownDeck, 'player1', 'LF-027')

  if (step === 'magic') {
    state.players.player1.hand = [take(ownDeck, 'player1', 'LF-023'), take(ownDeck, 'player1', 'LF-027')]
  } else {
    // 対戦相手には必要領土数5のモンスターが成立する合法的な5枚の領土を用意する。
    for (const i of [7, 12, 6, 1, 0]) state.board[i].territory = take(enemyDeck, 'player2', 'LF-009')
    state.board[12].monster = {
      card: take(enemyDeck, 'player2', 'LF-004'), summonedTurn: 1, equippedId: null,
    }
    state.board[17].monster = {
      card: take(ownDeck, 'player1', 'LF-020'), summonedTurn: 3, equippedId: null,
    }
    state.players.player1.hand = [take(ownDeck, 'player1', 'LF-025')]
  }
  state.players.player1.deck = ownDeck
  state.players.player2.deck = enemyDeck
  state.phase = 'main'
  state.turn = 5
  return state
}
