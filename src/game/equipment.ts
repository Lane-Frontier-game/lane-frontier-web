import type { CardInstance, FieldCell } from './types'

/** A monster can use exactly one equipment card, even if the card belongs to an opponent. */
export function equippedCardInCell(cell: FieldCell): CardInstance | undefined {
  return cell.equipments.find(card => card.instanceId === cell.monster?.equippedId)
}

/**
 * Reconcile a monster with the cards actually present in its square.
 * An existing, valid equipment is never exchanged.  One free equipment
 * is automatically worn; two or more require the player to choose.
 */
export function autoEquip(cell: FieldCell): FieldCell {
  const monster = cell.monster
  if (!monster) return cell
  if (monster.equippedId && equippedCardInCell(cell)) return cell
  const chosenId = cell.equipments.length === 1 ? cell.equipments[0].instanceId : null
  if (monster.equippedId === chosenId) return cell
  return { ...cell, monster: { ...monster, equippedId: chosenId } }
}

/** Use one of the equipment cards in this square, regardless of card owner. */
export function equipMonsterInCell(cell: FieldCell, equipmentInstanceId: string): FieldCell | null {
  if (!cell.monster || cell.monster.equippedId !== null) return null
  if (!cell.equipments.some(card => card.instanceId === equipmentInstanceId)) return null
  return { ...cell, monster: { ...cell.monster, equippedId: equipmentInstanceId } }
}
