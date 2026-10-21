import { useEffect, useState } from 'react'
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
import { DECK_ELEMENTS, createGameWithDecks } from './game/decks'
import { mulligan } from './game/setup'
import { placementTargets } from './game/placementTargets'
import { switchTurn } from './game/phaseFlow'
import { visibleBoardIndices, visibleCoordinate, shouldRotateCard } from './game/view'
import type { DeckElement } from './game/decks'
import type { CardInstance, GameState, PlayerId } from './game/types'
import { useOnlineRoom } from './online/useOnlineRoom'
import { isOnlineConfigured } from './online/config'
import './App.css'

const BUILD_LABEL = 'v0.17.1 ルールリンク追加版'

const PHASE_LABELS: Record<GameState['phase'], string> = {
  start: 'スタート', draw: 'ドロー', develop: '開拓', main: 'メイン', move: '移動', end: 'エンド',
}


function displayPlayer(playerId: PlayerId): string {
  return playerId === 'player1' ? 'プレイヤー1' : 'プレイヤー2'
}

// セーブデータは利用しない。ブラウザの更新・閉じて開き直した時は必ず最初から。
const LEGACY_SAVE_KEY = 'lane-frontier-local-v0.15'


function App() {
  const [game, setGameLocal] = useState<GameState>(createInitialGameState)
  const [screen, setScreen] = useState<'home' | 'local' | 'online'>('home')
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

  function finishMulligan() {
    if (onlineMode && online.session) {
      if (online.busy || online.room?.stage !== 'mulligan' || online.room.mulliganDone[online.session.seat]) return
      const updated = mulligan(game, online.session.seat, mulliganSelected)
      online.commit(updated, 'mulligan')
      setMulliganSelected([])
      return
    }
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
    const result = resolveOptionalMonsterEffect(game, activate)
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
    if (!isMyTurn || online.busy) return
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

  function newGame() {
    if (onlineMode) return
    const first = deckChoices.player1
    const second = deckChoices.player2
    if (!first || !second) return
    setGame(createGameWithDecks(first, second))
    setSetupStage('player1')
    setMulliganSelected([])
    resetSelection()
    setInspect(null)
    setMessage(`${first}デッキ 対 ${second}デッキ：新しい対戦を開始しました`)
  }

  function changeDecks() {
    if (onlineMode) return
    setStarted(false)
    setSetupStage('player1')
    setMulliganSelected([])
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
    resetSelection()
    setInspect(null)
    setInspectedEquipmentId(null)
    setMessage('手札を選ぶか、フェイズを進めてください')
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

  if (screen === 'home') {
    return <main className="home-screen">
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
    const hand = game.players[mulliganPlayer].hand
    return (
      <main className="game-app">
        <header className="game-header"><div><h1>Lane Frontier</h1><p>ゲームの準備・初手の引き直し <span className="test-tag">{BUILD_LABEL}</span></p></div><button type="button" className="small-btn" onClick={goHome}>ホームに戻る</button></header>
        <section className="mulligan-screen">
          <div className="setup-progress">{mulliganPlayer === 'player1' ? '1 / 2' : '2 / 2'}　{displayPlayer(mulliganPlayer)}</div>
          <h2>{displayPlayer(mulliganPlayer)}：マリガン</h2>{onlineMode && <p>自分の手札だけで引き直しを確定してください。相手の手札は画面に表示されません。</p>}
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
          <button type="button" className="phase-next" onClick={finishMulligan} disabled={online.busy}>
            {mulliganSelected.length > 0 ? `${mulliganSelected.length}枚引き直して確定 →` : '引き直さずに確定 →'}
          </button>
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
    <main className="game-app game-in-play">
      <header className="game-header">
        <div className="brand-line">
          <h1>Lane Frontier</h1>
          <span className="version-label">{BUILD_LABEL}</span>
        </div>
        <div className="game-header-actions">
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
      {game.winner && <div className="winner-banner">{displayPlayer(game.winner)}の勝利！ {game.winReason}</div>}
      {onlineMode && <div className="online-match-bar">部屋 {online.session?.code} ｜ あなたは{displayPlayer(owner)} ｜ {isMyTurn ? 'あなたの手番' : canResolveEquipment ? '装備を選んでください' : '相手の手番・操作待ち'} {online.busy ? '｜通信中…' : ''}</div>}
      {onlineMode && online.error && <div className="online-error" role="alert">{online.error}</div>}
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
              const isDestination = destinations.includes(index) && !selectedCard
              const isSelectedMonster = movingFrom === index
              const isMagicTarget = magicTargets.includes(index)
              const isPlacementTarget = placingTargets.includes(index)
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
                  {cell.monster && <span className="stats"><span>ATK {attackAt(game, index) ?? '?'}</span><span>DEF {defenseAt(game, index) ?? '?'}</span></span>}
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
            <strong>{displayPlayer(game.activePlayer)}の手番</strong>
            <span>ターン {game.turn} ・ {PHASE_LABELS[game.phase]}フェイズ</span>
          </div>
          <button type="button" className="phase-next hand-phase-next" onClick={nextPhase}
            disabled={!isMyTurn || online.busy || !!game.winner || !!pendingEquip || !!game.pendingEffect}>
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
              if (onlineMode && (!isMyTurn || online.busy)) return
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
              <button type="button" disabled={!isMyTurn || online.busy} onClick={() => chooseMonsterEffect(true)}>効果を使う</button>
              <button type="button" disabled={!isMyTurn || online.busy} className="skip-effect" onClick={() => chooseMonsterEffect(false)}>使わない</button>
            </div>
          </div>}
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
                    {typeof data?.requiredTerritories === 'number' && <span>必要領土数 {data.requiredTerritories}</span>}
                    <p>{data?.effectText || '効果なし'}</p>
                  </div>
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
