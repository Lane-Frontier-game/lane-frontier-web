import type { CardInstance, GameState, PlayerId } from './types'
import { adjacent, cardInfo, territoryCount } from './logic'

/** UI highlight only; the click handler still validates actual game state. */
export function placementTargets(game: GameState, card: CardInstance, owner: PlayerId): number[] {
  if (game.winner || game.pendingEffect || card.owner !== owner) return []
  const data = cardInfo(card.cardId)
  if (!data) return []
  const isLand = data.category === '基礎領土' || data.category === '特殊領土'
  if (isLand) {
    if (game.phase !== 'develop' || game.territoryPlayedThisTurn) return []
    return game.board.flatMap((cell, index) => {
      if (cell.castleOwner || cell.territory) return []
      const neighbours = adjacent(index)
      if (!neighbours.some(i => game.board[i].castleOwner === owner || game.board[i].territory?.owner === owner)) return []
      if (data.category === '特殊領土' && !neighbours.some(i => {
        const t = game.board[i].territory
        return t?.owner === owner && cardInfo(t.cardId)?.element === data.element
      })) return []
      return [index]
    })
  }
  if (data.category !== 'モンスター' && data.category !== '装備') return []
  if (game.phase !== 'main' || game.mainActionUsedThisTurn ||
      typeof data.requiredTerritories !== 'number' || territoryCount(game, owner) < data.requiredTerritories) return []
  return game.board.flatMap((cell, index) => {
    if (cell.castleOwner || !cell.territory || cell.territory.owner !== owner ||
        cardInfo(cell.territory.cardId)?.element !== data.element) return []
    if (data.category === 'モンスター' && cell.monster &&
        !(card.cardId === 'LF-022' && cell.territory.cardId === 'LF-026' && cell.monster.card.owner !== owner)) return []
    return [index]
  })
}
