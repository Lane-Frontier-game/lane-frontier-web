import type { CardInstance, GameState, PlayerId } from './types'

/**
 * 公式の初手引き直し（1プレイヤーにつき1回）。
 * 選んだカードを指定した順に城の一番下へ置き、その枚数を城の上から引く。
 * この関数自体は履歴管理しない。UIで各プレイヤーにつき一度だけ呼び出す。
 */
export function mulligan(game: GameState, playerId: PlayerId, selectedInstanceIds: string[]): GameState {
  const player = game.players[playerId]
  if (new Set(selectedInstanceIds).size !== selectedInstanceIds.length) {
    throw new Error('同じカードを重複して選択できません')
  }
  const byId = new Map(player.hand.map(card => [card.instanceId, card]))
  const selected: CardInstance[] = selectedInstanceIds.map(id => {
    const card = byId.get(id)
    if (!card) throw new Error('手札にないカードをマリガンできません')
    return card
  })
  if (player.deck.length < selected.length) throw new Error('城の残りが不足しています')
  if (selected.length === 0) return game
  const selectedSet = new Set(selectedInstanceIds)
  const nextHand = [
    ...player.hand.filter(card => !selectedSet.has(card.instanceId)),
    ...player.deck.slice(0, selected.length),
  ]
  const nextDeck = [
    ...player.deck.slice(selected.length),
    ...selected,
  ]
  return {
    ...game,
    players: {
      ...game.players,
      [playerId]: { ...player, hand: nextHand, deck: nextDeck },
    },
  }
}
