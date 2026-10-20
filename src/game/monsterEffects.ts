import type { CardInstance, GameState, PendingMonsterEffect, PlayerId } from './types'
import {
  attackAt, autoEquip, cardName, defenseAt, drawCards, moveAndBattle,
  offsetTarget, validDestination,
} from './logic'

export type MonsterEffectResult = { game: GameState; success: boolean; message: string }

function addToGraveyard(game: GameState, card: CardInstance): GameState {
  const player = game.players[card.owner]
  return {
    ...game,
    players: {
      ...game.players,
      [card.owner]: { ...player, graveyard: [...player.graveyard, card] },
    },
  }
}

/** Summon choices are only offered if their source monster is still present. */
export function offerSummonEffect(game: GameState, index: number): GameState {
  if (game.winner || game.pendingEffect) return game
  const cell = game.board[index]
  const monster = cell?.monster
  if (!monster) return game
  let kind: PendingMonsterEffect['kind'] | null = null
  if (monster.card.cardId === 'LF-013' && cell.territory?.cardId === 'LF-017') {
    const to = offsetTarget(index, monster.card.owner, '2')
    if (to !== null && validDestination(game, index, to, monster.card.owner)) kind = 'centaur'
  }
  if (monster.card.cardId === 'LF-020' && cell.territory?.cardId === 'LF-026') kind = 'mermaid'
  return kind ? {
    ...game,
    pendingEffect: { kind, cellIndex: index, instanceId: monster.card.instanceId },
  } : game
}

/** Only a won *normal* battle triggers the ogre's optional advance. */
export function offerOgreAdvance(game: GameState, index: number, wonNormalBattle: boolean): GameState {
  const monster = game.board[index]?.monster
  if (!wonNormalBattle || game.winner || game.pendingEffect || monster?.card.cardId !== 'LF-005') return game
  const to = offsetTarget(index, monster.card.owner, '2')
  if (to === null || !validDestination(game, index, to, monster.card.owner)) return game
  return {
    ...game,
    pendingEffect: { kind: 'ogre', cellIndex: index, instanceId: monster.card.instanceId },
  }
}

export function resolveOptionalMonsterEffect(game: GameState, activate: boolean): MonsterEffectResult {
  const pending = game.pendingEffect
  if (!pending) return { game, success: false, message: '選択待ちのモンスター効果はありません' }
  const cell = game.board[pending.cellIndex]
  if (!cell?.monster || cell.monster.card.instanceId !== pending.instanceId) {
    return { game: { ...game, pendingEffect: null }, success: false, message: '対象モンスターが戦場にいません' }
  }
  let next: GameState = { ...game, pendingEffect: null }
  if (!activate) return { game: next, success: true, message: `${cardName(cell.monster.card.cardId)}の任意効果を使いませんでした` }

  if (pending.kind === 'mermaid') {
    if (cell.monster.card.cardId !== 'LF-020' || cell.territory?.cardId !== 'LF-026') {
      return { game, success: false, message: 'マーメイドの発動条件を満たしていません' }
    }
    next = drawCards(next, cell.monster.card.owner, 1)
    return { game: next, success: true, message: `親和するマーメイド：1枚ドローしました${next.winner ? ` ／ ${next.winReason}` : ''}` }
  }

  if (pending.kind === 'centaur' && (cell.monster.card.cardId !== 'LF-013' || cell.territory?.cardId !== 'LF-017')) {
    return { game, success: false, message: 'ケンタウロスの発動条件を満たしていません' }
  }
  if (pending.kind === 'ogre' && cell.monster.card.cardId !== 'LF-005') {
    return { game, success: false, message: 'オーガの発動条件を満たしていません' }
  }

  const to = offsetTarget(pending.cellIndex, cell.monster.card.owner, '2')
  if (to === null || !validDestination(game, pending.cellIndex, to, cell.monster.card.owner)) {
    return { game, success: false, message: '前進できるマスがありません' }
  }
  // Not normal movement: no extra regular-move consumption or repeat Ogre trigger.
  const moved = moveAndBattle(next, pending.cellIndex, to, false)
  return {
    game: moved.game,
    success: true,
    message: `${pending.kind === 'centaur' ? 'ケンタウロスの騎兵' : 'オーガの狂戦士'}の効果：${moved.message}`,
  }
}

/** LF-022: A sea summon may attack an enemy occupying its own sea territory.
 * "before" is the board with the defender; "after" already has the summoned monster
 * replacing it and the card removed from the summoner's hand.
 */
export function resolvePrakilorusSummonBattle(before: GameState, after: GameState, index: number): MonsterEffectResult {
  const defender = before.board[index]?.monster
  const challenger = after.board[index]?.monster
  const territory = before.board[index]?.territory
  if (!defender || !challenger || challenger.card.cardId !== 'LF-022' ||
    defender.card.owner === challenger.card.owner || territory?.cardId !== 'LF-026' ||
    territory.owner !== challenger.card.owner) {
    return { game: before, success: false, message: 'プラキロルスの特殊召喚条件を満たしていません' }
  }
  // Attack on the contested cell without treating the defender's equipment as already worn by the challenger.
  const attack = attackAt(after, index) ?? 0
  const defense = defenseAt(before, index) ?? 0
  let next = after
  if (attack > defense) {
    next = addToGraveyard(next, defender.card)
    next = { ...next, board: next.board.map((c, i) => i === index ? autoEquip(c) : c) }
    const equipped = next.board[index].equipments.find(e => e.instanceId === next.board[index].monster?.equippedId)
    if (equipped?.cardId === 'LF-025') next = drawCards(next, challenger.card.owner, 1)
    return { game: next, success: true, message: `プラキロルスの特殊召喚：勝利！ ATK ${attack} ＞ DEF ${defense}${next.winner ? ` ／ ${next.winReason}` : ''}` }
  }
  next = addToGraveyard(next, challenger.card)
  if (attack < defense) {
    next = { ...next, board: next.board.map((c, i) => i === index ? before.board[index] : c) }
    return { game: next, success: true, message: `プラキロルスの特殊召喚：敗北。ATK ${attack} ＜ DEF ${defense}` }
  }
  next = addToGraveyard(next, defender.card)
  next = { ...next, board: next.board.map((c, i) => i === index ? { ...c, monster: null } : c) }
  return { game: next, success: true, message: `プラキロルスの特殊召喚：相討ち。ATK ${attack} ＝ DEF ${defense}` }
}

/** A one-square advance direction is always relative to the moving monster. */
export function forwardIndex(index: number, owner: PlayerId) {
  return offsetTarget(index, owner, '2')
}
