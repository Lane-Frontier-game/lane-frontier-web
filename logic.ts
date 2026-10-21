import cardsData from './cards.json'
import type { CardInstance, FieldCell, GameState, PlayerId } from './types'
import { autoEquip, equippedCardInCell } from './equipment'
export { autoEquip } from './equipment'

export const COLS = 5
export const ROWS = 6

export function cardInfo(cardId: string) {
  return cardsData.find(card => card.id === cardId)
}
export function cardName(cardId: string) { return cardInfo(cardId)?.name.trim() ?? cardId }
export function cardImage(cardId: string) { return `${import.meta.env.BASE_URL}cards/${cardInfo(cardId)?.image ?? `${cardId}.jpg`}` }
export function otherPlayer(id: PlayerId): PlayerId { return id === 'player1' ? 'player2' : 'player1' }
export function territoryCount(game: GameState, owner: PlayerId) {
  return game.board.filter(cell => cell.territory?.owner === owner).length
}
export function ownElementTerritoryCount(game: GameState, owner: PlayerId, element: string) {
  return game.board.filter(cell => cell.territory?.owner === owner && cardInfo(cell.territory.cardId)?.element === element).length
}
export function adjacent(index: number) {
  const r = Math.floor(index / COLS); const c = index % COLS
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([row, col]) => row >= 0 && row < ROWS && col >= 0 && col < COLS)
    .map(([row, col]) => row * COLS + col)
}

/** 相手の方向が「前（2）」。左右もプレイヤー2の場合は180°反転。 */
const directions: Record<string, [number, number]> = {
  '1': [1, -1], '2': [1, 0], '3': [1, 1],
  '4': [0, -1], '6': [0, 1],
  '7': [-1, -1], '8': [-1, 0], '9': [-1, 1],
}
export function offsetTarget(index: number, owner: PlayerId, direction: string): number | null {
  const d = directions[direction]
  if (!d) return null
  const turn = owner === 'player1' ? -1 : 1
  const row = Math.floor(index / COLS) + d[0] * turn
  const col = index % COLS - d[1] * turn
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
  return row * COLS + col
}

export function equippedCard(cell: FieldCell): CardInstance | undefined {
  return equippedCardInCell(cell)
}

function treantBonus(game: GameState, index: number, owner: PlayerId): number {
  return adjacent(index).filter(i => {
    const neighbor = game.board[i].monster
    return neighbor?.card.owner === owner && neighbor.card.cardId === 'LF-012'
  }).length
}

export function attackAt(game: GameState, index: number): number | null {
  const cell = game.board[index]; if (!cell.monster) return null
  const card = cardInfo(cell.monster.card.cardId)
  if (typeof card?.attack !== 'number') return null
  let value = card.attack
  const equipmentId = equippedCard(cell)?.cardId
  if (equipmentId === 'LF-007') value += 2
  if (equipmentId === 'LF-025') value += 1
  if (cell.monster.card.cardId === 'LF-003' && cell.territory && cell.territory.owner !== cell.monster.card.owner) value++
  value += treantBonus(game, index, cell.monster.card.owner)
  return value
}
export function defenseAt(game: GameState, index: number): number | null {
  const cell = game.board[index]; if (!cell.monster) return null
  const card = cardInfo(cell.monster.card.cardId)
  if (typeof card?.defense !== 'number') return null
  return card.defense + treantBonus(game, index, cell.monster.card.owner)
}
export function movementDirections(game: GameState, index: number): string[] {
  const cell = game.board[index]; if (!cell.monster) return []
  const card = cardInfo(cell.monster.card.cardId)
  const base: string[] = card?.movement?.split(',').map(s => s.trim()).filter(x => x in directions) ?? []
  if (equippedCard(cell)?.cardId === 'LF-016') base.push('2')
  return [...new Set(base)]
}
export function validDestination(game: GameState, from: number, to: number, owner: PlayerId): boolean {
  if (from === to) return false
  const cell = game.board[to]
  if (!cell) return false
  if (cell.castleOwner === owner) return false
  if (cell.monster?.card.owner === owner) return false
  return cell.castleOwner === otherPlayer(owner) || cell.territory !== null
}
export function canMoveNow(game: GameState, index: number): boolean {
  const monster = game.board[index]?.monster
  return !!monster && monster.card.owner === game.activePlayer &&
    (monster.summonedTurn !== game.turn || monster.rushTurn === game.turn) &&
    monster.lockedTurn !== game.turn
}
export function legalMoves(game: GameState, index: number): number[] {
  if (game.winner || game.phase !== 'move' || game.moveUsedThisTurn || !canMoveNow(game, index)) return []
  const owner = game.board[index].monster!.card.owner
  return movementDirections(game, index)
    .map(dir => offsetTarget(index, owner, dir))
    .filter((to): to is number => to !== null && validDestination(game, index, to, owner))
}

export function drawCards(game: GameState, playerId: PlayerId, amount: number): GameState {
  let next = game
  for (let n = 0; n < amount; n++) {
    if (next.winner) break
    const player = next.players[playerId]
    if (player.deck.length === 0) {
      return { ...next, winner: otherPlayer(playerId), winReason: `${playerId === 'player1' ? 'プレイヤー1' : 'プレイヤー2'}の城が0枚になりました` }
    }
    const drawn = player.deck[0]
    const players = {
      ...next.players,
      [playerId]: {
        ...player,
        deck: player.deck.slice(1),
        hand: [...player.hand, drawn],
      }
    }
    next = { ...next, players }
    if (players[playerId].deck.length === 0) {
      next = { ...next, winner: otherPlayer(playerId), winReason: `${playerId === 'player1' ? 'プレイヤー1' : 'プレイヤー2'}の城が0枚になりました` }
    }
  }
  return next
}

export type MoveResult = { game: GameState, message: string, attackerWon: boolean }

/** 方向チェックは呼出側で実施。効果移動も同じ戦闘処理を使う。 */
export function moveAndBattle(game: GameState, from: number, to: number, normal: boolean): MoveResult {
  const origin = game.board[from]
  const destination = game.board[to]
  const mover = origin?.monster
  if (!mover || !validDestination(game, from, to, mover.card.owner)) return { game, message: 'そこには移動できません', attackerWon: false }
  const movingEquipment = origin.equipments.find(e => e.instanceId === mover.equippedId)
  const originAfter: FieldCell = {
    ...origin,
    monster: null,
    equipments: movingEquipment ? origin.equipments.filter(e => e.instanceId !== movingEquipment.instanceId) : origin.equipments,
  }
  const destinationEquipments = movingEquipment ? [...destination.equipments, movingEquipment] : destination.equipments
  const movingToCastle = destination.castleOwner === otherPlayer(mover.card.owner)
  let arrive: FieldCell = { ...destination, equipments: destinationEquipments, monster: mover }
  let attackerWon = false
  let message = `${cardName(mover.card.cardId)}が移動しました`
  const deaths: CardInstance[] = []
  if (destination.monster && destination.monster.card.owner !== mover.card.owner) {
    // 攻撃側は移動先の領土・隣接効果を反映したATKで比較する。
    const atBattle: GameState = { ...game, board: game.board.map((c, i) =>
      i === from ? originAfter : i === to ? { ...destination, monster: mover, equipments: destinationEquipments } : c
    ) }
    const attack = attackAt(atBattle, to) ?? 0
    const defense = defenseAt(game, to) ?? 0
    const enemy = destination.monster
    if (attack > defense) {
      deaths.push(enemy.card)
      attackerWon = true
      arrive = { ...arrive, monster: mover }
      message = `戦闘勝利！ ${cardName(mover.card.cardId)} ATK ${attack} ＞ ${cardName(enemy.card.cardId)} DEF ${defense}`
    } else if (attack < defense) {
      deaths.push(mover.card)
      arrive = { ...arrive, monster: enemy }
      message = `戦闘敗北：${cardName(mover.card.cardId)} ATK ${attack} ＜ ${cardName(enemy.card.cardId)} DEF ${defense}`
    } else {
      deaths.push(enemy.card, mover.card)
      arrive = { ...arrive, monster: null }
      message = `相討ち！ ATK ${attack} ＝ DEF ${defense}`
    }
  }
  // 戦闘に残ったモンスターが「以前どの装備を使っていたか」を記録する。
  // 攻撃側が負けた場合、守備側が攻撃側の装備を拾うこともある。
  // その際は、敗れた攻撃側の装備IDと比較してはいけない。
  const survivingWearerBefore = arrive.monster?.card.instanceId === mover.card.instanceId
    ? mover.equippedId
    : arrive.monster?.card.instanceId === destination.monster?.card.instanceId
      ? (destination.monster?.equippedId ?? null)
      : null
  // 戦闘が終わったマスに装備が残る。新しいモンスターは装備1枚なら自動使用。
  arrive = autoEquip(arrive)
  const board = game.board.map((cell, i) => i === from ? originAfter : i === to ? arrive : cell)
  let players = game.players
  for (const dead of deaths) {
    players = {
      ...players,
      [dead.owner]: { ...players[dead.owner], graveyard: [...players[dead.owner].graveyard, dead] }
    }
  }
  let next: GameState = { ...game, board, players, moveUsedThisTurn: normal || game.moveUsedThisTurn }
  // 新しく装備した生存モンスターだけ、調和の槍のドロー効果を発動する。
  // 攻撃側が負けて槍が守備側へ渡る場合も含む。
  if (arrive.monster?.equippedId && arrive.monster.equippedId !== survivingWearerBefore) {
    const selected = arrive.equipments.find(e => e.instanceId === arrive.monster?.equippedId)
    if (selected?.cardId === 'LF-025') {
      const wearer = arrive.monster.card.owner
      const handBefore = next.players[wearer].hand.length
      next = drawCards(next, wearer, 1)
      const drawn = next.players[wearer].hand.length - handBefore
      message += drawn === 1
        ? ` ／ ${cardName(selected.cardId)}を新たに装備し、${wearer === 'player1' ? 'プレイヤー1' : 'プレイヤー2'}が1枚ドロー`
        : ` ／ ${cardName(selected.cardId)}のドロー処理で城が0枚になりました`
    }
  }
  if (movingToCastle && !!arrive.monster && arrive.monster.card.owner === mover.card.owner) {
    next = { ...next, winner: mover.card.owner, winReason: '相手の城に到達しました' }
    message = `勝利！ ${cardName(mover.card.cardId)}が相手の城に到達しました！`
  }
  return { game: next, message, attackerWon }
}
