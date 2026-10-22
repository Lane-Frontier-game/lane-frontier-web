import cardsData from './cards.json'
import { createInitialGameState } from './initialState'
import type { CardInstance, GameState, PlayerId } from './types'

/** 商品版と同じ固定3デッキ。各属性は基礎領土16枚＋それ以外8種類を各3枚。 */
export const DECK_ELEMENTS = ['火', '風', '水'] as const
export type DeckElement = typeof DECK_ELEMENTS[number]
export type DeckEntry = { cardId: string; count: number }

export function deckRecipe(element: DeckElement): DeckEntry[] {
  const attributeCards = cardsData.filter(card => card.element === element)
  const basics = attributeCards.filter(card => card.category === '基礎領土')
  const others = attributeCards.filter(card => card.category !== '基礎領土')
  if (basics.length !== 1 || others.length !== 8) {
    throw new Error(`${element}デッキ：基礎領土1種類＋その他8種類のカードデータが必要です`)
  }
  return [
    { cardId: basics[0].id, count: 16 },
    ...others.map(card => ({ cardId: card.id, count: 3 })),
  ]
}

export function fixedDeckCards(
  owner: PlayerId,
  element: DeckElement,
  random: () => number = Math.random,
): CardInstance[] {
  const deck: CardInstance[] = deckRecipe(element).flatMap(({ cardId, count }) =>
    Array.from({ length: count }, () => ({
      cardId,
      instanceId: '',
      owner,
    })),
  )
  if (deck.length !== 40) throw new Error(`${element}デッキは40枚でなければなりません`)
  // 同名カードでも別々の実体を持たせる（手札や墓地への移動判定に必要）。
  const cards = deck.map((card, index) => ({ ...card, instanceId: `${owner}-deck-${index + 1}` }))
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

export function createGameWithDecks(
  first: DeckElement,
  second: DeckElement,
  random: () => number = Math.random,
): GameState {
  const game = createInitialGameState()
  for (const [playerId, element] of [
    ['player1', first],
    ['player2', second],
  ] as const) {
    const cards = fixedDeckCards(playerId, element, random)
    game.players[playerId].hand = cards.slice(0, 7)
    game.players[playerId].deck = cards.slice(7)
  }
  return game
}
