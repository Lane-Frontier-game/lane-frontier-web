import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { addCardToCell } from './game/cardPlacement'
import { equipMonsterInCell } from './game/equipment'
import { castMagic, magicTargetIndices } from './game/magic'
import { offerOgreAdvance, offerSummonEffect, resolveOptionalMonsterEffect, resolvePrakilorusSummonBattle } from './game/monsterEffects'
import {
  adjacent, attackAt, canMoveNow, cardImage, cardInfo, cardName,
  COLS, defenseAt, drawCards, legalMoves, moveAndBattle, offsetTarget,
  otherPlayer, ownElementTerritoryCount, territoryCount, validDestination,
} from './game/logic'
import { createInitialGameState } from './game/initialState'
import { DECK_ELEMENTS, createGameWithDecks, deckRecipe } from './game/decks'
import { mulligan } from './game/setup'
import { placementTargets } from './game/placementTargets'
import { switchTurn } from './game/phaseFlow'
import { visibleBoardIndices, shouldRotateCard } from './game/view'
import type { DeckElement } from './game/decks'
import type { CardInstance, GameState, PlayerId } from './game/types'
import { useOnlineRoom } from './online/useOnlineRoom'
import { artworkImage } from './artworkManifest'
import { MovementArtwork } from './components/MovementArtwork'
import { isOnlineConfigured } from './online/config'
import './App.css'

const BUILD_LABEL = 'v0.20.2 領土の所有者表示'

const PHASE_LABELS: Record<GameState['phase'], string> = {
  start: 'スタート', draw: 'ドロー', develop: '開拓', main: 'メイン', move: '移動', end: 'エンド',
}


// 印刷されたカードの基本値と盤面上の実効値を比較し、表示色だけを変える。
function statChangeClass(current: number | null, base: number | null | undefined): string {
  if (typeof current !== 'number' || typeof base !== 'number') return ''
  if (current > base) return 'stat-buffed'
  if (current < base) return 'stat-debuffed'
  return ''
}

function displayPlayer(playerId: PlayerId): string {
  return playerId === 'player1' ? 'プレイヤー1' : 'プレイヤー2'
}

// セーブデータは利用しない。ブラウザの更新・閉じて開き直した時は必ず最初から。
const LEGACY_SAVE_KEY = 'lane-frontier-local-v0.15'


type MoveIntent = { from: number; to: number; instanceId: string; cardId: string; owner: PlayerId }
type BoardMoveCue = MoveIntent & {
  stamp: number; survives: boolean; battle: boolean
  left: number; top: number; width: number; height: number; dx: number; dy: number
}
type DeckDrawCue = { stamp: number; id: string; left: number; top: number; width: number; height: number; dx: number; dy: number; delayMs: number }
type GraveFlyCue = {
  stamp: number; cardId: string; instanceId: string; owner: PlayerId
  left: number; top: number; width: number; height: number
  dx: number; dy: number; delayMs: number
}

type MulliganPreview = { playerId: PlayerId; selectedIds: string[]; game: GameState; drawnIds: string[] }

type VisualKind = 'turn' | 'phase' | 'draw' | 'deploy' | 'summon' | 'move' | 'battle' | 'victory'
type VisualCue = { kind: VisualKind; title: string; subtitle: string; artworkId?: string; stamp: number }
type ViewSnapshot = {
  turn: number; phase: GameState['phase']; activePlayer: PlayerId; winner: PlayerId | null
  moveUsedThisTurn: boolean
  handCount: Record<PlayerId, number>
  graveMagic: Record<PlayerId, Array<{ instanceId: string; cardId: string }>>
  graveMonsters: Record<PlayerId, Array<{ instanceId: string; cardId: string; owner: PlayerId }>>
  board: Array<{ monster?: string; monsterOwner?: PlayerId; territory?: string; monsterId?: string; territoryId?: string; equippedId?: string | null; equipments: Array<{ instanceId: string; cardId: string }> }>
}
function snapshot(state: GameState): ViewSnapshot {
  return {
    turn: state.turn, phase: state.phase, activePlayer: state.activePlayer, winner: state.winner,
    moveUsedThisTurn: state.moveUsedThisTurn,
    handCount: { player1: state.players.player1.hand.length, player2: state.players.player2.hand.length },
    graveMagic: {
      player1: state.players.player1.graveyard.filter(c => cardInfo(c.cardId)?.category === 'マジック').map(c => ({ instanceId: c.instanceId, cardId: c.cardId })),
      player2: state.players.player2.graveyard.filter(c => cardInfo(c.cardId)?.category === 'マジック').map(c => ({ instanceId: c.instanceId, cardId: c.cardId })),
    },
    graveMonsters: {
      player1: state.players.player1.graveyard.filter(c => cardInfo(c.cardId)?.category === 'モンスター').map(c => ({ instanceId: c.instanceId, cardId: c.cardId, owner: c.owner })),
      player2: state.players.player2.graveyard.filter(c => cardInfo(c.cardId)?.category === 'モンスター').map(c => ({ instanceId: c.instanceId, cardId: c.cardId, owner: c.owner })),
    },
    board: state.board.map(c => ({
      monster: c.monster?.card.instanceId, monsterId: c.monster?.card.cardId, monsterOwner: c.monster?.card.owner,
      territory: c.territory?.instanceId, territoryId: c.territory?.cardId,
      equippedId: c.monster?.equippedId, equipments: c.equipments.map(e => ({instanceId: e.instanceId, cardId: e.cardId})),
    })),
  }
}

function App() {
  const [game, setGameLocal] = useState<GameState>(createInitialGameState)
  const [screen, setScreen] = useState<'home' | 'local' | 'online' | 'decks'>('home')
  const [onlineMode, setOnlineMode] = useState(false)
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const online = useOnlineRoom()
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
  const [message, setMessage] = useState('手札を選ぶか、フェイズを進めてください')
  const [visualCue, setVisualCue] = useState<VisualCue | null>(null)
  const [effectsEnabled, setEffectsEnabled] = useState(true)
  const [deckBrowseElement, setDeckBrowseElement] = useState<DeckElement>('火')
  const [deckBrowseCardId, setDeckBrowseCardId] = useState<string>('LF-009')
  const [mulliganRevealCount, setMulliganRevealCount] = useState(0)
  const [mulliganSorted, setMulliganSorted] = useState(false)
  const [mulliganSortComplete, setMulliganSortComplete] = useState(false)
  const [mulliganPreview, setMulliganPreview] = useState<MulliganPreview | null>(null)
  const mulliganHandRef = useRef<HTMLDivElement | null>(null)
  const mulliganSortStart = useRef<Map<string, DOMRect> | null>(null)
  const [phaseLocked, setPhaseLocked] = useState(false)
  const phaseLockRef = useRef(false)
  const phaseLockTimer = useRef<number | null>(null)
  const phaseClock = useRef({ key: '', at: Date.now() })
  const [equipmentCue, setEquipmentCue] = useState<{ cardId: string; cellIndex: number; stamp: number } | null>(null)
  const [equipmentImpactCells, setEquipmentImpactCells] = useState<number[]>([])
  const [magicCue, setMagicCue] = useState<{ cardId: string; stamp: number } | null>(null)
  // 盤面の移動は中央カットインを使わず、フィールド内で画像が移動する。
  const boardRef = useRef<HTMLDivElement | null>(null)
  const moveIntentRef = useRef<MoveIntent | null>(null)
  const specialBattleTargetRef = useRef<number | null>(null)
  const [boardMoveCue, setBoardMoveCue] = useState<BoardMoveCue | null>(null)
  const [pendingSpellMove, setPendingSpellMove] = useState<MoveIntent | null>(null)
  const [moveImpactCells, setMoveImpactCells] = useState<number[]>([])
  const [graveFlyCues, setGraveFlyCues] = useState<GraveFlyCue[]>([])
  const [optionalEffectCue, setOptionalEffectCue] = useState<{ cardId: string; stamp: number } | null>(null)
  const moveTimers = useRef<number[]>([])
  const graveTimer = useRef<number | null>(null)
  const spellMoveTimer = useRef<number | null>(null)
  const delayedVictoryTimer = useRef<number | null>(null)
  const [magicTargetCells, setMagicTargetCells] = useState<number[]>([])
  const [summonCells, setSummonCells] = useState<number[]>([])
  const [flashCells, setFlashCells] = useState<number[]>([])
  const [newHandCards, setNewHandCards] = useState<string[]>([])
  const [deckDrawCues, setDeckDrawCues] = useState<DeckDrawCue[]>([])
  const deckDrawTimer = useRef<number | null>(null)
  const previousSnapshot = useRef<ViewSnapshot | null>(null)
  const previousHandCards = useRef<Record<PlayerId, string[]>>({ player1: [], player2: [] })
  const cueCounter = useRef(0)

  const owner = onlineMode && online.session ? online.session.seat : game.activePlayer
  const isMyTurn = !onlineMode || (online.room?.stage === 'playing' && online.session?.seat === game.activePlayer)
  const equipmentOwner = game.board.find(cell => cell.monster && !cell.monster.equippedId && cell.equipments.length > 1)?.monster?.card.owner
  const canResolveEquipment = onlineMode && !!online.session && online.room?.stage === 'playing' && equipmentOwner === online.session.seat
  const canAct = isMyTurn || canResolveEquipment

  function setGame(update: GameState | ((prev: GameState) => GameState)) {
    if (onlineMode && online.session) {
      if (!canAct || online.busy) return
      const next = typeof update === 'function' ? update(game) : update
      online.commit(next, 'action')
    } else {
      setGameLocal(update)
    }
  }

  useEffect(() => {
    if (!onlineMode || !online.session || !online.room?.gameJson) return
    try {
      const next = JSON.parse(online.room.gameJson) as GameState
      setGameLocal(next)
      setDeckChoices({ player1: online.room.decks.player1 || null, player2: online.room.decks.player2 || null })
      setSetupStage(online.room.stage === 'playing' ? 'play' : online.session.seat)
      setStarted(true)
      setMovingFrom(null)
      setSelectedId(null)
    } catch {
      setMessage('オンライン対戦のデータを読み込めませんでした')
    }
  }, [onlineMode, online.session?.code, online.session?.seat, online.room?.gameJson, online.room?.stage])

  const player = game.players[owner]
  const sortedHand = [...player.hand].sort((a, b) => a.cardId.localeCompare(b.cardId) || a.instanceId.localeCompare(b.instanceId))
  const opponent = game.players[otherPlayer(owner)]
  const selectedCard = player.hand.find(c => c.instanceId === selectedId)
  const destinations = !isMyTurn || movingFrom === null ? [] : legalMoves(game, movingFrom)
  const boardIndices = visibleBoardIndices(owner)
  const selectedData = selectedCard ? cardInfo(selectedCard.cardId) : null
  const magicTargets = isMyTurn && selectedCard && selectedData?.category === 'マジック' && game.phase === 'main'
    ? magicTargetIndices(game, selectedCard.cardId, owner) : []
  const pendingEquipIndex = game.board.findIndex(cell => cell.monster && !cell.monster.equippedId && cell.equipments.length > 1)
  const pendingEquip = pendingEquipIndex >= 0 ? game.board[pendingEquipIndex] : null
  const placingTargets = isMyTurn && selectedCard && selectedData?.category !== 'マジック' && !pendingEquip
    ? placementTargets(game, selectedCard, owner) : []
  const discardingForOcean = isMyTurn && selectedCard?.cardId === 'LF-023' && game.phase === 'main'

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

  function releasePhaseLock() {
    if (phaseLockTimer.current !== null) window.clearTimeout(phaseLockTimer.current)
    phaseLockTimer.current = null
    phaseLockRef.current = false
    setPhaseLocked(false)
  }

  function lockPhase(kind: 'turn' | 'phase' | 'draw' | 'deploy' | 'move' | 'combat' | 'equipment' | 'spell' | 'spellmove') {
    if (!effectsEnabled) return
    if (phaseLockTimer.current !== null) window.clearTimeout(phaseLockTimer.current)
    phaseLockRef.current = true
    setPhaseLocked(true)
    phaseLockTimer.current = window.setTimeout(() => {
      phaseLockTimer.current = null
      phaseLockRef.current = false
      setPhaseLocked(false)
    }, kind === 'spellmove' ? 2800 : kind === 'spell' ? 1400 : kind === 'combat' ? 1650 : kind === 'turn' ? 1500 : kind === 'equipment' ? 1450 : kind === 'move' ? 1250 : kind === 'deploy' ? 1200 : 950)
  }

  function clearBoardMove() {
    if (spellMoveTimer.current !== null) window.clearTimeout(spellMoveTimer.current)
    spellMoveTimer.current = null
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    graveTimer.current = null
    setGraveFlyCues([])
    setPendingSpellMove(null)
    moveTimers.current.forEach(window.clearTimeout)
    moveTimers.current = []
    moveIntentRef.current = null
    specialBattleTargetRef.current = null
    setBoardMoveCue(null)
    setMoveImpactCells([])
  }

  function animateGraveyardFlight(deaths: Array<{ cardId: string; instanceId: string; owner: PlayerId; cellIndex: number }>, delayMs: number) {
    if (!effectsEnabled || !boardRef.current || !deaths.length) return
    const boardRect = boardRef.current.getBoundingClientRect()
    const cues = deaths.flatMap((dead, i): GraveFlyCue[] => {
      const cell = boardRef.current?.querySelector<HTMLElement>(`[data-board-index="${dead.cellIndex}"]`)
      if (!cell) return []
      const rect = cell.getBoundingClientRect()
      // 飛び先は盤面右上の「墓地」サイン。プレイヤーごとの実データには干渉しない。
      const x = rect.left - boardRect.left + rect.width / 2
      const y = rect.top - boardRect.top + rect.height / 2
      return [{ ...dead, stamp: ++cueCounter.current,
        left: rect.left - boardRect.left, top: rect.top - boardRect.top,
        width: rect.width, height: rect.height,
        dx: boardRect.width - 30 - x, dy: 12 - y,
        delayMs: delayMs + i * 90 }]
    })
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    setGraveFlyCues(cues)
    graveTimer.current = window.setTimeout(() => { setGraveFlyCues([]); graveTimer.current = null }, delayMs + 1050 + deaths.length * 90)
  }

  function animateBoardMove(intent: MoveIntent, survives: boolean, battle: boolean) {
    if (!effectsEnabled) return
    const fromEl = boardRef.current?.querySelector<HTMLElement>(`[data-board-index="${intent.from}"]`)
    const toEl = boardRef.current?.querySelector<HTMLElement>(`[data-board-index="${intent.to}"]`)
    if (!fromEl || !toEl || !boardRef.current) return
    const boardRect = boardRef.current.getBoundingClientRect()
    const from = fromEl.getBoundingClientRect()
    const to = toEl.getBoundingClientRect()
    moveTimers.current.forEach(window.clearTimeout)
    moveTimers.current = []
    setMoveImpactCells([])
    setBoardMoveCue({ ...intent, stamp: ++cueCounter.current, survives, battle,
      left: from.left - boardRect.left, top: from.top - boardRect.top,
      width: from.width, height: from.height,
      dx: (to.left + to.width / 2) - (from.left + from.width / 2),
      dy: (to.top + to.height / 2) - (from.top + from.height / 2),
    })
    // 飛び込み（約0.34秒）から着地点だけ「パン」と発光。
    moveTimers.current.push(window.setTimeout(() => setMoveImpactCells([intent.to]), 345))
    moveTimers.current.push(window.setTimeout(() => setBoardMoveCue(null), 575))
    moveTimers.current.push(window.setTimeout(() => { setMoveImpactCells([]); moveTimers.current = [] }, 930))
  }

  useEffect(() => () => {
    moveTimers.current.forEach(window.clearTimeout)
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    if (spellMoveTimer.current !== null) window.clearTimeout(spellMoveTimer.current)
    if (delayedVictoryTimer.current !== null) window.clearTimeout(delayedVictoryTimer.current)
    if (deckDrawTimer.current !== null) window.clearTimeout(deckDrawTimer.current)
  }, [])

  useEffect(() => () => { if (phaseLockTimer.current !== null) window.clearTimeout(phaseLockTimer.current) }, [])
  useEffect(() => { if (!effectsEnabled) releasePhaseLock() }, [effectsEnabled])

  function finishMulligan() {
    if (mulliganPreview || !mulliganSorted) return
    if (onlineMode && (online.busy || online.room?.stage !== 'mulligan' || !online.session || online.room.mulliganDone[online.session.seat])) return
    const playerId: PlayerId = onlineMode && online.session ? online.session.seat : setupStage === 'player1' ? 'player1' : 'player2'
    const updated = mulligan(game, playerId, mulliganSelected)
    const originalIds = new Set(game.players[playerId].hand.map(card => card.instanceId))
    const drawnIds = updated.players[playerId].hand.filter(card => !originalIds.has(card.instanceId)).map(card => card.instanceId)
    setMulliganSorted(false)
    setMulliganSortComplete(false)
    setMulliganRevealCount(0)
    setMulliganPreview({ playerId, selectedIds: [...mulliganSelected], game: updated, drawnIds })
  }

  function confirmMulliganPreview() {
    if (!mulliganPreview || !mulliganSorted || online.busy) return
    const { playerId, selectedIds } = mulliganPreview
    if (onlineMode && online.session) {
      if (online.room?.stage !== 'mulligan' || online.room.mulliganDone[playerId]) return
      // 最新の部屋状態を基準に再計算し、先に確定した相手の手札を上書きしない。
      online.commit(mulligan(game, playerId, selectedIds), 'mulligan')
      return
    }
    if (setupStage !== playerId) return
    setGame(prev => {
      const updated = mulligan(prev, playerId, selectedIds)
      return playerId === 'player2' ? { ...updated, phase: 'start' } : updated
    })
    setMulliganPreview(null)
    setMulliganSelected([])
    setSetupStage(playerId === 'player1' ? 'player2' : 'play')
    setMessage(selectedIds.length ? `${selectedIds.length}枚引き直しました` : '引き直しなしで開始します')
  }

  function resetSelection() {
    setSelectedId(null)
    setMovingFrom(null)
  }

  function useEquipment(cellIndex: number, equipmentId: string) {
    if (!canAct || online.busy || game.winner) return
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
    if (!isMyTurn || online.busy || game.winner || pendingEquip) return
    const pending = game.pendingEffect
    const origin = pending ? game.board[pending.cellIndex]?.monster : null
    if (activate && pending && origin) {
      setOptionalEffectCue({ cardId: origin.card.cardId, stamp: ++cueCounter.current })
      if (pending.kind !== 'mermaid') {
        const to = offsetTarget(pending.cellIndex, origin.card.owner, '2')
        if (to !== null) moveIntentRef.current = { from: pending.cellIndex, to,
          instanceId: origin.card.instanceId, cardId: origin.card.cardId, owner: origin.card.owner }
      }
    }
    const result = resolveOptionalMonsterEffect(game, activate)
    if (!result.success) { moveIntentRef.current = null; setOptionalEffectCue(null) }
    const settled = result.game
    setGame(settled)
    setInspect(settled.activePlayer !== game.activePlayer ? null : game.pendingEffect?.cellIndex ?? null)
    if (settled.activePlayer !== game.activePlayer) resetSelection()
    setMessage(result.message)
  }

  function useMagic(card: CardInstance, options: { targetIndex?: number; discardInstanceId?: string }) {
    if (!isMyTurn || online.busy) return
    if (game.pendingEffect || pendingEquip) { setMessage('まずモンスターの効果か装備を選んでください'); return }
    const result = castMagic(game, card.instanceId, options)
    if (result.success) {
      if ((card.cardId === 'LF-015' || card.cardId === 'LF-024') && options.targetIndex !== undefined) {
        const from = options.targetIndex
        const mover = game.board[from]?.monster
        if (mover) {
          const to = offsetTarget(from, mover.card.owner, card.cardId === 'LF-015' ? '2' : '8')
          if (to !== null) moveIntentRef.current = { from, to, instanceId: mover.card.instanceId,
            cardId: mover.card.cardId, owner: mover.card.owner }
        }
      }
      if (effectsEnabled && options.targetIndex !== undefined) setMagicTargetCells([options.targetIndex])
      setGame(result.game)
      resetSelection()
      if (options.targetIndex !== undefined) setInspect(options.targetIndex)
    }
    setMessage(result.message)
  }

  function playCardAt(index: number, card: CardInstance) {
    if (!isMyTurn || online.busy) return
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
    if (specialBattle) specialBattleTargetRef.current = index
    setGame(settled)
    resetSelection()
    setInspect(index)
    setInspectedEquipmentId(null)
    setMessage(placementMessage)
  }

  function handleCellClick(index: number) {
    if (onlineMode && (!isMyTurn || online.busy)) {
      setInspect(index)
      setInspectedEquipmentId(null)
      setMovingFrom(null)
      return
    }
    if (game.winner) return
    if (pendingEquip) { setMessage('まず使用する装備を1枚選んでください'); return }
    if (game.pendingEffect) { setMessage('まず右側でモンスターの任意効果を選んでください'); return }
    if (selectedCard) { playCardAt(index, selectedCard); return }
    const cell = game.board[index]
    setInspect(index)
    setInspectedEquipmentId(null)
    if (game.phase === 'move') {
      if (movingFrom === index) { setMovingFrom(null); setMessage('選択を解除しました'); return }
      if (movingFrom !== null && destinations.includes(index)) {
        const originMonster = game.board[movingFrom].monster
        if (originMonster) moveIntentRef.current = {
          from: movingFrom, to: index, instanceId: originMonster.card.instanceId,
          cardId: originMonster.card.cardId, owner: originMonster.card.owner,
        }
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
    if (!isMyTurn || online.busy || phaseLockRef.current) return
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
    lockPhase(next.turn !== game.turn || next.activePlayer !== game.activePlayer ? 'turn' : next.phase === 'draw' ? 'draw' : 'phase')
    setGame(next)
    resetSelection()
    setInspect(null)
    setInspectedEquipmentId(null)
    setMessage(next.winner ? `${displayPlayer(next.winner)}の勝利！ ${next.winReason}` : `${PHASE_LABELS[next.phase]}フェイズです`)
  }

  // ゲームの状態を読むだけの演出レイヤー。Firebaseへ演出情報を送らない。
  // 通信状態やルール判定は変更せず、描画だけで演出を再現する。
  // 移動画像のチラつきを防ぐため、盤面更新後・描画前に計測する。
  useLayoutEffect(() => {
    if (!started || setupStage !== 'play' || (onlineMode && online.room?.stage !== 'playing')) {
      previousSnapshot.current = null
      previousHandCards.current = { player1: [], player2: [] }
      moveIntentRef.current = null
      return
    }
    const current = snapshot(game)
    const previous = previousSnapshot.current
    const previousIds = previousHandCards.current[owner]
    const currentIds = player.hand.map(c => c.instanceId)
    if (previous) {
      const added = previousIds.length ? currentIds.filter(id => !previousIds.includes(id)) : []
      if (added.length > 0) setNewHandCards(added)
      const changed: number[] = []
      for (let i = 0; i < current.board.length; i++) {
        if (previous.board[i].monster !== current.board[i].monster || previous.board[i].territory !== current.board[i].territory) changed.push(i)
      }
      const playedSpell = (['player1', 'player2'] as const).flatMap(seat =>
        current.graveMagic[seat].filter(spell => !previous.graveMagic[seat].some(older => older.instanceId === spell.instanceId)))
        .at(0)
      const directMove = moveIntentRef.current
      moveIntentRef.current = null
      const specialBattleTarget = specialBattleTargetRef.current
      specialBattleTargetRef.current = null
      // 同じモンスターが別のマスへ移ったかを差分から検知。
      // オンラインの相手画面でも、盤面に残ったモンスターの移動を再現できる。
      let detectedMove: MoveIntent | null = directMove
      if (!detectedMove) {
        for (let from = 0; from < previous.board.length && !detectedMove; from++) {
          const old = previous.board[from]
          if (!old.monster) continue
          const to = current.board.findIndex((now, index) => index !== from && now.monster === old.monster)
          if (to === -1) continue
          detectedMove = { from, to, instanceId: old.monster,
            cardId: old.monsterId!, owner: game.board[to].monster!.card.owner }
        }
      }
      const newDeaths = (['player1', 'player2'] as const).flatMap(seat =>
        current.graveMonsters[seat].filter(dead => !previous.graveMonsters[seat].some(old => old.instanceId === dead.instanceId)))
      // 移動先で倒された場合は移動したインスタンスが盤面に残らないため、
      // 墓地への追加と移動方向から補完する（激流・追い風を含む）。
      if (!detectedMove && playedSpell && (playedSpell.cardId === 'LF-015' || playedSpell.cardId === 'LF-024')) {
        for (let from = 0; from < previous.board.length && !detectedMove; from++) {
          const old = previous.board[from]
          if (!old.monster || !old.monsterOwner) continue
          const isCaster = old.monsterOwner === previous.activePlayer
          if (isCaster !== (playedSpell.cardId === 'LF-015')) continue
          if (current.board[from].monster === old.monster) continue
          const to = offsetTarget(from, old.monsterOwner, playedSpell.cardId === 'LF-015' ? '2' : '8')
          if (to !== null && (current.board[to].monster === old.monster || newDeaths.some(d => d.instanceId === old.monster))) {
            detectedMove = { from, to, instanceId: old.monster, cardId: old.monsterId!, owner: old.monsterOwner }
          }
        }
      }
      const movement = detectedMove
      const survives = !!movement && current.board[movement.to].monster === movement.instanceId
      const battle = !!movement && !!previous.board[movement.to].monster
      const isSpellMove = !!movement && !!playedSpell && (playedSpell.cardId === 'LF-015' || playedSpell.cardId === 'LF-024')
      if (movement && effectsEnabled) {
        if (isSpellMove) {
          // マジックのカード表示後に盤面の移動。二つの演出は同時に重ねない。
          if (spellMoveTimer.current !== null) window.clearTimeout(spellMoveTimer.current)
          setPendingSpellMove(movement)
          spellMoveTimer.current = window.setTimeout(() => {
            setPendingSpellMove(null)
            animateBoardMove(movement, survives, battle)
            spellMoveTimer.current = null
          }, 1260)
        } else animateBoardMove(movement, survives, battle)
      }
      if (newDeaths.length && effectsEnabled) {
        const deaths = newDeaths.flatMap(dead => {
          const oldIndex = previous.board.findIndex(cell => cell.monster === dead.instanceId)
          // 攻撃側は移動先で戦死する。防御側は元々いたマスで戦死する。
          let cellIndex = oldIndex
          if (movement?.instanceId === dead.instanceId) cellIndex = movement.to
          if (cellIndex < 0 && dead.cardId === 'LF-022' && specialBattleTarget !== null) cellIndex = specialBattleTarget
          if (cellIndex < 0 && dead.cardId === 'LF-022') {
            // プラキロルスの特殊召喚で倒れたときは争奪したマスを使う。
            cellIndex = previous.board.findIndex((cell, index) => cell.monster &&
              (current.board[index].monster !== cell.monster || newDeaths.some(other => other.instanceId === cell.monster)))
          }
          return cellIndex < 0 ? [] : [{ ...dead, cellIndex }]
        })
        if (deaths.length) animateGraveyardFlight(deaths, isSpellMove ? 1690 : movement ? 450 : 130)
      }
      // 通常の配置と移動は別演出。移動元・移動先の汎用点滅は重ねない。
      if (changed.length) setFlashCells(movement ? changed.filter(i => i !== movement.from && i !== movement.to) : changed)
      const appeared = changed.filter(i => current.board[i].monster && !previous.board.some(before => before.monster === current.board[i].monster))
      if (appeared.length && effectsEnabled && !playedSpell) setSummonCells(appeared)
      if (playedSpell && effectsEnabled) {
        setMagicCue({ cardId: playedSpell.cardId, stamp: ++cueCounter.current })
      }
      // 実際に使用された装備を検出（直接配置による自動装備・選択装備の双方）。
      const newlyEquippedIndex = current.board.findIndex(cell =>
        !!cell.monster && !!cell.equippedId &&
        !previous.board.some(before => before.monster === cell.monster && before.equippedId === cell.equippedId))
      if (newlyEquippedIndex !== -1 && effectsEnabled && !playedSpell) {
        const cell = current.board[newlyEquippedIndex]
        const equipment = cell.equipments.find(e => e.instanceId === cell.equippedId)
        if (equipment) {
          setEquipmentCue({ cardId: equipment.cardId, cellIndex: newlyEquippedIndex, stamp: ++cueCounter.current })
          setEquipmentImpactCells([newlyEquippedIndex])
        }
      }
      const gain = changed.find(i => current.board[i].monster && current.board[i].monster !== previous.board[i].monster)
      const territoryGain = changed.find(i => current.board[i].territory && current.board[i].territory !== previous.board[i].territory)
      let next: Omit<VisualCue, 'stamp'> | null = null
      if (current.winner && !previous.winner) {
        const victory: Omit<VisualCue, 'stamp'> = { kind: 'victory',
          title: current.winner === owner ? 'VICTORY' : 'GAME SET',
          subtitle: `${displayPlayer(current.winner)}の勝利` }
        if (playedSpell && effectsEnabled) {
          // マジックで勝利した場合は、発動演出の後に勝敗を表示する。
          setVisualCue(null)
          delayedVictoryTimer.current = window.setTimeout(() => {
            setVisualCue({ ...victory, stamp: ++cueCounter.current })
            delayedVictoryTimer.current = null
          }, 1250)
        } else next = victory
      } else if (current.turn !== previous.turn || current.activePlayer !== previous.activePlayer) {
        next = { kind: 'turn', title: current.activePlayer === owner ? 'YOUR TURN' : 'OPPONENT TURN', subtitle: `TURN ${current.turn}　${displayPlayer(current.activePlayer)}` }
      } else if (playedSpell) {
        // マジックで移動・戦闘・破壊が起きても大型カットインは出さない。
        // 同じタイミングに残っていた直前のフェイズ演出も消す。
        setVisualCue(null)
      } else if (movement || (current.phase === 'move' && !previous.moveUsedThisTurn && current.moveUsedThisTurn)) {
        // 移動・戦闘は盤面内のダッシュ＋着地で完結させる。
        setVisualCue(null)
      } else if (gain !== undefined) {
        const id = current.board[gain].monsterId!
        const wasOnBoard = previous.board.some(c => c.monster === current.board[gain].monster)
        if (!wasOnBoard) next = { kind: 'summon', title: 'SUMMON', subtitle: cardName(id), artworkId: id }
      } else if (territoryGain !== undefined) {
        const id = current.board[territoryGain].territoryId!
        next = { kind: 'deploy', title: 'FRONTIER', subtitle: cardName(id), artworkId: id }
      } else if (current.phase !== previous.phase) {
        next = current.phase === 'draw'
          ? { kind: 'draw', title: 'ドロー', subtitle: '城からカードを引きます' }
          : { kind: 'phase', title: PHASE_LABELS[current.phase], subtitle: 'PHASE CHANGE' }
      }
      // 通常移動（移動成功・戦闘・相討ち）と、オーガの追加前進など、
      // 移動フェイズで続けて発生する演出の完了を待ってから自動進行する。
      const moveAnimation = current.phase === 'move' && current.moveUsedThisTurn && (
        !previous.moveUsedThisTurn || !!movement
      )
      // 戦闘後に装備を選んだ場合も、装備演出（1.35秒）を途中で切らない。
      const equipmentAnimation = current.phase === 'move' && current.moveUsedThisTurn && newlyEquippedIndex !== -1
      if (effectsEnabled) {
        if (next) setVisualCue({ ...next, stamp: ++cueCounter.current })
        if (current.turn !== previous.turn || current.activePlayer !== previous.activePlayer) lockPhase('turn')
        else if (!current.winner && isSpellMove) lockPhase('spellmove')
        else if (!current.winner && playedSpell) lockPhase('spell')
        else if (!current.winner && equipmentAnimation) lockPhase('equipment')
        else if (!current.winner && moveAnimation && newDeaths.length) lockPhase('combat')
        else if (!current.winner && moveAnimation) lockPhase('move')
        else if (next?.kind === 'deploy') lockPhase('deploy') // 開拓演出の終了を待ってからメインへ自動進行
        else if (current.phase !== previous.phase) lockPhase(current.phase === 'draw' ? 'draw' : 'phase')
      }
    }
    previousSnapshot.current = current
    previousHandCards.current = {
      player1: game.players.player1.hand.map(c => c.instanceId),
      player2: game.players.player2.hand.map(c => c.instanceId),
    }
  }, [game, owner, started, setupStage, onlineMode, online.room?.stage, effectsEnabled])

  useEffect(() => {
    if (!visualCue) return
    const timer = window.setTimeout(() => setVisualCue(null), visualCue.kind === 'victory' ? 2800 : visualCue.kind === 'turn' ? 1500 : visualCue.kind === 'phase' || visualCue.kind === 'draw' ? 950 : 1100)
    return () => window.clearTimeout(timer)
  }, [visualCue])

  // 城のカード束から手札へ飛ぶ描画専用のカード。ドロー処理や公開情報には一切触れない。
  useLayoutEffect(() => {
    if (deckDrawTimer.current !== null) { window.clearTimeout(deckDrawTimer.current); deckDrawTimer.current = null }
    if (!effectsEnabled || !newHandCards.length || !started || setupStage !== 'play') {
      setDeckDrawCues([])
      return
    }
    const castle = document.querySelector<HTMLElement>(`.game-in-play .field-cell[data-castle-owner="${owner}"] .castle-card-stack`)
    if (!castle) return
    const source = castle.getBoundingClientRect()
    const cues = newHandCards.flatMap((id, i): DeckDrawCue[] => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('.game-in-play [data-hand-instance]'))
        .find(el => el.dataset.handInstance === id)
      if (!target) return []
      const dest = target.getBoundingClientRect()
      if (!source.width || !source.height || !dest.width) return []
      const width = Math.min(source.width, 85)
      // 実際の横向きカード束と同じ縦横比を維持して手札へ飛ばす。
      const height = width * (source.height / source.width)
      const left = source.left + (source.width - width) / 2
      const top = source.top + (source.height - height) / 2
      return [{ stamp: ++cueCounter.current, id, left, top, width, height,
        dx: dest.left + dest.width / 2 - (left + width / 2),
        dy: dest.top + dest.height / 2 - (top + height / 2),
        delayMs: i * 115 }]
    })
    setDeckDrawCues(cues)
    deckDrawTimer.current = window.setTimeout(() => {setDeckDrawCues([]); deckDrawTimer.current = null}, 1050 + cues.length * 115)
  }, [newHandCards, owner, started, setupStage, effectsEnabled])

  useEffect(() => {
    if (!flashCells.length && !newHandCards.length && !summonCells.length && !magicTargetCells.length && !equipmentImpactCells.length) return
    const timer = window.setTimeout(() => { setFlashCells([]); setNewHandCards([]); setSummonCells([]); setMagicTargetCells([]); setEquipmentImpactCells([]) }, 900)
    return () => window.clearTimeout(timer)
  }, [flashCells, newHandCards, summonCells, magicTargetCells, equipmentImpactCells])

  useEffect(() => {
    if (!magicCue) return
    const timer = window.setTimeout(() => setMagicCue(null), 1250)
    return () => window.clearTimeout(timer)
  }, [magicCue])
  useEffect(() => {
    if (!optionalEffectCue) return
    const timer = window.setTimeout(() => setOptionalEffectCue(null), 950)
    return () => window.clearTimeout(timer)
  }, [optionalEffectCue])
  useEffect(() => {
    if (!equipmentCue) return
    const timer = window.setTimeout(() => setEquipmentCue(null), 1350)
    return () => window.clearTimeout(timer)
  }, [equipmentCue])

  function captureMulliganOrderAndSort() {
    const positions = new Map<string, DOMRect>()
    if (effectsEnabled) mulliganHandRef.current?.querySelectorAll<HTMLElement>('[data-mulligan-id]').forEach(node => {
      if (node.dataset.mulliganId) positions.set(node.dataset.mulliganId, node.getBoundingClientRect())
    })
    mulliganSortStart.current = positions
    setMulliganSorted(true)
  }

  useLayoutEffect(() => {
    if (!mulliganSorted || !mulliganSortStart.current) return
    const before = mulliganSortStart.current
    mulliganSortStart.current = null
    if (!effectsEnabled) return
    mulliganHandRef.current?.querySelectorAll<HTMLElement>('[data-mulligan-id]').forEach(node => {
      const oldRect = before.get(node.dataset.mulliganId || '')
      if (!oldRect) return
      const newRect = node.getBoundingClientRect()
      const dx = oldRect.left - newRect.left
      const dy = oldRect.top - newRect.top
      if (Math.abs(dx) + Math.abs(dy) < 1) return
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 440, easing: 'cubic-bezier(.2,.8,.2,1)' })
    })
  }, [mulliganSorted, mulliganPreview, effectsEnabled])

  // 引いた順に配り、最後に番号順にシュバッと整列する。マリガン後も同じ演出を再利用。
  // 演出は手札を増減させない。選択確定までローカルの仮プレビューとして扱う。
  useEffect(() => {
    setMulliganRevealCount(0)
    setMulliganSorted(false)
    setMulliganSortComplete(false)
    mulliganSortStart.current = null
    if (!started || setupStage === 'play') return
    const seat = onlineMode && online.session ? online.session.seat : setupStage
    const cardsToDeal = mulliganPreview ? mulliganPreview.drawnIds.length : game.players[seat].hand.length
    if (!effectsEnabled || cardsToDeal === 0) {
      setMulliganRevealCount(cardsToDeal)
      setMulliganSorted(true)
      setMulliganSortComplete(true)
      return
    }
    const delay = mulliganPreview ? 280 : 350
    const interval = mulliganPreview ? 180 : 165
    const timers = Array.from({ length: cardsToDeal }, (_, i) => window.setTimeout(() =>
      setMulliganRevealCount(i + 1), delay + i * interval))
    timers.push(window.setTimeout(() => {
      captureMulliganOrderAndSort()
      timers.push(window.setTimeout(() => setMulliganSortComplete(true), 460))
    }, delay + (cardsToDeal - 1) * interval + 500))
    return () => timers.forEach(window.clearTimeout)
  }, [started, setupStage, onlineMode, online.session?.seat, online.room?.stage, mulliganPreview, effectsEnabled])

  // 判断不要なフェイズのみ自動化する。相手の端末は書き込まない。
  // 開拓は領土を置いた時のみ、移動は行動済みの場合のみ進める。
  useEffect(() => {
    const key = `${game.turn}/${game.activePlayer}/${game.phase}`
    if (phaseClock.current.key !== key) phaseClock.current = { key, at: Date.now() }
    if (!started || setupStage !== 'play' || !isMyTurn || online.busy || game.winner || pendingEquip || game.pendingEffect || phaseLocked || phaseLockRef.current) return
    if (onlineMode && online.room?.stage !== 'playing') return
    const auto = game.phase === 'start' || game.phase === 'draw' || game.phase === 'end'
      || (game.phase === 'develop' && game.territoryPlayedThisTurn)
      || (game.phase === 'move' && game.moveUsedThisTurn)
    if (!auto) return
    const desired = game.phase === 'start' ? 1450 : game.phase === 'draw' ? 1250 : game.phase === 'end' ? 1400 : 1550
    const delay = Math.max(90, desired - (Date.now() - phaseClock.current.at))
    const timer = window.setTimeout(() => nextPhase(), delay)
    return () => window.clearTimeout(timer)
  }, [started, setupStage, game.phase, game.turn, game.activePlayer, game.territoryPlayedThisTurn, game.moveUsedThisTurn,
    game.winner, game.pendingEffect, pendingEquip, isMyTurn, online.busy, onlineMode, online.room?.stage, online.room?.version, phaseLocked])

  function newGame() {
    if (onlineMode) return
    const first = deckChoices.player1
    const second = deckChoices.player2
    if (!first || !second) return
    setGame(createGameWithDecks(first, second))
    setSetupStage('player1')
    setMulliganSelected([])
    setMulliganPreview(null)
    releasePhaseLock()
    resetSelection()
    setInspect(null)
    setMessage(`${first}デッキ 対 ${second}デッキ：新しい対戦を開始しました`)
  }

  function changeDecks() {
    if (onlineMode) return
    setStarted(false)
    setSetupStage('player1')
    setMulliganSelected([])
    setMulliganPreview(null)
    releasePhaseLock()
    setDeckChoices({ player1: null, player2: null })
    setGame(createInitialGameState())
    resetSelection()
    setInspect(null)
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
    setMulliganPreview(null)
    releasePhaseLock()
    resetSelection()
    setInspect(null)
    setMessage(`${first}デッキ 対 ${second}デッキ：対戦開始！`)
  }

  function goHome() {
    online.leave()
    setOnlineMode(false)
    setScreen('home')
    setStarted(false)
    setGameLocal(createInitialGameState())
    setDeckChoices({ player1: null, player2: null })
    setSetupStage('player1')
    setMulliganSelected([])
    setMulliganPreview(null)
    releasePhaseLock()
    resetSelection()
    setInspect(null)
    setInspectedEquipmentId(null)
    setMessage('手札を選ぶか、フェイズを進めてください')
    setVisualCue(null)
    clearBoardMove()
    if (delayedVictoryTimer.current !== null) window.clearTimeout(delayedVictoryTimer.current)
    delayedVictoryTimer.current = null
    previousSnapshot.current = null
  }

  function openLocalMatch() {
    goHome()
    setScreen('local')
  }

  function openOnlineMatch() {
    goHome()
    setScreen('online')
    setOnlineMode(true)
  }

  function openDeckBrowser() {
    goHome()
    setDeckBrowseElement('火')
    setDeckBrowseCardId('LF-009')
    setScreen('decks')
  }

  if (screen === 'home') {
    return <main className="home-screen" style={{'--lf-stone': `url("${import.meta.env.BASE_URL}artwork/board/stone-board.png")`} as CSSProperties}>
      <div className="home-glow" aria-hidden="true" />
      <header className="home-topbar">
        <span className="home-top-brand">LANE FRONTIER <span>WEB</span></span>
        <a href="https://lane-frontier-game.github.io/lane-frontier/" target="_blank" rel="noopener noreferrer">公式サイト <span aria-hidden="true">↗</span></a>
      </header>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-logo-frame">
          <img src={`${import.meta.env.BASE_URL}cards/LF-icon.jpg`} alt="レーンフロンティア公式ロゴ" />
        </div>
        <p className="home-eyebrow">ORIGINAL TRADING CARD GAME</p>
        <h1 id="home-title">レーンフロンティア</h1>
        <p className="home-subtitle">領土を切り拓き、戦場を進め。</p>
        <div className="home-game-actions">
          <button type="button" className="home-play-button home-play-online" onClick={openOnlineMatch}>
            <span className="home-play-symbol" aria-hidden="true">↗</span>
            <span><strong>オンライン対戦</strong><small>別々の端末で遊ぶ</small></span>
            <span className="home-play-arrow" aria-hidden="true">→</span>
          </button>
          <button type="button" className="home-play-button home-play-local" onClick={openLocalMatch}>
            <span className="home-play-symbol" aria-hidden="true">▣</span>
            <span><strong>1台でテスト</strong><small>1台の端末で交代して遊ぶ</small></span>
            <span className="home-play-arrow" aria-hidden="true">→</span>
          </button>
        </div>
        <button type="button" className="home-deck-browser-button" onClick={openDeckBrowser}>デッキ内容を見る <span aria-hidden="true">→</span></button>
      </section>
      <section className="home-links" aria-label="公式リンク・お問い合わせ">
        <h2>公式サイト・お問い合わせ</h2>
        <div className="home-link-list">
          <a href="https://lane-frontier-game.github.io/lane-frontier/" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">⌂</span> 公式HP ↗</a>
          <a href="https://lane-frontier-game.github.io/lane-frontier/rules.html" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▤</span> ルールを見る ↗</a>
          <a href="https://x.com/lean_frontier" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">𝕏</span> 公式X ↗</a>
          <a href="https://line.me/R/ti/p/@273joulf" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">●</span> 公式LINE ↗</a>
          <a href="mailto:leanfrontier.official@gmail.com"><span aria-hidden="true">✉</span> メールでお問い合わせ ↗</a>
        </div>
      </section>
      <footer className="home-footer">© Lane Frontier <span>{BUILD_LABEL}</span></footer>
    </main>
  }

  if (screen === 'decks') {
    const recipe = deckRecipe(deckBrowseElement)
    const selected = cardInfo(deckBrowseCardId)
    return <main className="game-app deck-library-page" style={{'--lf-stone': `url("${import.meta.env.BASE_URL}artwork/board/stone-board.png")`} as CSSProperties}>
      <header className="game-header"><div><h1>デッキ一覧</h1><p>火・風・水、固定40枚のカード構成</p></div><button type="button" className="small-btn" onClick={goHome}>ホームへ戻る</button></header>
      <section className="deck-library">
        <div className="deck-library-tabs">{DECK_ELEMENTS.map(element => <button type="button" key={element} className={element === deckBrowseElement ? 'active' : ''} onClick={() => { setDeckBrowseElement(element); setDeckBrowseCardId(deckRecipe(element)[0].cardId) }}>{element}属性デッキ</button>)}</div>
        <p>基礎領土16枚 ＋ そのほか8種類を各3枚。カード画像をクリックすると詳細が見られます。</p>
        <div className="deck-library-layout">
          <div className="deck-library-grid">{recipe.map(({ cardId, count }) => <button type="button" key={cardId} className={`deck-library-card ${deckBrowseCardId === cardId ? 'active' : ''}`} onClick={() => setDeckBrowseCardId(cardId)}>
            <img src={cardImage(cardId)} alt={cardName(cardId)} />
            {typeof cardInfo(cardId)?.requiredTerritories === 'number' &&
              <span className="territory-badge territory-badge-deck" title={`必要領土数 ${cardInfo(cardId)!.requiredTerritories}枚`}>◆ 領土{cardInfo(cardId)!.requiredTerritories}</span>}
            <span>{cardName(cardId)}</span><strong>×{count}</strong>
          </button>)}</div>
          <aside className="deck-library-detail">
            <img src={cardImage(deckBrowseCardId)} alt={cardName(deckBrowseCardId)} />
            <h2>{cardName(deckBrowseCardId)}</h2>
            <p>{selected?.element} / {selected?.category} / 採用{recipe.find(e => e.cardId === deckBrowseCardId)?.count ?? 0}枚</p>
            {selected?.requiredTerritories != null && <p className="deck-required-territories">◆ 必要領土数：<strong>{selected.requiredTerritories}枚</strong></p>}
            {selected?.attack != null && <p>ATK：{selected.attack} ／ DEF：{selected.defense ?? '－'}</p>}
            {selected?.effectText && <p className="deck-library-effect">{selected.effectText}</p>}
          </aside>
        </div>
      </section>
    </main>
  }

  if (onlineMode && (!online.room?.gameJson || !online.session)) {
    const room = online.room
    const mySeat = online.session?.seat
    return <main className="game-app">
      <header className="game-header"><div><h1>Lane Frontier</h1><p>{BUILD_LABEL}</p></div></header>
      <section className="deck-setup online-lobby">
        <div className="online-lobby-header"><h2>オンライン対戦</h2><button type="button" className="small-btn" onClick={goHome}>ホームに戻る</button></div>
        {!isOnlineConfigured && <p className="online-warning">オンライン機能は準備できていますが、Firebaseの接続設定がまだ必要です。「オンライン設定手順.txt」に従って設定してください。</p>}
        {!online.session ? <>
          <p>2台のPCで対戦します。片方が部屋を作り、もう片方が8文字の部屋番号で参加してください。</p>
          <div className="online-actions"><button type="button" disabled={online.busy || !isOnlineConfigured} className="phase-next" onClick={online.create}>部屋を作る</button></div>
          <div className="online-join"><input value={roomCodeInput} maxLength={8} placeholder="8文字の部屋番号" onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} /><button type="button" disabled={online.busy || !isOnlineConfigured} className="small-btn" onClick={() => online.join(roomCodeInput)}>部屋に参加</button></div>
        </> : <>
          <p>部屋番号：<strong className="online-room-code">{online.session.code}</strong> <button type="button" className="small-btn" onClick={() => navigator.clipboard.writeText(online.session!.code)}>コピー</button></p>
          <p>あなたは<strong>プレイヤー{mySeat === 'player1' ? '1（先攻）' : '2（後攻）'}</strong>です。</p>
          {room?.stage === 'waiting' && <p className="online-waiting">相手の参加を待っています。この部屋番号を相手に教えてください。</p>}
          {room?.stage === 'choosing' && <>
            <p>自分のデッキを選んでください。相手も選び終わると自動的に対戦準備へ進みます。</p>
            <div className="deck-options">{DECK_ELEMENTS.map(element => {
              const base = { '火': 'LF-009', '風': 'LF-018', '水': 'LF-027' }[element]
              return <button type="button" key={element} disabled={online.busy} className={`deck-option ${mySeat && room.decks[mySeat] === element ? 'chosen' : ''}`} onClick={() => online.chooseDeck(element)}>
                <img src={cardImage(base)} alt={`${element}属性の領土`} /><strong>{element}デッキ</strong><span>{mySeat && room.decks[mySeat] === element ? '選択済み ✓' : '選択する'}</span>
              </button>
            })}</div>
            {mySeat && room.decks[mySeat] && <p className="online-waiting">{room.decks[mySeat]}デッキ選択済み。相手の選択待ち…</p>}
          </>}
        </>}
        {online.busy && <p>通信中…</p>}
        {online.error && <p className="online-error" role="alert">{online.error}</p>}
      </section>
    </main>
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
          <div className="online-lobby-header"><h2>デッキ選択</h2><button type="button" className="small-btn" onClick={goHome}>ホームに戻る</button><button type="button" className="small-btn" onClick={openOnlineMatch}>オンライン対戦 →</button></div>
          <p>火・風・水から各プレイヤーのデッキを選択してください。現在は1台のPCで交互に操作するテスト版です。</p>
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

  if (onlineMode && online.room?.stage === 'mulligan' && online.session && online.room.mulliganDone[online.session.seat]) {
    return <main className="game-app"><section className="mulligan-screen"><button type="button" className="small-btn" onClick={goHome}>ホームに戻る</button><h1>引き直し完了</h1><p>相手のマリガンが終わるのを待っています。</p><p>部屋番号：{online.session.code}</p>{online.error && <p role="alert" className="online-error">{online.error}</p>}</section></main>
  }

  if (setupStage !== 'play') {
    const mulliganPlayer: PlayerId = onlineMode && online.session ? online.session.seat : setupStage === 'player1' ? 'player1' : 'player2'
    const hand = mulliganPreview?.playerId === mulliganPlayer ? mulliganPreview.game.players[mulliganPlayer].hand : game.players[mulliganPlayer].hand
    const sorted = mulliganSorted ? [...hand].sort((a, b) => a.cardId.localeCompare(b.cardId) || a.instanceId.localeCompare(b.instanceId)) : hand
    const cardsToDeal = mulliganPreview ? mulliganPreview.drawnIds : hand.map(card => card.instanceId)
    const cardsShowing = cardsToDeal.slice(0, mulliganRevealCount)
    const revealReady = mulliganSorted && mulliganSortComplete && mulliganRevealCount >= cardsToDeal.length
    return (
      <main className="game-app">
        <header className="game-header"><div><h1>Lane Frontier</h1><p>ゲームの準備・初手の引き直し <span className="test-tag">{BUILD_LABEL}</span></p></div><button type="button" className="small-btn" onClick={goHome}>ホームに戻る</button></header>
        <section className="mulligan-screen">
          <div className="setup-progress">{mulliganPlayer === 'player1' ? '1 / 2' : '2 / 2'}　{displayPlayer(mulliganPlayer)}</div>
          <h2>{displayPlayer(mulliganPlayer)}：{mulliganPreview ? '引き直し後の手札確認' : 'マリガン'}</h2>
          {onlineMode && <p>自分の手札だけを表示しています。相手の手札は表示されません。</p>}
          <p>{mulliganPreview
            ? '引き直したカードを確認してください。この画面で確認を終えるまで、マリガンは確定しません。'
            : '最初の手札7枚から、引き直したいカードを選んでください。選んだ順番で城の一番下へ送り、同じ枚数を城の上から引きます。引き直しは1回だけです。'}</p>
          <div className={`mulligan-hand ${mulliganSorted ? 'mulligan-is-sorted' : ''}`} ref={mulliganHandRef}>
            {sorted.map(card => {
              const selectionOrder = mulliganPreview ? -1 : mulliganSelected.indexOf(card.instanceId)
              const isVisible = !cardsToDeal.includes(card.instanceId) || cardsShowing.includes(card.instanceId)
              return (
                <button type="button" key={card.instanceId} data-mulligan-id={card.instanceId}
                  className={`mulligan-card ${selectionOrder >= 0 ? 'mulligan-chosen' : ''} ${isVisible ? 'dealt-in' : 'deal-hidden'} ${mulliganPreview ? 'mulligan-preview-card' : ''}`}
                  disabled={!revealReady || !!mulliganPreview || !isVisible}
                  aria-pressed={selectionOrder >= 0}
                  onClick={() => toggleMulliganCard(card.instanceId)}
                  title={`${cardName(card.cardId)}${mulliganPreview ? '（引き直し後）' : '：クリックで選択・解除'}`}>
                  <img src={cardImage(card.cardId)} alt={cardName(card.cardId)} />
                  {typeof cardInfo(card.cardId)?.requiredTerritories === 'number' &&
                    <span className="territory-badge territory-badge-mulligan" title={`必要領土数 ${cardInfo(card.cardId)!.requiredTerritories}枚`}>◆ 領土{cardInfo(card.cardId)!.requiredTerritories}</span>}
                  {selectionOrder >= 0 && <span className="mulligan-order">戻す順 {selectionOrder + 1}</span>}
                  {mulliganPreview?.drawnIds.includes(card.instanceId) && <span className="mulligan-new-badge">NEW</span>}
                </button>
              )
            })}
          </div>
          {!revealReady && <p className="mulligan-dealing-label" aria-live="polite">{mulliganPreview ? '引き直したカードを確認中' : '初期手札を配布中'}… {Math.min(mulliganRevealCount, cardsToDeal.length)} / {cardsToDeal.length}{mulliganRevealCount === cardsToDeal.length ? '　整列中…' : ''}</p>}
          <p className="mulligan-count">{mulliganPreview
            ? `引き直したカード：${mulliganPreview.drawnIds.length}枚　／　城${mulliganPreview.game.players[mulliganPlayer].deck.length}枚`
            : `引き直すカード：${mulliganSelected.length}枚　／　初手7枚・城${game.players[mulliganPlayer].deck.length}枚`}</p>
          {mulliganPreview ? (
            <button type="button" className="phase-next" onClick={confirmMulliganPreview} disabled={online.busy || !revealReady}>
              {onlineMode ? 'この手札で確定 →' : mulliganPlayer === 'player1' ? '確認完了 → プレイヤー2のマリガンへ' : 'この手札で対戦開始 →'}
            </button>
          ) : (
            <button type="button" className="phase-next" onClick={finishMulligan} disabled={online.busy || !revealReady}>
              {mulliganSelected.length > 0 ? `${mulliganSelected.length}枚引き直す →` : '引き直さずに手札を確認 →'}
            </button>
          )}
          {online.error && <p className="online-error" role="alert">{online.error}</p>}
        </section>
      </main>
    )
  }

  if (onlineMode && pendingEquip?.monster && pendingEquip.monster.card.owner !== owner) {
    return <main className="game-app"><section className="mulligan-screen"><h1>装備の選択待ち</h1><p>相手プレイヤーが使用する装備を選んでいます。</p></section></main>
  }
  if (!onlineMode && pendingEquip?.monster && pendingEquip.monster.card.owner !== owner) {
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
    <main className="game-app game-in-play" style={{'--lf-stone': `url("${import.meta.env.BASE_URL}artwork/board/stone-board.png")`} as CSSProperties}>
      <header className="game-header">
        <div className="brand-line">
          <h1>Lane Frontier</h1>
          <span className="version-label">{BUILD_LABEL}</span>
        </div>
        <div className="game-header-actions">
          <button type="button" className="small-btn visual-toggle" aria-pressed={effectsEnabled} onClick={() => { setEffectsEnabled(v => !v); setVisualCue(null); clearBoardMove() }}>{effectsEnabled ? '演出 ON' : '演出 OFF'}</button>
          <button type="button" className="small-btn" onClick={goHome}>ホーム</button>
          {onlineMode ? <button type="button" className="small-btn" onClick={goHome}>部屋を退出</button> : <>
            <button type="button" className="small-btn" onClick={changeDecks}>デッキ変更</button>
            <button type="button" className="small-btn" onClick={newGame}>再戦</button>
          </>}
        </div>
      </header>

      <div className="status-bar" aria-label="現在の対戦状況">
        <strong className="turn-owner">{displayPlayer(game.activePlayer)}の手番{onlineMode ? (isMyTurn ? '（あなた）' : '（相手）') : ''}</strong>
        <span>ターン {game.turn}</span>
        <span className="phase-pill">{PHASE_LABELS[game.phase]}フェイズ</span>
        <span className="opponent-hand-pill">相手の手札 <strong>{opponent.hand.length}枚</strong></span>
        <span className="status-deck">{deckChoices[owner]}デッキ vs {deckChoices[otherPlayer(owner)]}デッキ</span>
      </div>
      <nav className="phase-track" aria-label="現在のフェイズ">
        {(Object.keys(PHASE_LABELS) as Array<GameState['phase']>).map((phase, i) => (
          <div key={phase} className={`phase-track-item ${phase === game.phase ? 'current' : ''} ${(Object.keys(PHASE_LABELS) as Array<GameState['phase']>).indexOf(game.phase) > i ? 'done' : ''}`}>
            <span className="phase-track-dot">{i + 1}</span><span>{PHASE_LABELS[phase]}</span>
          </div>
        ))}
      </nav>
      {game.winner && <div className="winner-banner">{displayPlayer(game.winner)}の勝利！ {game.winReason}</div>}
      {onlineMode && <div className="online-match-bar">部屋 {online.session?.code} ｜ あなたは{displayPlayer(owner)} ｜ {isMyTurn ? 'あなたの手番' : canResolveEquipment ? '装備を選んでください' : '相手の手番・操作待ち'} {online.busy ? '｜通信中…' : ''}</div>}
      {onlineMode && online.error && <div className="online-error" role="alert">{online.error}</div>}
      <div className="notice" role="status">{message}</div>

      <div className="game-layout">
        <section className="field-panel">
          <div className="panel-title"><h2>戦場</h2><span>{displayPlayer(owner)}視点</span></div>
          <div className="board-orientation">
            <span>↑ 相手の城</span>
            <div className="territory-owner-legend" aria-label="領土の枠色の説明">
              <div className="legend-entry"><i className="legend-frame legend-mine" aria-hidden="true" />青：自分の領土</div>
              <div className="legend-entry"><i className="legend-frame legend-rival" aria-hidden="true" />赤：相手の領土</div>
            </div>
          </div>
          <p className="instruction">
            {selectedData?.category === 'マジック' ?
              selectedCard?.cardId === 'LF-023' ? '手札から捨てるカードをクリックしてください（もう一度マジックを押すと解除）' :
                `使用対象をクリック：${cardName(selectedCard?.cardId ?? '')}（水色の「対象」を選択）` :
              game.phase === 'move' ? '自分のモンスター → 黄色い移動先をクリック（1ターンに1体）' :
              selectedCard ? `配置先をクリック：${cardName(selectedCard.cardId)}` : '手札を選んでから、配置するマスをクリック'}
          </p>
          <div className="board-grid" ref={boardRef}>
            {boardIndices.map(index => {
              const cell = game.board[index]
              const originalStats = cell.monster ? cardInfo(cell.monster.card.cardId) : null
              const currentAttack = cell.monster ? attackAt(game, index) : null
              const currentDefense = cell.monster ? defenseAt(game, index) : null
              const isDestination = destinations.includes(index) && !selectedCard
              const isSelectedMonster = movingFrom === index
              const isMagicTarget = magicTargets.includes(index)
              const isPlacementTarget = placingTargets.includes(index)
              const used = cell.monster && !canMoveNow(game, index)
              return (
                <button type="button" key={index}
                  data-board-index={index}
                  data-castle-owner={cell.castleOwner ?? undefined}
                  className={`field-cell ${boardMoveCue?.to === index && boardMoveCue.survives && cell.monster?.card.instanceId === boardMoveCue.instanceId ? 'move-landing-pending' : ''} ${moveImpactCells.includes(index) ? 'move-impact' : ''} ${flashCells.includes(index) ? 'just-changed' : ''} ${equipmentImpactCells.includes(index) ? 'equip-impact' : ''} ${summonCells.includes(index) ? 'summon-arriving' : ''} ${magicTargetCells.includes(index) ? 'magic-impact' : ''} ${cell.territory ? (cell.territory.owner === owner ? 'has-territory territory-mine' : 'has-territory territory-rival') : ''} ${cell.monster ? 'has-monster' : ''} ${cell.castleOwner === 'player1' ? 'castle1' : cell.castleOwner === 'player2' ? 'castle2' : ''} ${isDestination ? 'valid-move' : ''} ${isMagicTarget ? 'valid-magic' : ''} ${isPlacementTarget ? 'valid-placement' : ''} ${isSelectedMonster ? 'selected-monster' : ''} ${inspect === index ? 'inspected' : ''} ${game.pendingEffect?.cellIndex === index ? 'optional-effect-source' : ''} ${pendingSpellMove?.to === index && cell.monster?.card.instanceId === pendingSpellMove.instanceId ? 'spell-move-destination-hidden' : ''}`}
                  onClick={() => handleCellClick(index)}
                  title={`${cell.territory ? `${cell.territory.owner === owner ? '自分' : '相手'}の領土：${cardName(cell.territory.cardId)}` : '空きマス'} ${cell.monster ? '・'+cardName(cell.monster.card.cardId) : ''}`}
                >
                  {cell.castleOwner && <span className="castle-tile" aria-label={`${displayPlayer(cell.castleOwner)}の城`}>
                    <span className="castle-card-stack" aria-hidden="true">
                      <img className="castle-card-layer castle-card-layer-back" src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt="" />
                      <img className="castle-card-layer castle-card-layer-middle" src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt="" />
                      <img className="castle-card-face" src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt="" />
                    </span>
                    <span className="castle-word">{cell.castleOwner === owner ? '自分の城' : '相手の城'}</span>
                  </span>}
                  {cell.territory && <span className={`territory-tile ${shouldRotateCard(cell.territory.owner, owner) ? 'opponent-tile' : ''}`}>
                    <img src={artworkImage(cell.territory.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(cell.territory!.cardId) }} alt={cardName(cell.territory.cardId)} />
                    <span className="territory-name">{cardName(cell.territory.cardId)}</span>
                  </span>}
                  {cell.territory && <span className="territory-owner-frame" aria-hidden="true" />}
                  {pendingSpellMove?.from === index && effectsEnabled && <span className={`spell-move-source-ghost ${shouldRotateCard(pendingSpellMove.owner, owner) ? 'opponent-tile' : ''}`} aria-hidden="true">
                    <img src={artworkImage(pendingSpellMove.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(pendingSpellMove.cardId) }} alt="" />
                  </span>}
                  {cell.monster && <span className={`monster-tile ${shouldRotateCard(cell.monster.card.owner, owner) ? 'opponent-tile' : ''}`}>
                    <img className="monster-art" src={artworkImage(cell.monster.card.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(cell.monster!.card.cardId) }} alt={cardName(cell.monster.card.cardId)} />
                    <span className="monster-name">{cardName(cell.monster.card.cardId)}</span>
                  </span>}
                  {cell.monster && <span className="stats">
                    <span><b>ATK</b> <strong className={`stat-number ${statChangeClass(currentAttack, originalStats?.attack)}`}>{currentAttack ?? '?'}</strong></span>
                    <span><b>DEF</b> <strong className={`stat-number ${statChangeClass(currentDefense, originalStats?.defense)}`}>{currentDefense ?? '?'}</strong></span>
                  </span>}
                  {cell.equipments.length > 0 && <span className="equip-thumbnails" title={`装備 ${cell.equipments.map(e => cardName(e.cardId)).join(' / ')}`}>
                    {[...cell.equipments].sort((a, b) => Number(b.instanceId === cell.monster?.equippedId) - Number(a.instanceId === cell.monster?.equippedId)).slice(0, 2).map(e =>
                      <span className={`equip-thumbnail ${e.instanceId === cell.monster?.equippedId ? 'in-use' : ''}`} key={e.instanceId}><img src={cardImage(e.cardId)} alt={cardName(e.cardId)} /></span>)}
                    {cell.equipments.length > 2 && <span className="equip-overflow">+{cell.equipments.length - 2}</span>}
                  </span>}
                  {used && game.phase === 'move' && <span className="no-move-mark">待機</span>}
                  {isDestination && <span className="move-target">{cell.castleOwner ? '勝利' : cell.monster ? '戦闘' : '移動'}</span>}
                  {isMagicTarget && <span className="move-target magic-target">対象</span>}
                  {isPlacementTarget && <span className="placement-target-label">配置</span>}
                  {game.pendingEffect?.cellIndex === index && <span className="optional-source-label">効果選択中</span>}
                </button>
              )
            })}
            {effectsEnabled && boardMoveCue && <div key={boardMoveCue.stamp}
              className={`board-move-flight ${boardMoveCue.battle ? 'move-battle' : ''}`}
              style={{ left: boardMoveCue.left, top: boardMoveCue.top,
                width: boardMoveCue.width, height: boardMoveCue.height,
                '--move-x': `${boardMoveCue.dx}px`, '--move-y': `${boardMoveCue.dy}px`,
                '--move-short-x': `${boardMoveCue.dx * .12}px`, '--move-short-y': `${boardMoveCue.dy * .12}px`,
              } as CSSProperties} aria-hidden="true">
              <div className={`board-move-monster ${shouldRotateCard(boardMoveCue.owner, owner) ? 'opponent-tile' : ''}`}>
                <img src={artworkImage(boardMoveCue.cardId)}
                  onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(boardMoveCue.cardId) }} alt="" />
              </div>
              <span className="board-move-streak" />
            </div>}
            {effectsEnabled && graveFlyCues.length > 0 && <>
              <span className="battle-grave-target" aria-hidden="true">墓地</span>
              {graveFlyCues.map(dead => <div key={dead.stamp} className="battle-grave-flight"
                style={{ left: dead.left, top: dead.top, width: dead.width, height: dead.height,
                  '--grave-x': `${dead.dx}px`, '--grave-y': `${dead.dy}px`,
                  '--grave-delay': `${dead.delayMs}ms` } as CSSProperties} aria-hidden="true">
                <img src={artworkImage(dead.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(dead.cardId) }} alt="" />
              </div>)}
            </>}
          </div>
          <p className="board-hint">↓ 自分の城</p>
        </section>

      <section className="hand-panel">
        <div className="panel-title"><h2>手札 <span className="count-label">{player.hand.length}枚</span></h2><span className="territory-hand-summary">◆ 自分の領土 {territoryCount(game, owner)}枚 <small>緑：条件達成 / 赤：不足</small></span></div>
        <div className="hand-phase-controls">
          <div className="hand-phase-label" aria-live="polite">
            <strong>{displayPlayer(game.activePlayer)}の手番</strong>
            <span>ターン {game.turn} ・ {PHASE_LABELS[game.phase]}フェイズ</span>
          </div>
          <button type="button" className="phase-next hand-phase-next" onClick={nextPhase}
            disabled={!isMyTurn || online.busy || phaseLocked || !!game.winner || !!pendingEquip || !!game.pendingEffect}>
            {game.phase === 'start' ? 'スタート終了 → ドロー' :
              game.phase === 'draw' ? 'ドロー終了 → 開拓' :
              game.phase === 'develop' ? '開拓終了 → メイン' :
              game.phase === 'main' ? 'メイン終了 → 移動' :
              game.phase === 'move' ? '移動終了 → エンド' :
              'エンド終了 → ターン交代'}
          </button>
        </div>
        <div className="hand-list">
          {sortedHand.map(card => (
            <button type="button" key={card.instanceId} data-hand-instance={card.instanceId} onClick={() => {
              if (onlineMode && (!isMyTurn || online.busy)) return
              if (discardingForOcean && selectedCard && card.instanceId !== selectedCard.instanceId) {
                useMagic(selectedCard, { discardInstanceId: card.instanceId }); return
              }
              setSelectedId(prev => prev === card.instanceId ? null : card.instanceId)
              setMovingFrom(null)
            }}
              className={`hand-card ${card.instanceId === selectedId ? 'selected-card' : ''} ${effectsEnabled && newHandCards.includes(card.instanceId) ? 'newly-drawn' : ''} ${discardingForOcean && card.instanceId !== selectedCard?.instanceId ? 'discard-candidate' : ''}`}
              title={`${cardName(card.cardId)}（${cardInfo(card.cardId)?.category}／${cardInfo(card.cardId)?.element}）${typeof cardInfo(card.cardId)?.requiredTerritories === 'number' ? `・必要領土${cardInfo(card.cardId)!.requiredTerritories}枚／現在${territoryCount(game, owner)}枚` : ''}`}>
              <img src={cardImage(card.cardId)} alt={cardName(card.cardId)} />
              {typeof cardInfo(card.cardId)?.requiredTerritories === 'number' &&
                <span className={`territory-badge ${territoryCount(game, owner) >= cardInfo(card.cardId)!.requiredTerritories! ? 'territory-badge-met' : 'territory-badge-short'}`}>◆ 領土{cardInfo(card.cardId)!.requiredTerritories}</span>}
            </button>
          ))}
        </div>
        <div className="hand-actions">
          <span>{discardingForOcean ? '大海の恵み：捨てるカードを手札から選んでください' : selectedCard ? `選択中：${cardName(selectedCard.cardId)}（${cardInfo(selectedCard.cardId)?.category}）` : '手札を選ぶと、右側にカード情報が表示されます'}</span>
          <span>城 {player.deck.length}枚 ・ 墓地 {player.graveyard.length}枚</span>
        </div>
      </section>
        <section className="side-panel">
          {pendingEquip && <div className="panel-card equip-choice">
            <h2>使用する装備を選択</h2>
            <p>{cardName(pendingEquip.monster!.card.cardId)}が使用する装備を1枚選んでください。相手の装備も使用できます。</p>
            <div className="choice-list">{pendingEquip.equipments.map(card => (
              <button key={card.instanceId} disabled={!canAct || online.busy} onClick={() => useEquipment(pendingEquipIndex, card.instanceId)}>
                {cardName(card.cardId)}を使用（{displayPlayer(card.owner)}のカード）
              </button>
            ))}</div>
          </div>}
          <div className="panel-card overview-panel">
            <div className="panel-title"><h2>対戦状況</h2><span>相手の手札は枚数のみ表示</span></div>
            <div className="duel-stats">
              <div><small>自分の城</small><strong>{player.deck.length}</strong><small>枚</small></div>
              <div><small>相手の城</small><strong>{opponent.deck.length}</strong><small>枚</small></div>
              <div><small>自分の領土</small><strong>{territoryCount(game, owner)}</strong><small>枚</small></div>
              <div><small>相手の領土</small><strong>{territoryCount(game, otherPlayer(owner))}</strong><small>枚</small></div>
            </div>
            <div className="opponent-hand-summary"><span>相手の手札</span><strong>{opponent.hand.length}<small>枚</small></strong><span>通常移動：{game.moveUsedThisTurn ? '実行済み' : '未実行'}</span></div>
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
                    {typeof data?.requiredTerritories === 'number' && (() => {
                      const controlledLands = territoryCount(game, focused.owner)
                      const neededLands = data.requiredTerritories
                      const fulfilled = controlledLands >= neededLands
                      return <span className={`territory-progress ${fulfilled ? 'territory-progress-met' : 'territory-progress-short'}`}>
                        <span className="territory-progress-title">◆ 必要領土 {neededLands}枚</span>
                        <span className="territory-progress-status">{focused.owner === owner ? '自分' : '相手'}の領土 {controlledLands}枚 ／ {fulfilled ? '領土枚数OK' : `あと${neededLands - controlledLands}枚`}</span>
                      </span>
                    })()}
                    <p>{data?.effectText || '効果なし'}</p>
                  </div>
                </div>
                {data?.category === 'モンスター' && <div className="movement-reference-wrapper">
                  <div className="movement-reference">
                    <strong>移動範囲</strong>
                    <MovementArtwork src={cardImage(focused.cardId)} name={cardName(focused.cardId)} />
                  </div>
                </div>}
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
            <p>領土：{inspectedCell.territory ? cardName(inspectedCell.territory.cardId) : 'なし'}</p>
            <p>モンスター：{inspectedCell.monster ? cardName(inspectedCell.monster.card.cardId) : 'なし'}</p>
            <p>使用中：{inspectedCell.monster?.equippedId ? cardName(inspectedCell.equipments.find(e => e.instanceId === inspectedCell.monster?.equippedId)?.cardId ?? '') : 'なし'}</p>
            <p>設置された装備：{inspectedCell.equipments.map(e => `${cardName(e.cardId)}（${displayPlayer(e.owner)}）`).join('、') || 'なし'}</p>
          </details>}
          <details className="panel-card grave-drawer">
            <summary>墓地を見る（自分 {player.graveyard.length}枚 / 相手 {opponent.graveyard.length}枚）</summary>
            <strong>自分の墓地</strong>
            <div className="grave-list">{player.graveyard.map(card => <img key={card.instanceId} src={cardImage(card.cardId)} alt={cardName(card.cardId)} title={cardName(card.cardId)} />)}</div>
            <strong>相手の墓地</strong>
            <div className="grave-list">{opponent.graveyard.map(card => <img key={card.instanceId} src={cardImage(card.cardId)} alt={cardName(card.cardId)} title={cardName(card.cardId)} />)}</div>
          </details>
        </section>
      </div>
      {game.pendingEffect && !pendingEquip && <div className="optional-effect-backdrop" role="presentation">
        <div className="optional-effect-dialog" role="dialog" aria-modal="true" aria-labelledby="optional-effect-title"
          aria-describedby="optional-effect-description">
          <div className="optional-effect-heading"><span>MONSTER EFFECT</span><strong>任意効果の確認</strong></div>
          <div className="optional-effect-body">
            <img className="optional-effect-art"
              src={cardImage(game.board[game.pendingEffect.cellIndex].monster?.card.cardId ?? '')}
              alt={cardName(game.board[game.pendingEffect.cellIndex].monster?.card.cardId ?? '')} />
            <div className="optional-effect-content">
              <h2 id="optional-effect-title">{cardName(game.board[game.pendingEffect.cellIndex].monster?.card.cardId ?? '')}</h2>
              <p id="optional-effect-description">{game.pendingEffect.kind === 'centaur'
                ? '召喚時の効果：1マス前進しますか？ 移動先に敵がいる場合は戦闘します。'
                : game.pendingEffect.kind === 'mermaid'
                  ? '召喚時の効果：城からカードを1枚引きますか？'
                  : '通常移動の戦闘に勝利しました。さらに1マス前進しますか？ 移動先に敵がいる場合は戦闘します。'}</p>
              <span className="optional-effect-note">{isMyTurn ? '効果を使うか、使わずに進めるかを選択してください' : '相手プレイヤーが効果を選択しています'}</span>
            </div>
          </div>
          <div className="optional-effect-actions">
            <button type="button" className="optional-effect-yes" disabled={!isMyTurn || online.busy} onClick={() => chooseMonsterEffect(true)}>効果を使う</button>
            <button type="button" className="optional-effect-no" disabled={!isMyTurn || online.busy} onClick={() => chooseMonsterEffect(false)}>使わない</button>
          </div>
        </div>
      </div>}
      {optionalEffectCue && effectsEnabled && <div className="optional-effect-used" key={optionalEffectCue.stamp} aria-live="polite">
        <span>MONSTER EFFECT</span><strong>{cardName(optionalEffectCue.cardId)}</strong><span>効果発動</span>
      </div>}
      {equipmentCue && effectsEnabled && <div className="equip-cast-overlay" key={equipmentCue.stamp} aria-live="polite">
        <div className="equip-cast-burst" />
        <div className="equip-cast-card"><img src={cardImage(equipmentCue.cardId)} alt={cardName(equipmentCue.cardId)} /><strong>{cardName(equipmentCue.cardId)}</strong><span>EQUIPPED</span></div>
      </div>}
      {magicCue && effectsEnabled && <div className="spell-cast-overlay" key={magicCue.stamp} aria-live="polite">
        <div className="spell-cast-burst" />
        <div className="spell-cast-card"><img src={cardImage(magicCue.cardId)} alt={cardName(magicCue.cardId)} /><strong>{cardName(magicCue.cardId)}</strong><span>MAGIC CAST</span></div>
      </div>}
      {effectsEnabled && deckDrawCues.map(cue => <img key={cue.stamp} className="deck-draw-flight"
        src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt="" aria-hidden="true"
        style={{ left: cue.left, top: cue.top, width: cue.width, height: cue.height,
          '--draw-x': `${cue.dx}px`, '--draw-y': `${cue.dy}px`, '--draw-delay': `${cue.delayMs}ms` } as CSSProperties} />)}
      {visualCue && <div className={`visual-cue visual-${visualCue.kind}`} key={visualCue.stamp} aria-live="polite" aria-atomic="true">
        <div className="visual-vignette" />
        <div className="visual-strike" />
        <div className="visual-content">
          {visualCue.artworkId && <img className="visual-art" src={artworkImage(visualCue.artworkId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(visualCue.artworkId!) }} alt="" />}
          <span className="visual-category">LANE FRONTIER</span>
          <strong>{visualCue.title}</strong>
          <span className="visual-subtitle">{visualCue.subtitle}</span>
        </div>
      </div>}
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
