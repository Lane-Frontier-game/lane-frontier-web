import type { CardInstance, GameState, PlayerId } from './types'
import {
  cardInfo, cardName, drawCards, moveAndBattle, offsetTarget, otherPlayer,
  ownElementTerritoryCount, territoryCount, validDestination,
} from './logic'

export type MagicResult = { game: GameState, message: string, success: boolean }
const failure = (game: GameState, message: string): MagicResult => ({ game, message, success: false })

/** Cast options are evaluated when the spell is used, not when it is selected. */
export function magicTargetIndices(game: GameState, cardId: string, caster: PlayerId): number[] {
  if (cardId === 'LF-006') { // 血の騒ぎ / give rush to a friendly monster <=3 territory requirement
    return game.board.flatMap((cell, i) => {
      const mon = cell.monster
      const need = mon && cardInfo(mon.card.cardId)?.requiredTerritories
      return mon?.card.owner === caster && typeof need === 'number' && need <= 3 ? [i] : []
    })
  }
  if (cardId === 'LF-015') { // 追い風 / move a friendly monster on own territory forward
    return game.board.flatMap((cell, i) => {
      if (cell.monster?.card.owner !== caster || cell.territory?.owner !== caster) return []
      const target = offsetTarget(i, caster, '2')
      return target !== null && validDestination(game, i, target, caster) ? [i] : []
    })
  }
  if (cardId === 'LF-024') { // 激流 / force an enemy on a friendly water territory backward
    return game.board.flatMap((cell, i) => {
      if (cell.monster?.card.owner !== otherPlayer(caster) || cell.territory?.owner !== caster ||
        cardInfo(cell.territory.cardId)?.element !== '水') return []
      const displacedOwner = cell.monster.card.owner
      const target = offsetTarget(i, displacedOwner, '8')
      return target !== null && validDestination(game, i, target, displacedOwner) ? [i] : []
    })
  }
  return []
}

export function castMagic(
  game: GameState,
  spellInstanceId: string,
  options: { targetIndex?: number; discardInstanceId?: string } = {},
): MagicResult {
  const caster = game.activePlayer
  const player = game.players[caster]
  const spell = player.hand.find(c => c.instanceId === spellInstanceId)
  if (!spell) return failure(game, 'そのカードは手札にありません')
  if (game.winner) return failure(game, '対戦は終了しています')
  if (game.phase !== 'main') return failure(game, 'マジックはメインフェイズに使用してください')
  const data = cardInfo(spell.cardId)
  if (!data || data.category !== 'マジック') return failure(game, 'マジックカードではありません')
  if (typeof data.requiredTerritories !== 'number' || territoryCount(game, caster) < data.requiredTerritories) {
    return failure(game, `必要領土数が足りません（現在${territoryCount(game, caster)}枚／必要${data.requiredTerritories ?? '不明'}枚）`)
  }
  if (ownElementTerritoryCount(game, caster, data.element) === 0) {
    return failure(game, `${data.element}属性の自分の領土が1枚以上必要です`)
  }

  // Validate all targets and costs BEFORE moving the spell to the graveyard.
  let target: number | undefined
  let discarded: CardInstance | undefined
  if (spell.cardId === 'LF-023') {
    discarded = player.hand.find(c => c.instanceId === options.discardInstanceId && c.instanceId !== spell.instanceId)
    if (!discarded) return failure(game, '大海の恵み：捨てる手札を1枚選んでください')
  } else if (['LF-006', 'LF-015', 'LF-024'].includes(spell.cardId)) {
    target = options.targetIndex
    if (target === undefined || !magicTargetIndices(game, spell.cardId, caster).includes(target)) {
      return failure(game, `${cardName(spell.cardId)}：有効な対象を選んでください`)
    }
  } else {
    return failure(game, 'このマジックの効果はまだ実装されていません')
  }

  const afterCost = player.hand.filter(c => c.instanceId !== spell.instanceId && c.instanceId !== discarded?.instanceId)
  let next: GameState = {
    ...game,
    players: {
      ...game.players,
      [caster]: {
        ...player,
        hand: afterCost,
        graveyard: [...player.graveyard, spell, ...(discarded ? [discarded] : [])],
      }
    }
  }
  let message = `${cardName(spell.cardId)}を使用しました`
  if (spell.cardId === 'LF-023') {
    const handBefore = next.players[caster].hand.length
    next = drawCards(next, caster, 2)
    const drawn = next.players[caster].hand.length - handBefore
    message = `大海の恵み：${cardName(discarded!.cardId)}を捨てて${drawn}枚ドローしました`
  } else if (spell.cardId === 'LF-006') {
    const cell = next.board[target!]
    next = {
      ...next,
      board: next.board.map((c, i) => i === target ? {
        ...cell,
        monster: { ...cell.monster!, rushTurn: game.turn },
      } : c),
    }
    message = `血の騒ぎ：${cardName(cell.monster!.card.cardId)}に、このターン「突撃」を与えました`
  } else if (spell.cardId === 'LF-015' || spell.cardId === 'LF-024') {
    const from = target!
    const monster = next.board[from].monster!
    const direction = spell.cardId === 'LF-015' ? '2' : '8'
    const to = offsetTarget(from, monster.card.owner, direction)!
    const result = moveAndBattle(next, from, to, false)
    next = result.game
    if (spell.cardId === 'LF-015' && next.board[to].monster?.card.instanceId === monster.card.instanceId) {
      next = { ...next, board: next.board.map((c, i) => i === to ? {
        ...c, monster: { ...c.monster!, lockedTurn: game.turn },
      } : c) }
    }
    message = `${cardName(spell.cardId)}：${result.message}${spell.cardId === 'LF-015' ? '（このターンは追加移動不可）' : ''}`
  }
  return { game: next, message: next.winner ? `${message} ／ ${next.winReason}` : message, success: true }
}
