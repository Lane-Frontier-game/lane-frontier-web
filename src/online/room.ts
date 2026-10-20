import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getDatabase, get, onValue, ref, runTransaction, type Unsubscribe } from 'firebase/database'
import { createGameWithDecks, type DeckElement } from '../game/decks'
import type { GameState, PlayerId } from '../game/types'
import { firebaseConfig, isOnlineConfigured } from './config'

export type RoomStage = 'waiting' | 'choosing' | 'mulligan' | 'playing'
export type RoomInfo = {
  hostUid: string
  guestUid: string
  decks: Record<PlayerId, DeckElement | ''>
  mulliganDone: Record<PlayerId, boolean>
  stage: RoomStage
  gameJson: string
  version: number
  createdAt: number
}

const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeCode(): string {
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  return [...array].map(n => letters[n % letters.length]).join('')
}

function services() {
  if (!isOnlineConfigured) throw new Error('Firebaseの設定がまだ完了していません。')
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  return { database: getDatabase(app), auth: getAuth(app) }
}

async function uid(): Promise<string> {
  const { auth } = services()
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser.uid
  return (await signInAnonymously(auth)).user.uid
}

function isMember(room: RoomInfo, userId: string): boolean {
  return room.hostUid === userId || room.guestUid === userId
}

export async function createOnlineRoom(): Promise<{ code: string; seat: PlayerId }> {
  const { database } = services()
  const userId = await uid()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode()
    const initial: RoomInfo = {
      hostUid: userId, guestUid: '',
      decks: { player1: '', player2: '' },
      mulliganDone: { player1: false, player2: false },
      stage: 'waiting', gameJson: '', version: 0, createdAt: Date.now(),
    }
    const result = await runTransaction(ref(database, `rooms/${code}`), current => current ? undefined : initial, { applyLocally: false })
    if (result.committed) return { code, seat: 'player1' }
  }
  throw new Error('部屋番号を作れませんでした。もう一度お試しください。')
}

export async function joinOnlineRoom(code: string): Promise<{ code: string; seat: PlayerId }> {
  const roomCode = code.trim().toUpperCase()
  if (!/^[A-Z2-9]{8}$/.test(roomCode)) throw new Error('8文字の部屋番号を入力してください。')
  const { database } = services()
  const userId = await uid()
  const roomRef = ref(database, `rooms/${roomCode}`)
  // 未取得のパスへのトランザクションは最初のコールバックがnullになり、
  // 存在する部屋への参加まで中断され得るので、先にサーバーから読み込む。
  const preview = await get(roomRef)
  if (!preview.exists()) throw new Error('その部屋番号は見つかりません。')
  const existing = preview.val() as RoomInfo
  if (isMember(existing, userId)) {
    return { code: roomCode, seat: existing.hostUid === userId ? 'player1' : 'player2' }
  }
  const result = await runTransaction(roomRef, (room: RoomInfo | null) => {
    if (!room) return undefined
    if (isMember(room, userId)) return undefined
    if (room.guestUid || room.stage !== 'waiting') return undefined
    return { ...room, guestUid: userId, stage: 'choosing', version: room.version + 1 }
  }, { applyLocally: false })
  const room = result.snapshot.val() as RoomInfo | null
  if (!room || !isMember(room, userId)) {
    throw new Error('部屋が見つからないか、すでに2人揃っています。')
  }
  return { code: roomCode, seat: room.hostUid === userId ? 'player1' : 'player2' }
}

export function watchOnlineRoom(code: string, onRoom: (room: RoomInfo | null) => void, onError: (error: Error) => void): Unsubscribe {
  const { database } = services()
  return onValue(ref(database, `rooms/${code}`), snapshot => onRoom(snapshot.val() as RoomInfo | null), onError)
}

export async function selectOnlineDeck(code: string, seat: PlayerId, element: DeckElement): Promise<void> {
  const { database } = services()
  const userId = await uid()
  const result = await runTransaction(ref(database, `rooms/${code}`), (room: RoomInfo | null) => {
    if (!room || !isMember(room, userId) || (seat === 'player1' ? room.hostUid : room.guestUid) !== userId || room.stage !== 'choosing') return undefined
    const decks = { ...room.decks, [seat]: element }
    if (decks.player1 && decks.player2) {
      return {
        ...room, decks, stage: 'mulligan',
        gameJson: JSON.stringify(createGameWithDecks(decks.player1, decks.player2)),
        version: room.version + 1,
      }
    }
    return { ...room, decks, version: room.version + 1 }
  }, { applyLocally: false })
  if (!result.committed) throw new Error('デッキを確定できませんでした。部屋の状態を確認してください。')
}

export async function commitOnlineGame(
  code: string, seat: PlayerId, expectedVersion: number, next: GameState, kind: 'mulligan' | 'action',
): Promise<void> {
  const { database } = services()
  const userId = await uid()
  const result = await runTransaction(ref(database, `rooms/${code}`), (room: RoomInfo | null) => {
    if (!room || room.version !== expectedVersion || (seat === 'player1' ? room.hostUid : room.guestUid) !== userId) return undefined
    const current: GameState | null = room.gameJson ? JSON.parse(room.gameJson) as GameState : null
    if (!current) return undefined
    if (kind === 'mulligan') {
      if (room.stage !== 'mulligan' || room.mulliganDone[seat]) return undefined
      const mulliganDone = { ...room.mulliganDone, [seat]: true }
      const stage: RoomStage = mulliganDone.player1 && mulliganDone.player2 ? 'playing' : 'mulligan'
      return { ...room, gameJson: JSON.stringify(next), mulliganDone, stage, version: room.version + 1 }
    }
    if (room.stage !== 'playing') return undefined
    const pendingEquip = current.board.find(cell => cell.monster && !cell.monster.equippedId && cell.equipments.length > 1)
    const canEquip = pendingEquip?.monster?.card.owner === seat
    if (current.activePlayer !== seat && !canEquip) return undefined
    return { ...room, gameJson: JSON.stringify(next), version: room.version + 1 }
  }, { applyLocally: false })
  if (!result.committed) throw new Error('通信中に対戦状態が更新されました。最新の盤面から操作し直してください。')
}
