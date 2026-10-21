
import cardsData from './cards.json'
import type { CardInstance, FieldCell } from './types'
import { autoEquip } from './equipment'

type PlacementLayer =
  | 'territory'
  | 'monster'
  | 'equipment'
  | 'magic'
  | 'unknown'

// カードIDから種類を判定
export function getPlacementLayer(
  cardId: string
): PlacementLayer {
  const card = cardsData.find(c => c.id === cardId)

  if (!card) return 'unknown'

  switch (card.category) {
    case '基礎領土':
    case '特殊領土':
      return 'territory'

    case 'モンスター':
      return 'monster'

    case '装備':
      return 'equipment'

    case 'マジック':
      return 'magic'

    default:
      return 'unknown'
  }
}

// カードを戦場のマスに登録する
// まだ正式な配置条件は判定しない
export function addCardToCell(
  cell: FieldCell,
  card: CardInstance,
  turn: number
): FieldCell | null {
  const layer = getPlacementLayer(card.cardId)

  switch (layer) {
    case 'territory':
      if (cell.territory) return null

      return {
        ...cell,
        territory: card
      }

    case 'monster':
      if (cell.monster) return null

      return autoEquip({
        ...cell,
        monster: { card, summonedTurn: turn, equippedId: null }
      })

    case 'equipment':
      return autoEquip({
        ...cell,
        equipments: [...cell.equipments, card],
      })

    default:
      return null
  }
}
