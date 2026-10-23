import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { addCardToCell } from './game/cardPlacement'
import { castMagic } from './game/magic'
import { attackAt, canMoveNow, cardImage, cardInfo, cardName, defenseAt, drawCards, legalMoves, moveAndBattle, territoryCount } from './game/logic'
import { placementTargets } from './game/placementTargets'
import { createLessonScene } from './game/tutorialScenes'
import type { LessonMode, LessonStep } from './game/tutorialScenes'
import { TUTORIAL } from './game/tutorial'
import type { CardInstance, GameState } from './game/types'
import { artworkImage } from './artworkManifest'
import { MovementArtwork } from './components/MovementArtwork'
import './Tutorial.css'

const MENU: { mode: LessonMode; title: string; summary: string; symbol: string }[] = [
  { mode: 'develop', title: '開拓', summary: '城の周りと領土の隣接条件', symbol: '◇' },
  { mode: 'summon', title: '召喚', summary: '必要領土数と属性', symbol: '♜' },
  { mode: 'move', title: '移動・戦闘', summary: '移動範囲・ATKとDEF', symbol: '⚔' },
  { mode: 'magic', title: 'マジック', summary: '大海の恵みで手札交換', symbol: '✦' },
  { mode: 'equipment', title: '装備', summary: '調和の槍でドローと戦闘', symbol: '▱' },
  { mode: 'victory', title: '勝利条件', summary: '相手の城へ到達して勝つ', symbol: '♛' },
  { mode: 'all', title: '全部合わせて', summary: '6種類のルールを順番に学ぶ', symbol: '★' },
]

type LessonText = { title: string; explain: string; explain2?: string; task: string }
const CONTENT: Record<Exclude<LessonStep, 'done'>, LessonText> = {
  develop: {
    title: '領土を配置しよう',
    explain: '開拓フェイズには領土を1枚配置できます。自分の城か、自分の領土の上下左右に接した空きマスを選びます。',
    explain2: '特殊領土には、さらに開拓するための条件があります。',
    task: '手札の「焦土」を選び、金色のマスに配置しよう。',
  },
  summon: {
    title: 'モンスターを召喚しよう',
    explain: 'カードの「必要領土数」は、そのカードを使うために必要な自分の領土の枚数です。例えば2枚なら、自分の領土が2枚以上必要です。',
    explain2: '城は枚数に含まず、領土の属性は問いません。召喚先には、モンスターと同じ属性の自分の領土を選びます。',
    task: '「サラマンダー」（必要領土数2枚）を選び、金色の火の領土に召喚しよう。',
  },
  'turn-change': {
    title: '召喚ターンの移動制限',
    explain: '通常、モンスターは召喚したターンには移動できません。「突撃」などの効果がある場合だけ例外です。',
    explain2: 'この練習ではターン3に召喚しています。相手のターン4を省略し、次の自分のターン5へ進んでから移動を練習します。',
    task: '次の自分のターンに進もう。',
  },
  move: {
    title: '移動して戦闘しよう',
    explain: '移動フェイズではモンスターを1体選び、そのカードの移動範囲へ移動できます。移動先に相手のモンスターがいれば戦闘です。',
    explain2: '攻撃するモンスターのATKと相手のDEFを比較します。ATKが大きければ勝利、同じなら相討ち、小さければ敗北です。',
    task: '自分のサラマンダーを選び、光る相手モンスターへ移動してみよう。',
  },
  magic: {
    title: 'マジックを使おう',
    explain: 'マジックはメインフェイズに使用します。必要領土数を満たし、同じ属性の自分の領土が1枚以上必要です。',
    explain2: '水属性の「大海の恵み」は、手札を1枚捨てて2枚引く効果。使用するマジック自身も手札からなくなります。',
    task: '「大海の恵み」を選び、次に捨てる「浅瀬」を選ぼう。城（山札）から2枚ドローします。',
  },
  equipment: {
    title: '装備して強くなろう',
    explain: '装備はメインフェイズに、同じ属性の自分の領土へ配置します。必要領土数も満たす必要があります。召喚と装備は合わせて1ターンに1回です。',
    explain2: '「調和の槍」は装備時に1枚ドローし、装備したモンスターのATKを1上げます。使用中の装備はモンスター1体につき1枚です。',
    task: '「調和の槍」を選び、金色の浅瀬にいるモンスターに装備させよう。',
  },
  'equip-battle': {
    title: '装備の力で戦ってみよう',
    explain: '装備した「調和の槍」でATKが2から3に上がりました。相手のDEFは2です。',
    explain2: '装備しなければATK 2＝DEF 2で相討ちですが、今はATK 3＞DEF 2なので勝てます。召喚ターンではない次の自分のターンに進んでいます。',
    task: '「親和するマーメイド」を選び、敵のマスへ移動して勝利を確かめよう。',
  },
  victory: {
    title: '勝利条件①：相手の城に到達する',
    explain: '自分のモンスターが相手の城までたどり着くと勝利です。ここまでに学んだ移動のルールで、最後の1マスを進もう。',
    explain2: '今回は、自分の領土を前進してきたモンスターが城の1マス手前にいます。召喚したターンではないので移動できます。',
    task: '親和するマーメイドを選び、相手の城に移動して勝利しよう。',
  },

}
const STEP_ORDER: LessonStep[] = ['develop', 'summon', 'turn-change', 'move', 'magic', 'equipment', 'equip-battle', 'victory', 'done']
const OVERVIEW = {
  title: 'レーンフロンティアとは？',
  explain: '自分の城を拠点に領土を広げ、モンスターを召喚して進軍する、陣取り型の対戦カードゲームです。',
  explain2: '城から領土を広げ、モンスターを進めて相手の城を目指します。ここでは対戦に必要な行動を順番に体験できます。',
  task: 'ルールを見てから、実際のカードを操作してみよう。',
}

type RulePoint = { label: string; text: string }
const RULE_POINTS: Record<Exclude<LessonStep, 'done'>, RulePoint[]> = {
  develop: [
    { label: '回数', text: '開拓フェイズに領土を1枚配置する。' },
    { label: '場所', text: '自分の城・領土の上下左右に隣接する空きマス。斜めは不可。' },
    { label: '特殊領土', text: '通常の開拓条件に加えて、カードごとの条件があります。' },
  ],
  summon: [
    { label: '必要領土数', text: '必要な枚数以上の自分の領土を持っていること。城は数えず、属性も問わない。' },
    { label: '召喚先', text: 'そのモンスターと同じ属性の自分の領土。' },
    { label: '回数', text: '召喚と装備は合わせて1ターンに1回。' },
  ],
  'turn-change': [
    { label: '召喚ターン', text: '基本的に、召喚したターンには移動できない。突撃などは例外。' },
    { label: 'ターン経過', text: 'ターン3に召喚→相手ターン4→自分ターン5に移動。' },
  ],
  move: [
    { label: '移動', text: '移動フェイズにモンスター1体を、カードに示された範囲へ動かす。' },
    { label: '戦闘', text: '移動先に相手モンスターがいると戦闘が起こる。' },
    { label: '勝敗', text: 'ATK＞相手DEFなら勝利、＝なら相討ち、＜なら敗北。' },
  ],
  magic: [
    { label: '使用条件', text: 'メインフェイズ。必要領土数と同属性の自分の領土1枚以上が必要。' },
    { label: '大海の恵み', text: '手札1枚を捨てて2枚引く。使用したマジック自体も手札からなくなる。' },
  ],
  equipment: [
    { label: '使用条件', text: 'メインフェイズに同属性の自分の領土へ置く。必要領土数を満たす。' },
    { label: '回数', text: '召喚と装備は合わせて1ターンに1回。1体が使用する装備は1枚。' },
    { label: '調和の槍', text: '装備したとき1枚引く。使用しているモンスターはATK＋1。' },
  ],
  'equip-battle': [
    { label: '装備前', text: '自分ATK 2＝敵DEF 2。戦闘は相討ち。' },
    { label: '装備後', text: '調和の槍でATK＋1→3。ATK 3＞DEF 2で勝てる。' },
    { label: '移動制限', text: '次の自分のターンに移動して戦う。' },
  ],
  victory: [
    { label: '勝利①', text: '自分のモンスターが相手の城へ到達すると勝利。' },
    { label: '移動条件', text: '城がそのモンスターの移動範囲にあり、そのターンに移動できること。' },
    { label: '結果', text: 'モンスターが相手の城に到達した時点で勝敗が決まります。' },
  ],

}

type StandardCue = { kind: 'deploy' | 'summon' | 'victory'; title: string; subtitle: string; artworkId?: string; id: number }
type MovingCue = { id: number; cardId: string; left: number; top: number; width: number; height: number; dx: number; dy: number; battle: boolean }
type Effect = { index: number; kind: 'develop' | 'summon' | 'move' | 'magic' | 'equipment'; id: number }
// 通常対戦と同じ墓地送り演出のデータ。実際の墓地追加を検知して再生する。
type GraveFlyCue = {
  id: number; cardId: string; left: number; top: number; width: number; height: number;
  dx: number; dy: number; delayMs: number
}

export function Tutorial({ onHome }: { onHome: () => void }) {
  const [mode, setMode] = useState<LessonMode | null>(null)
  const [step, setStep] = useState<LessonStep>('develop')
  const [game, setGame] = useState<GameState>(() => createLessonScene('develop'))
  const [reading, setReading] = useState(true)
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [selectedHand, setSelectedHand] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  const [inspectedCell, setInspectedCell] = useState<number | null>(null)
  const [inspectedCard, setInspectedCard] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [finished, setFinished] = useState(false)
  const [battleSummary, setBattleSummary] = useState('')
  const [effect, setEffect] = useState<Effect | null>(null)
  const [newHandIds, setNewHandIds] = useState<string[]>([])
  const [standardCue, setStandardCue] = useState<StandardCue | null>(null)
  const [spellCue, setSpellCue] = useState<number | null>(null)
  const [equipCue, setEquipCue] = useState<number | null>(null)
  const [movingCue, setMovingCue] = useState<MovingCue | null>(null)
  const [graveFlyCues, setGraveFlyCues] = useState<GraveFlyCue[]>([])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const victoryTimer = useRef<number | null>(null)
  const impactTimer = useRef<number | null>(null)
  const graveTimer = useRef<number | null>(null)
  useEffect(() => () => { if(victoryTimer.current !== null) window.clearTimeout(victoryTimer.current); if(impactTimer.current !== null) window.clearTimeout(impactTimer.current); if(graveTimer.current !== null) window.clearTimeout(graveTimer.current) }, [])
  useEffect(() => {
    if (!standardCue) return
    const timer = window.setTimeout(() => setStandardCue(null), standardCue.kind === 'victory' ? 2800 : 1100)
    return () => window.clearTimeout(timer)
  }, [standardCue])
  useEffect(() => {
    if (spellCue === null) return
    const timer = window.setTimeout(() => setSpellCue(null), 1250)
    return () => window.clearTimeout(timer)
  }, [spellCue])
  useEffect(() => {
    if (equipCue === null) return
    const timer = window.setTimeout(() => setEquipCue(null), 1350)
    return () => window.clearTimeout(timer)
  }, [equipCue])
  useEffect(() => {
    if (!movingCue) return
    const timer = window.setTimeout(() => setMovingCue(null), 930)
    return () => window.clearTimeout(timer)
  }, [movingCue])

  const lesson = step === 'done' ? null : CONTENT[step]
  const hand = game.players.player1.hand
  const activeCard = hand.find(c => c.instanceId === selectedHand) ?? null
  const isMoving = step === 'move' || step === 'equip-battle' || step === 'victory'
  const target = step === 'develop' ? TUTORIAL.landIndex : 17
  const moveOrigin = step === 'victory' ? 7 : TUTORIAL.landIndex
  const moveDestination = step === 'victory' ? 2 : TUTORIAL.enemyIndex
  const moveTargets = isMoving && selectedCell === moveOrigin ? legalMoves(game, moveOrigin) : []
  const focusCards = step === 'develop' ? ['LF-009'] : step === 'summon' ? ['LF-001'] : step === 'magic' ? ['LF-023'] : step === 'equipment' ? ['LF-025'] : []
  const practiceCard = hand.find(c => focusCards.includes(c.cardId))
  const realTargets = practiceCard && (step === 'develop' || step === 'summon' || step === 'equipment')
    ? placementTargets(game, practiceCard, 'player1') : []
  const infoId = inspectedCard ?? activeCard?.cardId ?? null
  const info = infoId ? cardInfo(infoId) : null
  const focusedPlayer = game.board[inspectedCell ?? target]

  function begin(nextMode: LessonMode) {
    if (victoryTimer.current !== null) window.clearTimeout(victoryTimer.current)
    if (impactTimer.current !== null) window.clearTimeout(impactTimer.current)
    const nextStep: LessonStep = nextMode === 'all' ? 'develop' : nextMode
    setMode(nextMode); setStep(nextStep); setGame(createLessonScene(nextStep))
    setReading(true); setOverviewOpen(nextMode === 'all'); setFinished(false)
    setSelectedHand(null); setSelectedCell(null); setInspectedCard(null); setInspectedCell(null)
    setFeedback(''); setBattleSummary(''); setEffect(null); setNewHandIds([]); setStandardCue(null); setSpellCue(null); setEquipCue(null); setMovingCue(null); setGraveFlyCues([])
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function goMenu() {
    if (victoryTimer.current !== null) window.clearTimeout(victoryTimer.current)
    if (impactTimer.current !== null) window.clearTimeout(impactTimer.current)
    setMode(null); setStep('develop'); setSelectedHand(null); setSelectedCell(null)
    setInspectedCard(null); setInspectedCell(null); setFinished(false); setFeedback(''); setBattleSummary(''); setStandardCue(null); setGraveFlyCues([])
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
  }
  function showEffect(index: number, kind: Effect['kind'], cardId?: string) {
    const id = Date.now()
    if(impactTimer.current !== null) window.clearTimeout(impactTimer.current)
    if(kind === 'move') impactTimer.current = window.setTimeout(() => {setEffect({index,kind,id});impactTimer.current=null}, 345)
    else setEffect({ index, kind, id })
    if (kind === 'develop' || kind === 'summon') {
      setStandardCue({kind: kind === 'develop' ? 'deploy' : 'summon',
        title: kind === 'develop' ? 'FRONTIER' : 'SUMMON', subtitle: cardName(cardId ?? ''), artworkId: cardId, id})
    } else if (kind === 'magic') setSpellCue(id)
    else if (kind === 'equipment') setEquipCue(id)
  }
  function playNormalMovement(from: number, to: number, cardId: string, battle: boolean) {
    const parent = boardRef.current
    const fromEl = parent?.querySelector<HTMLElement>(`[data-cell-index="${from}"]`)
    const toEl = parent?.querySelector<HTMLElement>(`[data-cell-index="${to}"]`)
    if (!fromEl || !toEl || !parent) return
    const boardBox = parent.getBoundingClientRect()
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect()
    setMovingCue({id:Date.now(),cardId,battle,left:a.left-boardBox.left,top:a.top-boardBox.top,width:a.width,height:a.height,
      dx:b.left+b.width/2-a.left-a.width/2,dy:b.top+b.height/2-a.top-a.height/2})
  }

  function playNormalGraveFlight(before: GameState, after: GameState, battleIndex: number) {
    const board = boardRef.current
    const target = board?.querySelector<HTMLElement>(`[data-cell-index="${battleIndex}"]`)
    if (!board || !target) return
    const boardRect = board.getBoundingClientRect(), rect = target.getBoundingClientRect()
    const deaths = (['player1','player2'] as const).flatMap(player =>
      after.players[player].graveyard.filter(c => c.cardId && !before.players[player].graveyard.some(old => old.instanceId === c.instanceId)))
      .filter(c => cardInfo(c.cardId)?.category === 'モンスター')
    if (!deaths.length) return
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    const x = rect.left - boardRect.left + rect.width / 2
    const y = rect.top - boardRect.top + rect.height / 2
    setGraveFlyCues(deaths.map((dead, i) => ({
      id: Date.now() + i, cardId: dead.cardId,
      left: rect.left - boardRect.left, top: rect.top - boardRect.top,
      width: rect.width, height: rect.height,
      dx: boardRect.width - 30 - x, dy: 12 - y,
      delayMs: 450 + i * 90,
    })))
    graveTimer.current = window.setTimeout(() => { setGraveFlyCues([]); graveTimer.current = null }, 450 + 1050 + deaths.length * 90)
  }

  function completeAction(nextGame: GameState, response: string, index: number, kind: Effect['kind'], cardId?: string) {
    setNewHandIds(nextGame.players.player1.hand.filter(c => !game.players.player1.hand.some(old => old.instanceId === c.instanceId)).map(c => c.instanceId))
    setGame(nextGame); setFinished(true); setSelectedHand(null); setSelectedCell(null)
    setFeedback(response); showEffect(index, kind, cardId)
    if (nextGame.winner) {
      if (victoryTimer.current !== null) window.clearTimeout(victoryTimer.current)
      victoryTimer.current = window.setTimeout(() => {setStandardCue({kind:'victory',title:'VICTORY',subtitle:'プレイヤー1の勝利',id:Date.now()});victoryTimer.current=null}, 640)
    }
  }
  function next() {
    if (victoryTimer.current !== null) window.clearTimeout(victoryTimer.current)
    if (impactTimer.current !== null) window.clearTimeout(impactTimer.current)
    let nextStep: LessonStep
    if (step === 'equipment') nextStep = 'equip-battle'
    else if (mode !== 'all') nextStep = 'done'
    else nextStep = STEP_ORDER[STEP_ORDER.indexOf(step) + 1] ?? 'done'
    setStep(nextStep); setSelectedHand(null); setSelectedCell(null); setFinished(false)
    setFeedback(''); setBattleSummary(''); setEffect(null); setNewHandIds([]); setStandardCue(null); setSpellCue(null); setEquipCue(null); setMovingCue(null); setGraveFlyCues([]); setReading(true)
    if (graveTimer.current !== null) window.clearTimeout(graveTimer.current)
    setInspectedCard(null); setInspectedCell(null)
    if (nextStep === 'magic' || nextStep === 'equipment' || nextStep === 'victory') setGame(createLessonScene(nextStep))
    if (nextStep === 'move' || nextStep === 'equip-battle') {
      setGame(prev => ({ ...prev, turn: nextStep === 'move' ? 5 : 7, phase: 'move',
        mainActionUsedThisTurn: false, territoryPlayedThisTurn: false, moveUsedThisTurn: false }))
    }
  }
  function doBattle(from: number, to: number) {
    const attacker = game.board[from].monster
    const defender = game.board[to].monster
    const atk = attackAt(game, from) ?? 0
    const def = defenseAt(game, to) ?? 0
    const result = moveAndBattle(game, from, to, true)
    if (result.game === game) { setFeedback(result.message); return }
    const verdict = atk > def ? '勝利' : atk === def ? '相討ち' : '敗北'
    const comparison = atk > def ? '＞' : atk === def ? '＝' : '＜'
    const extra = step === 'equip-battle' ? '装備前ならATK 2＝DEF 2で相討ち。調和の槍によるATK＋1で勝利！' : ''
    const summary = `${cardName(attacker!.card.cardId)}のATK ${atk} ${comparison} ${cardName(defender!.card.cardId)}のDEF ${def} → ${verdict}。${extra}`
    setBattleSummary(summary)
    playNormalMovement(from,to,attacker!.card.cardId,true)
    playNormalGraveFlight(game, result.game, to)
    setInspectedCell(to)
    setInspectedCard(attacker!.card.cardId)
    completeAction(result.game, summary, to, 'move')
  }
  function clickCell(index: number) {
    const cell = game.board[index]
    // 練習中でも敵味方すべてのカードを確認できるよう、クリックと選択表示を分離する。
    setInspectedCell(index)
    setInspectedCard(cell.monster?.card.cardId ?? cell.territory?.cardId ?? cell.equipments[0]?.cardId ?? null)
    if (reading || finished || step === 'turn-change' || step === 'done') return
    if (isMoving) {
      if (selectedCell === null) {
        if (index !== moveOrigin || !canMoveNow(game, index)) {
          setFeedback('カード詳細は右側で確認できます。移動するには、まず自分のモンスターを選ぼう。'); return
        }
        setSelectedCell(index); setFeedback('次は金色に光る相手モンスターを選ぼう。'); return
      }
      if (index !== moveDestination || !moveTargets.includes(index)) {
        setFeedback('カード詳細は右側で確認できます。移動は金色に光るマスを選ぼう。'); return
      }
      if (step === 'victory') {
        const mover = game.board[selectedCell].monster!
        const result = moveAndBattle(game,selectedCell,index,true)
        if (!result.game.winner) { setFeedback(result.message); return }
        playNormalMovement(selectedCell,index,mover.card.cardId,false)
        completeAction(result.game,'勝利！親和するマーメイドが相手の城に到達しました。勝利条件①を満たしました。',index,'move')
        setBattleSummary('相手の城に到達したため勝利。戦闘でモンスターを倒す必要はありません。')
      } else doBattle(selectedCell, index)
      return
    }
    if (step === 'magic') {
      setFeedback('大海の恵みを使うには、手札からマジックと捨てるカードを順番に選ぼう。')
      return
    }
    if (!activeCard) { setFeedback('手札のカードを選んでから、配置するマスを選ぼう。'); return }
    if (index !== target) {
      setFeedback(realTargets.includes(index)
        ? 'ここも正式なルールでは配置可能。練習では金色のマスに配置してみよう。'
        : 'このマスには配置できません。城や自分の領土からの隣接条件も確認してみよう。')
      return
    }
    if (!realTargets.includes(index)) { setFeedback('必要領土数や属性などの配置条件を確認しよう。'); return }
    if (!focusCards.includes(activeCard.cardId)) { setFeedback('この練習で指定されたカードを選んでください。'); return }
    const updated = addCardToCell(cell, activeCard, game.turn)
    if (!updated) { setFeedback('このマスには配置できません。'); return }
    let nextGame: GameState = { ...game,
      phase: step === 'develop' ? 'main' : game.phase,
      territoryPlayedThisTurn: step === 'develop' || game.territoryPlayedThisTurn,
      mainActionUsedThisTurn: step !== 'develop' || game.mainActionUsedThisTurn,
      board: game.board.map((c, i) => i === index ? updated : c),
      players: { ...game.players, player1: { ...game.players.player1,
        hand: hand.filter(c => c.instanceId !== activeCard.instanceId) } },
    }
    let response = `${cardName(activeCard.cardId)}を配置しました。`
    if (step === 'equipment') {
      // autoEquip によって装備したときの「調和の槍」効果を通常対戦と同様に処理。
      const attached = updated.monster?.equippedId === activeCard.instanceId
      if (attached && activeCard.cardId === 'LF-025') {
        const before = nextGame.players.player1.hand.length
        nextGame = drawCards(nextGame, 'player1', 1)
        const drawn = nextGame.players.player1.hand.length - before
        response = `調和の槍の使用条件を満たして装備できました。装備時の効果で${drawn}枚引き、ATKが2→3になりました。攻撃力の差は、次の戦闘で確認しよう。`
      }
    }
    setInspectedCard(activeCard.cardId)
    completeAction(nextGame, response, index, step, activeCard.cardId)
  }
  function clickHand(card: CardInstance) {
    setInspectedCard(card.cardId); setInspectedCell(null)
    if (reading || finished || step === 'done') return
    if (step === 'magic' && selectedHand && selectedHand !== card.instanceId &&
        hand.find(c => c.instanceId === selectedHand)?.cardId === 'LF-023') {
      const result = castMagic(game, selectedHand, { discardInstanceId: card.instanceId })
      if (!result.success) { setFeedback(result.message); return }
      const beforeDeck = game.players.player1.deck.length
      const afterDeck = result.game.players.player1.deck.length
      completeAction(result.game,
        `${cardName(card.cardId)}を捨てて2枚ドロー！ 城（山札）は${beforeDeck}→${afterDeck}枚。`,
        17, 'magic')
      return
    }
    setSelectedHand(card.instanceId)
    setFeedback(step === 'magic' ? (card.cardId === 'LF-023' ? '次に、捨てるカード「浅瀬」を選ぼう。' : 'まず「大海の恵み」を選ぼう。') : '金色に光るマスを選ぼう。')
  }
  function onContinue() {
    if (overviewOpen) { setOverviewOpen(false); setReading(true); return }
    setReading(false)
    if (step === 'turn-change') { next(); return }
    setFeedback('')
  }

  const title = mode ? MENU.find(c => c.mode === mode)?.title : 'チュートリアル'
  const currentLabel = step === 'turn-change' ? '移動・戦闘' : step === 'equip-battle' ? '装備' : MENU.find(x => x.mode === step)?.title ?? '完了'
  const shown = overviewOpen ? OVERVIEW : lesson

  return <main className="lesson-page">
    <header className="lesson-topbar">
      <div><small>LANE FRONTIER · LEARN</small><h1>Lane Frontier <span>遊び方</span></h1></div>
      <div className="lesson-top-actions"><button onClick={goMenu} disabled={!mode}>項目を選び直す</button><button onClick={onHome}>ホームへ</button></div>
    </header>
    {!mode ? <section className="lesson-menu" aria-label="チュートリアル選択">
      <p className="lesson-overline">HOW TO PLAY</p><h2>学びたいルールを選ぼう</h2>
      <p>紙版と共通のルールを、実際にカードを動かしながら学べます。</p>
      <div className="lesson-menu-grid">{MENU.map(item => <button key={item.mode} className={`lesson-option ${item.mode === 'all' ? 'all' : ''}`} onClick={() => begin(item.mode)}>
        {item.mode === 'all' && <span className="lesson-option-recommended">初めてならこれ！</span>}
        <span className="lesson-option-symbol">{item.symbol}</span><strong>{item.title}</strong><small>{item.summary}</small><span className="lesson-option-arrow">→</span>
      </button>)}</div>
    </section> : <>
      <div className="lesson-heading"><span>{mode === 'all' ? '全体コース' : `${title}コース`}</span><strong>{step === 'done' ? '体験完了' : currentLabel}</strong><button onClick={() => begin(mode)}>最初から</button></div>
      {step === 'done' ? <section className="lesson-done">
        <h2>準備は整った。<br />さあ、開拓を始めよう。</h2>
        <p>進む道も、戦い方も、君次第。<br />自分だけの戦略で、勝利をつかめ。</p>
        <div><button onClick={goMenu}>ほかの項目を学ぶ</button><a href="https://lane-frontier-game.github.io/lane-frontier/rules.html" target="_blank" rel="noreferrer">公式ルールを読む ↗</a></div>
      </section> : <>
        <section className="lesson-flow" aria-label="学習中の項目">
          <span className="lesson-step-num">{mode === 'all' ? `${step === 'develop' ? 1 : step === 'summon' ? 2 : step === 'move' || step === 'turn-change' ? 3 : step === 'magic' ? 4 : step === 'equipment' || step === 'equip-battle' ? 5 : 6} / 6` : '個別練習'}</span>
          <div><strong>{lesson?.title}</strong><p>{finished ? '操作の結果を確認してから次へ進もう' : '① 条件を確認　→　② 操作　→　③ 結果を理解'}</p></div>
          <button className="lesson-replay-rule" onClick={() => { setOverviewOpen(false); setReading(true) }}>最初の説明を見る</button>
        </section>
        {lesson && <section className={`lesson-pinned ${finished ? 'is-complete' : ''}`} aria-label="操作の案内" aria-live="polite">
          <span className="lesson-action-icon" aria-hidden="true">{finished ? '✓' : '→'}</span>
          <div className="lesson-action-main"><strong>{finished ? 'できたこと・結果' : '今すること'}</strong>
            <p>{finished ? feedback : step === 'turn-change' ? '召喚したターンには通常移動できません。次の自分のターンに進もう。' : lesson.task}</p>
          </div>
          {finished && <button className="lesson-continue" onClick={next}>{step === 'equipment' ? '次は装備後の戦闘 →' : mode === 'all' ? '次の内容へ →' : '練習を終える →'}</button>}
        </section>}
        <nav className="lesson-mobile-jump" aria-label="練習画面内の移動">
          <a href="#lf-lesson-board">戦場</a><a href="#lf-lesson-hand">手札・カード</a><a href="#lf-lesson-rules">ルール</a>
        </nav>
        <div className={`lesson-workspace ${reading ? 'is-reading' : ''}`}>
          <section className="lesson-board-panel" id="lf-lesson-board"><div className="lesson-panel-heading"><h2>戦場</h2><small>上：相手の城 / 下：自分の城</small></div>
            <div className="lesson-board-grid" ref={boardRef}>{game.board.map((cell,i) => {
              const isLessonTarget = (isMoving && (selectedCell === moveOrigin ? i === moveDestination : i === moveOrigin)) ||
                (step === 'develop' || step === 'summon' || step === 'equipment') && i === target
              const isValid = realTargets.includes(i)
              const effectHere = effect?.index === i
              return <button type="button" key={i} data-cell-index={i} onClick={() => clickCell(i)} disabled={reading}
                className={`lesson-cell ${cell.castleOwner ? 'castle' : ''} ${cell.territory ? cell.territory.owner === 'player1' ? 'mine' : 'rival' : ''} ${isValid ? 'valid-cell' : ''} ${isLessonTarget ? 'target-cell' : ''} ${selectedCell === i ? 'picked-cell' : ''} ${inspectedCell === i ? 'inspect-cell' : ''} ${effectHere && effect?.kind === 'summon' ? 'summon-arriving' : ''} {effectHere && effect?.kind === 'move' ? 'move-impact' : ''}`}
                title={cell.monster ? cardName(cell.monster.card.cardId) : cell.territory ? cardName(cell.territory.cardId) : '空きマス'}>
                {cell.castleOwner && <><img className="lesson-castle-img" src={`${import.meta.env.BASE_URL}cards/LF-card.jpg`} alt="" /><span className="lesson-castle-label">{cell.castleOwner === 'player1' ? '自分の城' : '相手の城'}</span></>}
                {cell.territory && <img className="lesson-territory-img" src={artworkImage(cell.territory.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(cell.territory!.cardId) }} alt="" />}
                {cell.monster && <><img className="lesson-monster-img" src={artworkImage(cell.monster.card.cardId)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = cardImage(cell.monster!.card.cardId) }} alt="" />
                  <span className="lesson-monster-label">{cardName(cell.monster.card.cardId)}</span>
                  <span className="lesson-monster-stats">ATK <span className={`stat-number ${typeof attackAt(game,i) === 'number' && attackAt(game,i)! > Number(cardInfo(cell.monster.card.cardId)?.attack) ? 'stat-buffed' : ''}`}>{attackAt(game,i)}</span> / DEF <span className={`stat-number ${typeof defenseAt(game,i) === 'number' && defenseAt(game,i)! > Number(cardInfo(cell.monster.card.cardId)?.defense) ? 'stat-buffed' : ''}`}>{defenseAt(game,i)}</span></span></>}
                {isValid && !isLessonTarget && !reading && !finished && <span className="lesson-valid-label">配置可</span>}
                {isLessonTarget && !reading && !finished && <span className="lesson-target-label">{isMoving ? selectedCell === moveOrigin ? '戦闘' : '選択' : '練習'}</span>}

              </button>
            })}
              {movingCue && <div key={movingCue.id} className={`board-move-flight ${movingCue.battle ? 'move-battle' : ''}`} aria-hidden="true"
                style={{left:movingCue.left,top:movingCue.top,width:movingCue.width,height:movingCue.height,
                  '--move-x':`${movingCue.dx}px`,'--move-y':`${movingCue.dy}px`,
                  '--move-short-x':`${movingCue.dx*.12}px`,'--move-short-y':`${movingCue.dy*.12}px`} as CSSProperties}>
                <div className="board-move-monster"><img src={artworkImage(movingCue.cardId)} onError={e => { e.currentTarget.onerror=null; e.currentTarget.src=cardImage(movingCue.cardId) }} alt="" /></div>
                <span className="board-move-streak" />
              </div>}
              {graveFlyCues.length > 0 && <>
                <span className="battle-grave-target" aria-hidden="true">墓地</span>
                {graveFlyCues.map(dead => <div key={dead.id} className="battle-grave-flight"
                  style={{left:dead.left, top:dead.top, width:dead.width, height:dead.height,
                    '--grave-x':`${dead.dx}px`, '--grave-y':`${dead.dy}px`,
                    '--grave-delay':`${dead.delayMs}ms`} as CSSProperties} aria-hidden="true">
                  <img src={artworkImage(dead.cardId)} onError={e => {e.currentTarget.onerror=null; e.currentTarget.src=cardImage(dead.cardId)}} alt=""/>
                </div>)}
              </>}
            </div>
            <div className="lesson-board-caption" aria-label="盤面の表示の意味"><span><i className="legend-dot my"/>自分の領土</span><span><i className="legend-dot enemy"/>相手の領土</span>
              {(step === 'develop' || step === 'summon' || step === 'equipment') && <><span><i className="legend-dot valid"/>ルール上配置可能</span><span><i className="legend-dot demo"/>今回の練習先</span></>}
              {isMoving && <span><i className="legend-dot demo"/>今回の移動先</span>}</div>
            {battleSummary && <div className="lesson-battle-result" role="status"><strong>戦闘結果の解説</strong><p>{battleSummary}</p></div>}
          </section>
          <section className="lesson-control-panel">
            {lesson && <aside className="lesson-reference" id="lf-lesson-rules" aria-label="現在のルール説明">
              <div className="lesson-reference-heading"><div><small>RULE GUIDE</small><h2>{currentLabel}のルール</h2></div><button type="button" onClick={() => { setOverviewOpen(false); setReading(true) }} title="大きく説明を読み直す">拡大して読む</button></div>
              <div className="lesson-rule-items">{RULE_POINTS[step as Exclude<LessonStep,'done'>].map(point =>
                <div key={point.label} className="lesson-rule-item"><b>{point.label}</b><span>{point.text}</span></div>)}</div>
            </aside>}
            <div className="lesson-panel-heading" id="lf-lesson-hand"><h2>手札・カード情報</h2><small>自分・相手のカードを選んで確認</small></div>
            <div className="lesson-hand">{hand.length ? hand.map((card: CardInstance) => <button type="button" key={card.instanceId} disabled={reading} className={`lesson-hand-card ${newHandIds.includes(card.instanceId) ? 'newly-drawn' : ''} ${selectedHand === card.instanceId ? 'chosen' : ''} ${focusCards.includes(card.cardId) ? 'important' : ''} ${step === 'magic' && !reading && !finished && activeCard?.cardId === 'LF-023' && card.instanceId !== selectedHand ? 'discard-candidate' : ''}`} onClick={() => clickHand(card)}>
              <img src={cardImage(card.cardId)} alt="" /><strong>{cardName(card.cardId)}</strong>
              {step === 'magic' && !reading && !finished && activeCard?.cardId === 'LF-023' && card.instanceId !== selectedHand && <span className="lesson-discard-label">捨てるカード</span>}
              {typeof cardInfo(card.cardId)?.requiredTerritories === 'number' && <small>必要領土 {cardInfo(card.cardId)?.requiredTerritories}枚</small>}
            </button>) : <p className="lesson-no-hand">この練習で手札は使用しません。盤面のカードはクリックして確認できます。</p>}</div>
            <div className="lesson-status-bar"><span>相手の城：{game.players.player2.deck.length}枚</span><span>自分の領土：{territoryCount(game,'player1')}枚</span><span>手札：{hand.length}枚</span><span>城：{game.players.player1.deck.length}枚</span><span>ターン：{game.turn}</span></div>
            {isMoving && <p className="lesson-rule-note">召喚したターンは通常移動できません。今は次の自分のターンです。</p>}
            {step === 'magic' && <p className="lesson-rule-note">まず「大海の恵み」を選び、次に捨てるカードを選びます。2枚ドローしたら手札・城の枚数を確認しよう。</p>}
            {(step === 'equipment' || step === 'equip-battle') && <p className="lesson-rule-note">調和の槍：装備時1ドロー、装備中ATK＋1。装備前はATK 2、装備後はATK 3です。</p>}
            {inspectedCell !== null && (focusedPlayer.monster || focusedPlayer.territory || focusedPlayer.equipments.length>0) && <div className="lesson-layer-chooser"><strong>選んだマスのカード</strong>{[focusedPlayer.monster?.card, focusedPlayer.territory, ...focusedPlayer.equipments].filter((c):c is CardInstance=>!!c).map(c => <button key={c.instanceId} className={infoId===c.cardId?'active':''} onClick={()=>setInspectedCard(c.cardId)}>{cardName(c.cardId)}</button>)}</div>}
            <div className="lesson-card-detail">
              {info ? <><div className="lesson-detail-heading"><img src={cardImage(info.id)} alt="" /><div><strong>{cardName(info.id)}</strong><p>{info.element} / {info.category}</p>
                {typeof info.requiredTerritories==='number' && <span className="lesson-required">必要領土数：{info.requiredTerritories}枚（自分の領土：{territoryCount(game,'player1')}枚）</span>}
                {info.category==='モンスター' && <span>ATK {info.attack} / DEF {info.defense}</span>}</div></div>
                {info.effectText && <p className="lesson-card-effect-text">{info.effectText}</p>}
                {info.category === 'モンスター' && <div className="lesson-movement-reference">
                  <strong>移動範囲</strong>
                  <MovementArtwork src={cardImage(info.id)} name={cardName(info.id)} />
                  <small>カード右上に印刷された移動範囲です。</small>
                </div>}
              </> : <><strong>カード情報</strong><p>手札や、盤面の味方・相手のモンスター、領土をクリックすると詳細を表示します。</p></>}
            </div>
            {feedback && !finished && <p className="lesson-feedback" role="status">{feedback}</p>}
            {(step === 'develop' || step === 'summon' || step === 'equipment') && <p className="lesson-paper-note">盤面の光はWeb版の操作補助です。紙版では上のルールを使って、自分で配置可能な場所を判断します。</p>}
          </section>
        </div>
        {standardCue && <div className={`visual-cue visual-${standardCue.kind}`} key={standardCue.id} aria-live="polite" aria-atomic="true">
          <div className="visual-vignette"/><div className="visual-strike"/>
          <div className="visual-content">{standardCue.artworkId && <img className="visual-art" src={artworkImage(standardCue.artworkId)}
            onError={e => {e.currentTarget.onerror=null;e.currentTarget.src=cardImage(standardCue.artworkId!)}} alt=""/>}
            <span className="visual-category">LANE FRONTIER</span><strong>{standardCue.title}</strong><span className="visual-subtitle">{standardCue.subtitle}</span></div>
        </div>}
        {spellCue !== null && <div className="spell-cast-overlay" key={spellCue} aria-live="polite"><div className="spell-cast-burst"/>
          <div className="spell-cast-card"><img src={cardImage('LF-023')} alt="大海の恵み"/><strong>大海の恵み</strong><span>MAGIC CAST</span></div>
        </div>}
        {equipCue !== null && <div className="equip-cast-overlay" key={equipCue} aria-live="polite"><div className="equip-cast-burst"/>
          <div className="equip-cast-card"><img src={cardImage('LF-025')} alt="調和の槍"/><strong>調和の槍</strong><span>EQUIPPED</span></div>
        </div>}
        {reading && shown && <div className="lesson-dimmer"><div className="lesson-dialog" role="dialog" aria-modal="true" aria-labelledby="lesson-dialog-title">
          <div className="lesson-dialog-tag">{overviewOpen ? 'ゲームの概要' : `${currentLabel} · ルール説明`}</div>
          <h2 id="lesson-dialog-title">{shown.title}</h2>
          <p>{shown.explain}</p>{shown.explain2 && <p>{shown.explain2}</p>}
          {step === 'turn-change' && !overviewOpen && <div className="lesson-turn-progress">ターン3：召喚 → ターン4：相手の手番（省略） → ターン5：自分の移動</div>}
          <div className="lesson-dialog-bottom"><strong>{shown.task}</strong><button onClick={onContinue}>{overviewOpen ? 'ルールの説明へ →' : step === 'turn-change' ? '次の自分のターンへ →' : '操作してみる →'}</button></div>
        </div></div>}
      </>}
    </>}
  </main>
}
