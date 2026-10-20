import { useEffect, useState } from 'react'
import { addCardToCell } from './game/cardPlacement'
import { equipMonsterInCell } from './game/equipment'
import { castMagic, magicTargetIndices } from './game/magic'
import { offerOgreAdvance, offerSummonEffect, resolveOptionalMonsterEffect, resolvePrakilorusSummonBattle } from './game/monsterEffects'
import {
  adjacent, attackAt, autoEquip, canMoveNow, cardImage, cardInfo, cardName,
  COLS, defenseAt, drawCards, legalMoves, moveAndBattle, offsetTarget,
  otherPlayer, ownElementTerritoryCount, territoryCount, validDestination,
} from './game/logic'
import { createInitialGameState } from './game/initialState'
import { DECK_ELEMENTS, createGameWithDecks } from './game/decks'
import { mulligan } from './game/setup'
import { placementTargets } from './game/placementTargets'
import { switchTurn } from './game/phaseFlow'
import { MovementArtwork } from './components/MovementArtwork'
import { visibleBoardIndices, visibleCoordinate, shouldRotateCard } from './game/view'
import type { DeckElement } from './game/decks'
import type { CardInstance, FieldCell, GameState, PlayerId } from './game/types'
import './App.css'

const BUILD_LABEL = 'v0.15.6 移動範囲画像反映版'

const PHASE_LABELS: Record<GameState['phase'], string> = {
  start: 'スタート', draw: 'ドロー', develop: '開拓', main: 'メイン', move: '移動', end: 'エンド',
}


function displayPlayer(playerId: PlayerId): string {
  return playerId === 'player1' ? 'プレイヤー1' : 'プレイヤー2'
}

// セーブデータは利用しない。ブラウザの更新・閉じて開き直した時は必ず最初から。
const LEGACY_SAVE_KEY = 'lane-frontier-local-v0.15'


function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState)
  const [started, setStarted] = useState(false)
  // 初手引き直しは各プレイヤー一度だけ。交代画面なし。
  const [setupStage, setSetupStage] = useState<'player1' | 'player2' | 'play'>('player1')
  const [mulliganSelected, setMulliganSelected] = useState<string[]>([])
  const [deckChoices, setDeckChoices] = useState<Record<PlayerId, DeckElement | null>>({ player1: null, player2: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [movingFrom, setMovingFrom] = useState<number | null>(null)
  const [inspect, setInspect] = useState<number | null>(null)
  const [inspectedEquipmentId, setInspectedEquipmentId] = useState<string | null>(null)
  const [zoomCardId, setZoomCardId] = useState<string | null>(null)
  const [testRemove, setTestRemove] = useState(false)
  const [message, setMessage] = useState('手札を選ぶか、フェイズを進めてください')

  const owner = game.activePlayer
  const player = game.players[owner]
  const opponent = game.players[otherPlayer(owner)]
  const selectedCard = player.hand.find(c => c.instanceId === selectedId)
  const destinations = movingFrom === null ? [] : legalMoves(game, movingFrom)
  const boardIndices = visibleBoardIndices(owner)
  const selectedData = selectedCard ? cardInfo(selectedCard.cardId) : null
  const magicTargets = selectedCard && selectedData?.category === 'マジック' && game.phase === 'main'
    ? magicTargetIndices(game, selectedCard.cardId, owner) : []
  const pendingEquipIndex = game.board.findIndex(cell => cell.monster && !cell.monster.equippedId && cell.equipments.length > 1)
  const pendingEquip = pendingEquipIndex >= 0 ? game.board[pendingEquipIndex] : null
  const placingTargets = selectedCard && selectedData?.category !== 'マジック' && !pendingEquip
    ? placementTargets(game, selectedCard, owner) : []
  const discardingForOcean = selectedCard?.cardId === 'LF-023' && game.phase === 'main'

  // v0.15.0で保存した古い盤面も一度消す。
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_SAVE_KEY) } catch { /* 保存にアクセスできなくても対戦可能 */ }
  }, [])

  useEffect(() => {
    if (!zoomCardId) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomCardId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomCardId])

  function toggleMulliganCard(instanceId: string) {
    setMulliganSelected(prev => prev.includes(instanceId)
      ? prev.filter(id => id !== instanceId) : [...prev, instanceId])
  }

  function finishMulligan() {
    if (setupStage !== 'player1' && setupStage !== 'player2') return
    const mulliganPlayer = setupStage
    setGame(prev => {
      const updated = mulligan(prev, mulliganPlayer, mulliganSelected)
      return mulliganPlayer === 'player2' ? { ...updated, phase: 'start' } : updated
    })
    setMulliganSelected([])
    setSetupStage(mulliganPlayer === 'player1' ? 'player2' : 'play')
    setMessage(mulliganSelected.length ? `${mulliganSelected.length}枚引き直しました` : '引き直しなしで開始します')
  }

  function resetSelection() {
    setSelectedId(null)
    setMovingFrom(null)
  }

  function useEquipment(cellIndex: number, equipmentId: string) {
    if (game.winner) return
    const cell = game.board[cellIndex]
    const updated = equipMonsterInCell(cell, equipmentId)
    if (!updated) { setMessage('この装備は使用できません'); return }
    let next: GameState = { ...game, board: game.board.map((c, i) => i === cellIndex ? updated : c) }
    const equipment = cell.equipments.find(c => c.instanceId === equipmentId)
    // 調和の槍：装備したモンスターの所有者が1枚ドロー。
    if (equipment?.cardId === 'LF-025' && updated.monster) {
      next = drawCards(next, updated.monster.card.owner, 1)
    }
    const settled = next
    setGame(settled)
    if (settled.activePlayer !== game.activePlayer) resetSelection()
    setMessage(`${cardName(equipment?.cardId ?? '')}を使用しました${settled.activePlayer !== game.activePlayer ? '。次のプレイヤーの開拓フェイズです' : ''}`)
  }

  function chooseMonsterEffect(activate: boolean) {
    if (game.winner || pendingEquip) return
    const result = resolveOptionalMonsterEffect(game, activate)
    const settled = result.game
    setGame(settled)
    setInspect(settled.activePlayer !== game.activePlayer ? null : game.pendingEffect?.cellIndex ?? null)
    if (settled.activePlayer !== game.activePlayer) resetSelection()
    setMessage(result.message)
  }

  function useMagic(card: CardInstance, options: { targetIndex?: number; discardInstanceId?: string }) {
    if (game.pendingEffect || pendingEquip) { setMessage('まずモンスターの効果か装備を選んでください'); return }
    const result = castMagic(game, card.instanceId, options)
    if (result.success) {
      setGame(result.game)
      resetSelection()
      if (options.targetIndex !== undefined) setInspect(options.targetIndex)
    }
    setMessage(result.message)
  }

  function discardCard() {
    if (game.winner || pendingEquip || game.pendingEffect || !selectedCard) return
    const removed = selectedCard
    setGame(prev => {
      const p = prev.players[prev.activePlayer]
      return { ...prev, players: { ...prev.players, [prev.activePlayer]: {
        ...p, hand: p.hand.filter(c => c.instanceId !== removed.instanceId), graveyard: [...p.graveyard, removed],
      } } }
    })
    setSelectedId(null)
    setMessage(`${cardName(removed.cardId)}を墓地へ送りました（テスト用）`)
  }

  function playCardAt(index: number, card: CardInstance) {
    if (game.winner || game.pendingEffect || pendingEquip) { setMessage('まず選択待ちの効果を解決してください'); return }
    const cardData = cardInfo(card.cardId)
    if (!cardData) { setMessage('カードデータが見つかりません'); return }
    const category = cardData.category
    const cell = game.board[index]
    const isTerritory = category === '基礎領土' || category === '特殊領土'
    const isMainAction = category === 'モンスター' || category === '装備'
    if (category === 'マジック') {
      if (card.cardId === 'LF-023') {
        setMessage('大海の恵み：手札の別のカードをクリックして捨ててください')
        return
      }
      useMagic(card, { targetIndex: index })
      return
    }
    if (isTerritory) {
      if (game.phase !== 'develop') { setMessage('領土は開拓フェイズに配置してください'); return }
      if (game.territoryPlayedThisTurn) { setMessage('このターンはすでに開拓しています'); return }
      if (cell.castleOwner || cell.territory) { setMessage('すでに城または領土が存在します'); return }
      const neighbors = adjacent(index)
      const connected = neighbors.some(i => game.board[i].castleOwner === owner || game.board[i].territory?.owner === owner)
      if (!connected) { setMessage('自分の城または領土に隣接させてください'); return }
      if (category === '特殊領土' && !neighbors.some(i => {
        const t = game.board[i].territory
        return t?.owner === owner && cardInfo(t.cardId)?.element === cardData.element
      })) { setMessage(`特殊領土は自分の${cardData.element}属性領土に隣接させてください`); return }
    }
    if (isMainAction) {
      if (game.phase !== 'main') { setMessage('召喚と装備はメインフェイズに行ってください'); return }
      if (game.mainActionUsedThisTurn) { setMessage('召喚と装備は合わせて1ターン1回です'); return }
      const required = cardData.requiredTerritories
      if (typeof required !== 'number' || territoryCount(game, owner) < required) {
        setMessage(`必要領土数が足りません（現在${territoryCount(game, owner)}枚／必要${required ?? '不明'}枚）`); return
      }
      if (cell.castleOwner || cell.territory?.owner !== owner) {
        setMessage('召喚と装備は自分の領土上に行ってください'); return
      }
      // 公式ルール：モンスターと装備の属性は領土と一致する必要がある。
      if (cardInfo(cell.territory.cardId)?.element !== cardData.element) {
        setMessage(`${cardData.element}属性の領土を選んでください`); return
      }
      // プラキロルスだけは、オルド海にいる敵モンスターへ重ねて召喚できる。
      if (category === 'モンスター' && cell.monster && !(
        card.cardId === 'LF-022' && cell.territory?.cardId === 'LF-026' &&
        cell.monster.card.owner !== owner
      )) {
        setMessage('この領土にはすでにモンスターがいます'); return
      }
    }

    const specialBattle = card.cardId === 'LF-022' && !!cell.monster
    // 特殊召喚の戦闘判定は、場のモンスターを書き換えた仮盤面で行う。
    const updated = specialBattle ? {
      ...cell, monster: { card, summonedTurn: game.turn, equippedId: null },
    } : addCardToCell(cell, card, game.turn)
    if (!updated) { setMessage('ここには配置できません'); return }
    // 強襲するワイバーン：火山に召喚したターンだけ突撃可能。
    if (card.cardId === 'LF-004' && cell.territory?.cardId === 'LF-008' && updated.monster) {
      updated.monster = { ...updated.monster, rushTurn: game.turn }
    }
    let next: GameState = {
      ...game,
      territoryPlayedThisTurn: game.territoryPlayedThisTurn || isTerritory,
      mainActionUsedThisTurn: game.mainActionUsedThisTurn || isMainAction,
      board: game.board.map((c, i) => i === index ? updated : c),
      players: { ...game.players, [owner]: {
        ...player, hand: player.hand.filter(c => c.instanceId !== card.instanceId),
      } },
    }
    // 調和の槍を直接プレイして自動装備された場合。
    if (card.cardId === 'LF-025' && updated.monster?.equippedId === card.instanceId) {
      next = drawCards(next, updated.monster.card.owner, 1)
    }
    // 既存の装備を1枚だけ持つ領土にモンスターを召喚した場合。
    if (category === 'モンスター' && updated.monster?.equippedId && updated.equipments.some(e => e.cardId === 'LF-025' && e.instanceId === updated.monster?.equippedId)) {
      next = drawCards(next, updated.monster.card.owner, 1)
    }
    let placementMessage = `${cardName(card.cardId)}を配置しました${updated.monster && updated.monster.equippedId === card.instanceId ? '（自動装備）' : ''}`
    if (specialBattle) {
      const result = resolvePrakilorusSummonBattle(game, next, index)
      if (!result.success) { setMessage(result.message); return }
      next = result.game
      placementMessage = result.message
    } else if (category === 'モンスター') {
      next = offerSummonEffect(next, index)
      if (next.pendingEffect) placementMessage += ' ／ 右側で任意効果を選択してください'
    }
    const settled = next
    setGame(settled)
    resetSelection()
    setInspect(index)
    setInspectedEquipmentId(null)
    setMessage(placementMessage)
  }

  function removeCellForTesting(index: number) {
    const cell = game.board[index]
    let removed: CardInstance | null = null
    let updated: FieldCell = cell
    if (cell.monster) {
      removed = cell.monster.card
      updated = { ...cell, monster: null }
    } else if (cell.equipments.length > 0) {
      removed = cell.equipments[cell.equipments.length - 1]
      updated = autoEquip({ ...cell, equipments: cell.equipments.slice(0, -1) })
    } else if (cell.territory) {
      removed = cell.territory
      updated = { ...cell, territory: null }
    }
    if (!removed) return
    const p = game.players[removed.owner]
    let next: GameState = {
      ...game,
      board: game.board.map((c, i) => i === index ? updated : c),
      players: { ...game.players, [removed.owner]: {
        ...p, graveyard: [...p.graveyard, removed],
      } },
    }
    // For test-only removal, changing to the only remaining equipment counts as equipping.
    const newlyEquipped = updated.monster?.equippedId
    if (newlyEquipped && newlyEquipped !== cell.monster?.equippedId) {
      const equipment = updated.equipments.find(e => e.instanceId === newlyEquipped)
      if (equipment?.cardId === 'LF-025') next = drawCards(next, updated.monster!.card.owner, 1)
    }
    setGame(next)
    setMessage(`${cardName(removed.cardId)}を墓地へ送りました（テスト操作）`)
  }

  function handleCellClick(index: number) {
    if (game.winner) return
    if (pendingEquip) { setMessage('まず使用する装備を1枚選んでください'); return }
    if (game.pendingEffect) { setMessage('まず右側でモンスターの任意効果を選んでください'); return }
    if (selectedCard) { playCardAt(index, selectedCard); return }
    if (testRemove) { removeCellForTesting(index); return }
    const cell = game.board[index]
    setInspect(index)
    setInspectedEquipmentId(null)
    if (game.phase === 'move') {
      if (movingFrom === index) { setMovingFrom(null); setMessage('選択を解除しました'); return }
      if (movingFrom !== null && destinations.includes(index)) {
        const result = moveAndBattle(game, movingFrom, index, true)
        const after = offerOgreAdvance(result.game, index, result.attackerWon)
        const settled = after
        setGame(settled)
        setMessage(result.message + (after.pendingEffect ? ' ／ 右側で追加前進するか選んでください' : ''))
        setInspect(settled.activePlayer !== game.activePlayer ? null : index)
        setMovingFrom(null)
        return
      }
      if (cell.monster?.card.owner === owner) {
        if (game.moveUsedThisTurn) { setMessage('このターンの通常移動は終了しています'); return }
        if (!canMoveNow(game, index)) {
          setMessage(cell.monster?.lockedTurn === game.turn
            ? 'このターンはマジックなどの効果でこれ以上移動できません'
            : '召喚したターンは通常移動できません')
          return
        }
        setMovingFrom(index)
        setInspect(index)
        const count = legalMoves(game, index).length
        setMessage(count ? `移動先を選んでください（${count}マスが候補）` : 'このモンスターには移動可能なマスがありません')
        return
      }
      if (movingFrom !== null) { setMessage('黄色い枠のマスを選んでください'); return }
    }
    setInspect(index)
    const inspected = cell.monster?.card ?? cell.territory
    setMessage(inspected ? `${cardName(inspected.cardId)}の情報を表示しています` : '空きマスです')
  }

  function nextPhase() {
    if (game.winner || pendingEquip || game.pendingEffect) { setMessage('先に装備またはモンスターの任意効果を選んでください'); return }
    let next: GameState
    if (game.phase === 'start') {
      next = game.turn === 1 ? { ...game, phase: 'draw' } : drawCards({ ...game, phase: 'draw' }, owner, 1)
    } else if (game.phase === 'draw') {
      next = { ...game, phase: 'develop' }
    } else if (game.phase === 'develop') {
      next = { ...game, phase: 'main' }
    } else if (game.phase === 'main') {
      next = { ...game, phase: 'move' }
    } else if (game.phase === 'move') {
      next = { ...game, phase: 'end' }
    } else {
      next = switchTurn(game)
    }
    setGame(next)
    resetSelection()
    setInspect(null)
    setInspectedEquipmentId(null)
    setMessage(next.winner ? `${displayPlayer(next.winner)}の勝利！ ${next.winReason}` : `${PHASE_LABELS[next.phase]}フェイズです`)
  }

  function loadDemo(kind: 'battle' | 'tie' | 'castle') {
    const next = createGameWithDecks(deckChoices.player1 ?? '火', deckChoices.player2 ?? '風')
    next.turn = 5
    next.phase = 'move'
    const heroId = kind === 'battle' ? 'LF-002' : 'LF-001'
    const enemyId = kind === 'tie' ? 'LF-012' : 'LF-010'
    const hero = { instanceId: 'demo-hero', cardId: heroId, owner: 'player1' as const }
    const foe = { instanceId: 'demo-foe', cardId: enemyId, owner: 'player2' as const }
    const from = kind === 'castle' ? 7 : 22
    const ownTerritory = { instanceId: 'demo-territory1', cardId: 'LF-009', owner: 'player1' as const }
    next.board[from] = { ...next.board[from], territory: ownTerritory, monster: {
      card: hero, summonedTurn: 1, equippedId: null,
    } }
    if (kind !== 'castle') {
      next.board[17] = {
        ...next.board[17],
        territory: { instanceId: 'demo-territory2', cardId: 'LF-018', owner: 'player2' },
        monster: { card: foe, summonedTurn: 1, equippedId: null },
      }
    }
    setGame(next)
    resetSelection()
    setInspect(from)
    setTestRemove(false)
    setMessage(kind === 'castle' ? '城への到達テスト：モンスターをクリック → 相手の城をクリック' :
      '戦闘テスト：下側のモンスターをクリック → 黄色い相手マスをクリック')
  }

  function loadMagicDemo(kind: 'rush' | 'wind' | 'ocean' | 'current') {
    const next = createGameWithDecks(deckChoices.player1 ?? '火', deckChoices.player2 ?? '風')
    const cardId = { rush: 'LF-006', wind: 'LF-015', ocean: 'LF-023', current: 'LF-024' }[kind]
    const elementTerritoryId = kind === 'rush' ? 'LF-009' : kind === 'wind' ? 'LF-018' : 'LF-027'
    const owner = 'player1' as const
    const indexes = kind === 'rush' || kind === 'wind' ? [22, 17, 21, 16, 12] : [22, 17, 12]
    for (const i of indexes) {
      next.board[i] = { ...next.board[i], territory: {
        instanceId: `magic-territory-${i}`, cardId: elementTerritoryId, owner,
      } }
    }
    next.turn = 5
    next.phase = 'main'
    next.activePlayer = owner
    next.players.player1.hand = [
      { instanceId: 'spell-demo', cardId, owner },
      { instanceId: 'magic-discard', cardId: 'LF-001', owner },
      { instanceId: 'magic-discard2', cardId: 'LF-027', owner },
    ]
    if (kind === 'rush' || kind === 'wind') {
      next.board[22].monster = {
        card: { instanceId: 'magic-hero', cardId: 'LF-001', owner },
        summonedTurn: kind === 'rush' ? 5 : 1, equippedId: null,
      }
    }
    if (kind === 'current') {
      next.board[17].monster = {
        card: { instanceId: 'magic-enemy', cardId: 'LF-010', owner: 'player2' },
        summonedTurn: 1, equippedId: null,
      }
    }
    setGame(next)
    resetSelection()
    setInspect(kind === 'current' ? 17 : 22)
    setTestRemove(false)
    setMessage(`マジック体験：手札の「${cardName(cardId)}」を選択して使ってください`)
  }

  function loadMonsterDemo(kind: 'ogre' | 'centaur' | 'mermaid' | 'prakilorus') {
    const next = createGameWithDecks(deckChoices.player1 ?? '火', deckChoices.player2 ?? '風')
    const owner: PlayerId = 'player1'
    const cardId = {
      ogre: 'LF-005', centaur: 'LF-013', mermaid: 'LF-020', prakilorus: 'LF-022',
    }[kind]
    const landId = kind === 'ogre' ? 'LF-009' : kind === 'centaur' ? 'LF-017' : 'LF-026'
    next.turn = 6
    next.phase = kind === 'ogre' ? 'move' : 'main'
    next.activePlayer = owner
    next.pendingEffect = null
    // Required 7 lands are supplied so the test always works without waiting for draws.
    for (const i of [22, 21, 20, 17, 16, 12, 11, 23]) {
      next.board[i] = { ...next.board[i], territory: {
        instanceId: `monster-land-${i}`, cardId: landId, owner,
      } }
    }
    next.players.player1.hand = [
      { instanceId: 'monster-demo-hand', cardId, owner },
      { instanceId: 'monster-demo-extra', cardId: 'LF-009', owner },
    ]
    if (kind === 'ogre') {
      next.board[22].monster = { card: { instanceId: 'monster-demo-ogre', cardId, owner }, summonedTurn: 1, equippedId: null }
      next.board[17].monster = { card: { instanceId: 'monster-demo-defender', cardId: 'LF-010', owner: 'player2' }, summonedTurn: 1, equippedId: null }
    } else if (kind === 'prakilorus') {
      next.board[22].monster = { card: { instanceId: 'monster-demo-defender', cardId: 'LF-010', owner: 'player2' }, summonedTurn: 1, equippedId: null }
    }
    setGame(next)
    resetSelection()
    setInspect(22)
    setTestRemove(false)
    setMessage(kind === 'ogre'
      ? 'オーガ体験：22マスのオーガを選び、17マスの敵を攻撃 → 右側で前進を選択'
      : `モンスター体験：手札の「${cardName(cardId)}」を選び、下側22マスの領土へ召喚`)
  }

  function loadEquipmentDemo(kind: 'carry' | 'drop' | 'borrow' | 'choose' | 'replace') {
    const next = createGameWithDecks(deckChoices.player1 ?? '火', deckChoices.player2 ?? '風')
    next.turn = 6
    next.phase = 'move'
    next.activePlayer = kind === 'borrow' ? 'player2' : 'player1'
    next.pendingEffect = null
    const land = (i: number, id: string, who: PlayerId) => {
      next.board[i] = { ...next.board[i], territory: {
        instanceId: `equip-demo-land-${i}`, cardId: id, owner: who,
      } }
    }
    const gear = (id: string, who: PlayerId, suffix: string): CardInstance => ({
      instanceId: `equip-demo-${suffix}`, cardId: id, owner: who,
    })
    if (kind === 'borrow') {
      land(12, 'LF-018', 'player2')
      land(17, 'LF-009', 'player1')
      next.board[12].monster = { card: gear('LF-010', 'player2', 'visitor'), summonedTurn: 1, equippedId: null }
      next.board[17].equipments = [gear('LF-007', 'player1', 'borrow-axe')]
    } else {
      land(22, 'LF-009', 'player1')
      land(17, kind === 'drop' ? 'LF-018' : 'LF-009', kind === 'drop' ? 'player2' : 'player1')
      const axe = gear('LF-007', kind === 'choose' ? 'player2' : 'player1', 'axe')
      const spear = gear('LF-025', 'player1', 'spear')
      next.board[22].monster = {
        card: gear('LF-001', 'player1', 'hero'), summonedTurn: 1,
        equippedId: kind === 'choose' ? null : axe.instanceId,
      }
      next.board[22].equipments = kind === 'choose' || kind === 'replace' ? [axe, spear] : [axe]
      if (kind === 'drop') {
        next.board[17].monster = {
          card: gear('LF-014', 'player2', 'defender'), summonedTurn: 1, equippedId: null,
        }
      }
    }
    setGame(next)
    resetSelection()
    setInspect(kind === 'borrow' ? 12 : 22)
    setTestRemove(false)
    setMessage({
      carry: '装備テスト：22マスのサラマンダーを選択し、17マスへ移動。斧も一緒に移動します。',
      drop: '装備テスト：22マスから17マスのグリフォンに攻撃。相討ち後、斧は17マスに残ります。',
      borrow: '装備テスト：プレイヤー2のアルミラージ（12マス）を17マスへ移動。相手所有の斧を自動使用します。',
      choose: '装備テスト：右側で使用する装備を選択。相手所有の斧も選べます。',
      replace: '装備テスト：斧使用中（ATK+2）。同じマスに槍があっても装備は切り替わりません。',
    }[kind])
  }

  function loadCombinationDemo(kind: 'stack' | 'windBattle' | 'currentBattle' | 'fallenSpear') {
    const next = createGameWithDecks(deckChoices.player1 ?? '火', deckChoices.player2 ?? '風')
    next.turn = 6
    next.phase = kind === 'windBattle' || kind === 'currentBattle' ? 'main' : 'move'
    next.activePlayer = 'player1'
    next.pendingEffect = null
    const piece = (id: string, who: PlayerId, suffix: string): CardInstance => ({
      instanceId: `combo-${kind}-${suffix}`, cardId: id, owner: who,
    })
    const land = (index: number, id: string, who: PlayerId) => {
      next.board[index] = { ...next.board[index], territory: piece(id, who, `land-${index}`) }
    }
    const monster = (index: number, id: string, who: PlayerId) => {
      next.board[index].monster = { card: piece(id, who, `monster-${index}`), summonedTurn: 1, equippedId: null }
    }
    const wear = (index: number, equipmentId: string, who: PlayerId) => {
      const gear = piece(equipmentId, who, `gear-${index}`)
      next.board[index].equipments.push(gear)
      next.board[index].monster!.equippedId = gear.instanceId
    }
    let focus = 22
    let instructions = ''
    if (kind === 'stack') {
      // Goblin gains +1 on enemy land, +2 from axe and +1 from an adjacent Treant.
      // Defender gets +1 DEF from its own Treant: 7 ATK against 5 DEF.
      land(17, 'LF-018', 'player2'); land(12, 'LF-018', 'player2')
      land(11, 'LF-009', 'player1'); land(13, 'LF-018', 'player2')
      monster(17, 'LF-003', 'player1'); wear(17, 'LF-007', 'player1')
      monster(11, 'LF-012', 'player1'); monster(13, 'LF-012', 'player2')
      monster(12, 'LF-014', 'player2')
      focus = 17
      instructions = '複合テスト：ゴブリンを選択 → 1マス前のグリフォンと戦闘。敵領土・斧・味方トレントと守備側トレントの効果を同時に確認します。'
    } else if (kind === 'windBattle') {
      // Wind can move a Centaur straight ahead even though the printed movement omits 2.
      for (const index of [22, 21, 20, 16, 23]) land(index, 'LF-018', 'player1')
      land(17, 'LF-018', 'player2')
      monster(22, 'LF-013', 'player1'); wear(22, 'LF-007', 'player1')
      monster(17, 'LF-014', 'player2')
      next.players.player1.hand = [piece('LF-015', 'player1', 'spell')]
      instructions = '複合テスト：手札の追い風を選択 → ケンタウロスをクリック。斧を持って前進・戦闘し、通常移動が禁止されるか確認します。'
    } else if (kind === 'currentBattle') {
      // The caster's magic forces an enemy to attack a friendly monster.
      for (const index of [22, 17, 12]) land(index, 'LF-027', 'player1')
      monster(17, 'LF-010', 'player2'); wear(17, 'LF-007', 'player1')
      monster(12, 'LF-019', 'player1')
      next.players.player1.hand = [piece('LF-024', 'player1', 'spell')]
      focus = 17
      instructions = '複合テスト：手札の激流を選択 → 斧を装備した敵アルミラージをクリック。装備ごと後退し、移動先で戦闘します。'
    } else {
      // The attacking Salamander falls, its spear is picked up by the defender.
      // LF-025 must draw for player2, the surviving new wearer.
      land(22, 'LF-009', 'player1'); land(17, 'LF-018', 'player2')
      monster(22, 'LF-001', 'player1'); wear(22, 'LF-025', 'player1')
      monster(17, 'LF-014', 'player2')
      instructions = '複合テスト：サラマンダーを選択 → グリフォンへ攻撃。敗北後、グリフォンが槍を拾いプレイヤー2が1枚引きます。'
    }
    setGame(next)
    resetSelection()
    setInspect(focus)
    setTestRemove(false)
    setMessage(instructions)
  }

  function newGame() {
    const first = deckChoices.player1
    const second = deckChoices.player2
    if (!first || !second) return
    setGame(createGameWithDecks(first, second))
    setSetupStage('player1')
    setMulliganSelected([])
    resetSelection()
    setInspect(null)
    setTestRemove(false)
    setMessage(`${first}デッキ 対 ${second}デッキ：新しい対戦を開始しました`)
  }

  function changeDecks() {
    setStarted(false)
    setSetupStage('player1')
    setMulliganSelected([])
    setDeckChoices({ player1: null, player2: null })
    setGame(createInitialGameState())
    resetSelection()
    setInspect(null)
    setTestRemove(false)
    setMessage('使うデッキを選んでください')
  }

  function startSelectedGame() {
    const first = deckChoices.player1
    const second = deckChoices.player2
    if (!first || !second) return
    setGame(createGameWithDecks(first, second))
    setStarted(true)
    setSetupStage('player1')
    setMulliganSelected([])
    resetSelection()
    setInspect(null)
    setTestRemove(false)
    setMessage(`${first}デッキ 対 ${second}デッキ：対戦開始！`)
  }

  if (!started) {
    return (
      <main className="game-app">
        <header className="game-header">
          <div>
            <h1>Lane Frontier</h1>
            <p>レーンフロンティア Web対戦版 <span className="test-tag">ローカルテスト</span> <span className="test-tag">{BUILD_LABEL}</span></p>
          </div>
        </header>
        <section className="deck-setup">
          <h2>デッキ選択</h2>
          <p>火・風・水から各プレイヤーのデッキを選択してください。現在は1台のPCで交互に操作するテスト版です。</p>
          <p className="deck-rule">各40枚：基礎領土16枚 ＋ それ以外の8種類を各3枚。開始時にシャッフルして7枚ドローします。</p>
          {(['player1', 'player2'] as const).map(playerId => (
            <div className="deck-player" key={playerId}>
              <h3>{displayPlayer(playerId)}のデッキ</h3>
              <div className="deck-options">
                {DECK_ELEMENTS.map(element => {
                  const base = { '火': 'LF-009', '風': 'LF-018', '水': 'LF-027' }[element]
                  const selected = deckChoices[playerId] === element
                  return (
                    <button type="button" key={element}
                      className={`deck-option ${selected ? 'chosen' : ''}`}
                      aria-pressed={selected}
                      onClick={() => setDeckChoices(prev => ({ ...prev, [playerId]: element }))}>
                      <img src={cardImage(base)} alt={`${element}属性の基礎領土`} />
                      <strong>{element}デッキ</strong>
                      <span>{selected ? '選択中 ✓' : '選択する'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="deck-setup-footer">
            <span>{deckChoices.player1 ?? '未選択'} vs {deckChoices.player2 ?? '未選択'}</span>
            <button type="button" className="phase-next" disabled={!deckChoices.player1 || !deckChoices.player2}
              onClick={startSelectedGame}>このデッキで対戦開始 →</button>
          </div>
        </section>
      </main>
    )
  }

  if (setupStage !== 'play') {
    const mulliganPlayer: PlayerId = setupStage === 'player1' ? 'player1' : 'player2'
    const hand = game.players[mulliganPlayer].hand
    return (
      <main className="game-app">
        <header className="game-header"><div><h1>Lane Frontier</h1><p>ゲームの準備・初手の引き直し <span className="test-tag">{BUILD_LABEL}</span></p></div></header>
        <section className="mulligan-screen">
          <div className="setup-progress">{mulliganPlayer === 'player1' ? '1 / 2' : '2 / 2'}　{displayPlayer(mulliganPlayer)}</div>
          <h2>{displayPlayer(mulliganPlayer)}：マリガン</h2>
          <p>最初の手札7枚から、引き直したいカードを選んでください。選んだ順番で城の一番下へ送り、同じ枚数を城の上から引きます。引き直しは1回だけです。</p>
          <div className="mulligan-hand">
            {hand.map(card => {
              const selectionOrder = mulliganSelected.indexOf(card.instanceId)
              return (
                <button type="button" key={card.instanceId}
                  className={`mulligan-card ${selectionOrder >= 0 ? 'mulligan-chosen' : ''}`}
                  aria-pressed={selectionOrder >= 0}
                  onClick={() => toggleMulliganCard(card.instanceId)}
                  title={`${cardName(card.cardId)}：クリックで選択・解除`}>
                  <img src={cardImage(card.cardId)} alt={cardName(card.cardId)} />
                  {selectionOrder >= 0 && <span className="mulligan-order">戻す順 {selectionOrder + 1}</span>}
                </button>
              )
            })}
          </div>
          <p className="mulligan-count">引き直すカード：{mulliganSelected.length}枚　／　初手7枚・城{game.players[mulliganPlayer].deck.length}枚</p>
          <button type="button" className="phase-next" onClick={finishMulligan}>
            {mulliganSelected.length > 0 ? `${mulliganSelected.length}枚引き直して確定 →` : '引き直さずに確定 →'}
          </button>
        </section>
      </main>
    )
  }

  if (pendingEquip?.monster && pendingEquip.monster.card.owner !== owner) {
    const chooser = pendingEquip.monster.card.owner
    return <main className="game-app equipment-handoff">
      <section className="mulligan-screen">
        <h1>装備の選択</h1>
        <h2>{displayPlayer(chooser)}が装備を選んでください</h2>
        <p>{cardName(pendingEquip.monster.card.cardId)}がいる領土には複数の装備があります。1枚選ぶまで対戦を進めません。</p>
        <div className="choice-list">{pendingEquip.equipments.map(e =>
          <button type="button" key={e.instanceId} className="equipment-handoff-card" onClick={() => useEquipment(pendingEquipIndex, e.instanceId)}>
            <img src={cardImage(e.cardId)} alt={cardName(e.cardId)} />
            <span>{cardName(e.cardId)}</span>
          </button>
        )}</div>
        <p>この画面では双方の手札を表示しません。</p>
      </section>
    </main>
  }

  const inspectedCell = inspect === null ? null : game.board[inspect]
  const inspectedCard = inspectedCell?.equipments.find(e => e.instanceId === inspectedEquipmentId)
    ?? inspectedCell?.monster?.card ?? inspectedCell?.territory

  return (
    <main className="game-app game-in-play">
      <header className="game-header">
        <div className="brand-line">
          <h1>Lane Frontier</h1>
          <span className="version-label">{BUILD_LABEL}</span>
        </div>
        <div className="game-header-actions">
          <button type="button" className="small-btn" onClick={changeDecks}>デッキ変更</button>
          <button type="button" className="small-btn" onClick={newGame}>再戦</button>
        </div>
      </header>

      <div className="status-bar" aria-label="現在の対戦状況">
        <strong className="turn-owner">{displayPlayer(owner)}の手番</strong>
        <span>ターン {game.turn}</span>
        <span className="phase-pill">{PHASE_LABELS[game.phase]}フェイズ</span>
        <span className="status-deck">{deckChoices[owner]}デッキ vs {deckChoices[otherPlayer(owner)]}デッキ</span>
      </div>
      {game.winner && <div className="winner-banner">{displayPlayer(game.winner)}の勝利！ {game.winReason}</div>}
      <div className="notice" role="status">{message}</div>

      <div className="game-layout">
        <section className="field-panel">
          <div className="panel-title"><h2>戦場</h2><span>{displayPlayer(owner)}視点</span></div>
          <div className="board-orientation"><span>↑ 相手の城</span></div>
          <p className="instruction">
            {selectedData?.category === 'マジック' ?
              selectedCard?.cardId === 'LF-023' ? '手札から捨てるカードをクリックしてください（もう一度マジックを押すと解除）' :
                `使用対象をクリック：${cardName(selectedCard?.cardId ?? '')}（水色の「対象」を選択）` :
              game.phase === 'move' ? '自分のモンスター → 黄色い移動先をクリック（1ターンに1体）' :
              selectedCard ? `配置先をクリック：${cardName(selectedCard.cardId)}` : '手札を選んでから、配置するマスをクリック'}
          </p>
          <div className="board-grid">
            {boardIndices.map(index => {
              const cell = game.board[index]
              const [viewRow, viewCol] = visibleCoordinate(index, owner)
              const isDestination = destinations.includes(index) && !testRemove && !selectedCard
              const isSelectedMonster = movingFrom === index
              const isMagicTarget = magicTargets.includes(index) && !testRemove
              const isPlacementTarget = placingTargets.includes(index) && !testRemove
              const used = cell.monster && !canMoveNow(game, index)
              return (
                <button type="button" key={index}
                  className={`field-cell ${cell.castleOwner === 'player1' ? 'castle1' : cell.castleOwner === 'player2' ? 'castle2' : ''} ${isDestination ? 'valid-move' : ''} ${isMagicTarget ? 'valid-magic' : ''} ${isPlacementTarget ? 'valid-placement' : ''} ${isSelectedMonster ? 'selected-monster' : ''} ${inspect === index ? 'inspected' : ''}`}
                  onClick={() => handleCellClick(index)}
                  title={`${viewRow}行${viewCol}列 ${cell.territory ? cardName(cell.territory.cardId) : ''} ${cell.monster ? cardName(cell.monster.card.cardId) : ''}`}
                >
                  {cell.castleOwner && <img className={`castle-back ${shouldRotateCard(cell.castleOwner, owner) ? 'enemy-card' : ''}`} src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt={`${displayPlayer(cell.castleOwner)}の城の裏面`} />}
                  {cell.castleOwner && <span className="castle-label">{cell.castleOwner === 'player1' ? '城1' : '城2'}</span>}
                  {cell.territory && <img className={`territory-img ${shouldRotateCard(cell.territory.owner, owner) ? 'enemy-card' : ''}`} src={cardImage(cell.territory.cardId)} alt={cardName(cell.territory.cardId)} />}
                  {cell.monster && <img className={`monster-img ${shouldRotateCard(cell.monster.card.owner, owner) ? 'enemy-card' : ''}`} src={cardImage(cell.monster.card.cardId)} alt={cardName(cell.monster.card.cardId)} />}
                  {cell.monster && <span className="stats">ATK {attackAt(game, index) ?? '?'} / DEF {defenseAt(game, index) ?? '?'}</span>}
                  {cell.equipments.length > 0 && <span className="equip-count">装備 {cell.equipments.length}</span>}
                  {cell.monster?.equippedId && <span className="equipped-mark" title="装備使用中">装備中</span>}
                  {used && game.phase === 'move' && <span className="no-move-mark">待機</span>}
                  {isDestination && <span className="move-target">{cell.castleOwner ? '勝利' : cell.monster ? '戦闘' : '移動'}</span>}
                  {isMagicTarget && <span className="move-target magic-target">対象</span>}
                  {isPlacementTarget && <span className="placement-target-label">配置</span>}
                </button>
              )
            })}
          </div>
          <p className="board-hint">↓ 自分の城</p>
        </section>

      <section className="hand-panel">
        <div className="panel-title"><h2>手札 <span className="count-label">{player.hand.length}枚</span></h2><span>クリックで選択 / 解除</span></div>
        <div className="hand-phase-controls">
          <div className="hand-phase-label" aria-live="polite">
            <strong>{displayPlayer(owner)}の手番</strong>
            <span>ターン {game.turn} ・ {PHASE_LABELS[game.phase]}フェイズ</span>
          </div>
          <button type="button" className="phase-next hand-phase-next" onClick={nextPhase}
            disabled={!!game.winner || !!pendingEquip || !!game.pendingEffect}>
            {game.phase === 'start' ? 'スタート終了 → ドロー' :
              game.phase === 'draw' ? 'ドロー終了 → 開拓' :
              game.phase === 'develop' ? '開拓終了 → メイン' :
              game.phase === 'main' ? 'メイン終了 → 移動' :
              game.phase === 'move' ? '移動終了 → エンド' :
              'エンド終了 → ターン交代'}
          </button>
        </div>
        <div className="hand-list">
          {player.hand.map(card => (
            <button type="button" key={card.instanceId} onClick={() => {
              if (discardingForOcean && selectedCard && card.instanceId !== selectedCard.instanceId) {
                useMagic(selectedCard, { discardInstanceId: card.instanceId }); return
              }
              setSelectedId(prev => prev === card.instanceId ? null : card.instanceId)
              setMovingFrom(null)
            }}
              className={`hand-card ${card.instanceId === selectedId ? 'selected-card' : ''} ${discardingForOcean && card.instanceId !== selectedCard?.instanceId ? 'discard-candidate' : ''}`}
              title={`${cardName(card.cardId)}（${cardInfo(card.cardId)?.category}／${cardInfo(card.cardId)?.element}）`}>
              <img src={cardImage(card.cardId)} alt={cardName(card.cardId)} />
            </button>
          ))}
        </div>
        <div className="hand-actions">
          <span>{discardingForOcean ? '大海の恵み：捨てるカードを手札から選んでください' : selectedCard ? `選択中：${cardName(selectedCard.cardId)}（${cardInfo(selectedCard.cardId)?.category}）` : '手札を選ぶと、右側にカード情報が表示されます'}</span>
          <span>城 {player.deck.length}枚 ・ 墓地 {player.graveyard.length}枚</span>
        </div>
      </section>
        <section className="side-panel">
          {game.pendingEffect && !pendingEquip && <div className="panel-card monster-choice">
            <h2>モンスターの任意効果</h2>
            <p>{game.pendingEffect.kind === 'centaur'
              ? 'ケンタウロスの騎兵：召喚時に1マス前進しますか？（移動先で戦闘する場合もあります）'
              : game.pendingEffect.kind === 'mermaid'
                ? '親和するマーメイド：召喚時に城から1枚引きますか？'
                : 'オーガの狂戦士：通常移動で戦闘に勝利しました。さらに1マス前進しますか？'}
            </p>
            <div className="choice-list">
              <button type="button" onClick={() => chooseMonsterEffect(true)}>効果を使う</button>
              <button type="button" className="skip-effect" onClick={() => chooseMonsterEffect(false)}>使わない</button>
            </div>
          </div>}
          {pendingEquip && <div className="panel-card equip-choice">
            <h2>使用する装備を選択</h2>
            <p>{cardName(pendingEquip.monster!.card.cardId)}が使用する装備を1枚選んでください。相手の装備も使用できます。</p>
            <div className="choice-list">{pendingEquip.equipments.map(card => (
              <button key={card.instanceId} onClick={() => useEquipment(pendingEquipIndex, card.instanceId)}>
                {cardName(card.cardId)}を使用（{displayPlayer(card.owner)}のカード）
              </button>
            ))}</div>
          </div>}
          <div className="panel-card overview-panel">
            <div className="panel-title"><h2>対戦状況</h2><span>相手の手札は非公開</span></div>
            <div className="duel-stats">
              <div><small>自分の城</small><strong>{player.deck.length}</strong><small>枚</small></div>
              <div><small>相手の城</small><strong>{opponent.deck.length}</strong><small>枚</small></div>
              <div><small>自分の領土</small><strong>{territoryCount(game, owner)}</strong><small>枚</small></div>
              <div><small>相手の領土</small><strong>{territoryCount(game, otherPlayer(owner))}</strong><small>枚</small></div>
            </div>
            <p className="duel-substats">相手手札 {opponent.hand.length}枚　｜　通常移動 {game.moveUsedThisTurn ? '実行済み' : '未実行'}</p>
          </div>
          <div className="panel-card focus-panel">
            <div className="panel-title"><h2>カード情報</h2><span>{selectedCard ? '手札から選択中' : inspectedCell ? '戦場から選択中' : 'カードをクリック'}</span></div>
            {(selectedCard || inspectedCard) ? (() => {
              const focused = selectedCard ?? inspectedCard!
              const data = cardInfo(focused.cardId)
              return (
                <>
                <div className="focus-preview">
                  <button type="button" className="focus-image-button" onClick={() => setZoomCardId(focused.cardId)} title="クリックでカードを大きく表示">
                    <img src={cardImage(focused.cardId)} alt={cardName(focused.cardId)} />
                    <span>拡大 <span aria-hidden="true">↗</span></span>
                  </button>
                  <div className="focus-description">
                    <strong>{cardName(focused.cardId)}</strong>
                    <span>{data?.element} / {data?.category}</span>
                    {typeof data?.attack === 'number' && <span>ATK {data.attack} / DEF {data.defense ?? '?'}</span>}
                    {typeof data?.requiredTerritories === 'number' && <span>必要領土数 {data.requiredTerritories}</span>}
                    <p>{data?.effectText || '効果なし'}</p>
                  </div>
                </div>
                <div className="movement-reference-wrapper">{data?.category === 'モンスター' && <div className="movement-reference">
                    <strong>移動範囲（カード右上の図）</strong>
                    <MovementArtwork src={cardImage(focused.cardId)} name={cardName(focused.cardId)} />
                    <small>記載方向：{data.movement || 'なし'}{inspectedCell?.monster?.card.instanceId === focused.instanceId && inspectedCell.monster.equippedId &&
                    inspectedCell.equipments.find(e => e.instanceId === inspectedCell.monster?.equippedId)?.cardId === 'LF-016' ? ' ／ 羽付きブーツで2を追加' : ''}</small>
                  </div>}
                </div>
                </>
              )
            })() : <p className="focus-empty">手札または戦場のカードをクリックすると、ここに拡大表示します。</p>}
            {inspectedCell && inspectedCell.equipments.length > 0 && <div className="equipment-gallery">
              <strong>このマスの装備（{inspectedCell.equipments.length}枚）</strong>
              <div className="equipment-gallery-list">
                {inspectedCell.equipments.map(e => <button type="button" key={e.instanceId}
                  className={`equipment-preview ${inspectedEquipmentId === e.instanceId ? 'equipment-selected' : ''}`}
                  onClick={() => { setSelectedId(null); setInspectedEquipmentId(e.instanceId); setMessage(`${cardName(e.cardId)}の情報を表示しています`) }}
                  title={`${cardName(e.cardId)}：クリックで情報を表示`}>
                    <img src={cardImage(e.cardId)} alt={cardName(e.cardId)} />
                    <span>{cardName(e.cardId)}{e.instanceId === inspectedCell.monster?.equippedId ? '（使用中）' : ''}</span>
                  </button>)}
              </div>
            </div>}
          </div>
          {inspectedCell && <details className="panel-card square-details">
            <summary>選択したマスの詳細</summary>
            <p>{inspect === null ? '' : `${visibleCoordinate(inspect, owner)[0]}行 ${visibleCoordinate(inspect, owner)[1]}列（手番側から）`}</p>
            <p>領土：{inspectedCell.territory ? cardName(inspectedCell.territory.cardId) : 'なし'}</p>
            <p>モンスター：{inspectedCell.monster ? cardName(inspectedCell.monster.card.cardId) : 'なし'}</p>
            <p>使用中：{inspectedCell.monster?.equippedId ? cardName(inspectedCell.equipments.find(e => e.instanceId === inspectedCell.monster?.equippedId)?.cardId ?? '') : 'なし'}</p>
            <p>設置された装備：{inspectedCell.equipments.map(e => `${cardName(e.cardId)}（${displayPlayer(e.owner)}）`).join('、') || 'なし'}</p>
          </details>}
          <details className="panel-card demo-panel dev-drawer">
            <summary>開発用テストを表示</summary>
            <p>テスト盤面を読み込むと現在の対戦はリセットされます。</p>
            <label className="test-option"><input type="checkbox" checked={testRemove} onChange={(e: { target: { checked: boolean } }) => { setTestRemove(e.target.checked); resetSelection() }} />選んだマスのカードを墓地へ送る（テスト）</label>
            <button type="button" onClick={discardCard} disabled={!selectedCard || !!pendingEquip || !!game.pendingEffect || !!game.winner} className="discard-btn">選択した手札を墓地へ（テスト）</button>
            <div className="choice-list">
              <button onClick={() => loadDemo('battle')}>戦闘（勝利）</button>
              <button onClick={() => loadDemo('tie')}>戦闘（相討ち）</button>
              <button onClick={() => loadDemo('castle')}>城への到達</button>
              <button onClick={() => loadMagicDemo('rush')}>マジック：血の騒ぎ</button>
              <button onClick={() => loadMagicDemo('wind')}>マジック：追い風</button>
              <button onClick={() => loadMagicDemo('ocean')}>マジック：大海の恵み</button>
              <button onClick={() => loadMagicDemo('current')}>マジック：激流</button>
              <button onClick={() => loadMonsterDemo('ogre')}>固有効果：オーガ</button>
              <button onClick={() => loadMonsterDemo('centaur')}>固有効果：ケンタウロス</button>
              <button onClick={() => loadMonsterDemo('mermaid')}>固有効果：マーメイド</button>
              <button onClick={() => loadMonsterDemo('prakilorus')}>固有効果：プラキロルス</button>
              <button onClick={() => loadEquipmentDemo('carry')}>装備：持って移動</button>
              <button onClick={() => loadEquipmentDemo('drop')}>装備：戦闘後に残る</button>
              <button onClick={() => loadEquipmentDemo('borrow')}>装備：相手の装備を使用</button>
              <button onClick={() => loadEquipmentDemo('choose')}>装備：2枚から選ぶ</button>
              <button onClick={() => loadEquipmentDemo('replace')}>装備：交換しない</button>
              <button onClick={() => loadCombinationDemo('stack')}>複合：ゴブリン×斧×トレント</button>
              <button onClick={() => loadCombinationDemo('windBattle')}>複合：追い風×装備×戦闘</button>
              <button onClick={() => loadCombinationDemo('currentBattle')}>複合：激流×敵の装備×戦闘</button>
              <button onClick={() => loadCombinationDemo('fallenSpear')}>複合：戦闘後に槍を引き継ぐ</button>
            </div>
          </details>
          <details className="panel-card grave-drawer">
            <summary>墓地を見る（自分 {player.graveyard.length}枚 / 相手 {opponent.graveyard.length}枚）</summary>
            <strong>自分の墓地</strong>
            <div className="grave-list">{player.graveyard.map(card => <img key={card.instanceId} src={cardImage(card.cardId)} alt={cardName(card.cardId)} title={cardName(card.cardId)} />)}</div>
            <strong>相手の墓地</strong>
            <div className="grave-list">{opponent.graveyard.map(card => <img key={card.instanceId} src={cardImage(card.cardId)} alt={cardName(card.cardId)} title={cardName(card.cardId)} />)}</div>
          </details>
        </section>
      </div>
      {zoomCardId && <div className="card-zoom-overlay" role="presentation" onMouseDown={() => setZoomCardId(null)}>
        <div className="card-zoom-dialog" role="dialog" aria-modal="true" aria-label={`${cardName(zoomCardId)}の拡大表示`} onMouseDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
          <button type="button" className="card-zoom-close" onClick={() => setZoomCardId(null)} aria-label="閉じる">×</button>
          <img src={cardImage(zoomCardId)} alt={cardName(zoomCardId)} />
          <strong>{cardName(zoomCardId)}</strong>
        </div>
      </div>}
    </main>
  )
}

export default App
