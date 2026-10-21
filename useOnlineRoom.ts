import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckElement } from '../game/decks'
import type { GameState, PlayerId } from '../game/types'
import { commitOnlineGame, createOnlineRoom, joinOnlineRoom, selectOnlineDeck, watchOnlineRoom, type RoomInfo } from './room'

export type Session = { code: string; seat: PlayerId }

export function useOnlineRoom() {
  const [session, setSession] = useState<Session | null>(null)
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unsubscribe = useRef<null | (() => void)>(null)
  const roomRef = useRef<RoomInfo | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const busyRef = useRef(false)

  const leave = useCallback(() => {
    unsubscribe.current?.()
    unsubscribe.current = null
    sessionRef.current = null
    roomRef.current = null
    setSession(null)
    setRoom(null)
    setError('')
    busyRef.current = false
    setBusy(false)
  }, [])

  useEffect(() => () => { unsubscribe.current?.() }, [])

  const subscribe = useCallback((next: Session) => {
    unsubscribe.current?.()
    roomRef.current = null
    sessionRef.current = next
    setSession(next)
    unsubscribe.current = watchOnlineRoom(next.code, value => {
      roomRef.current = value
      setRoom(value)
      if (!value) setError('部屋が削除されたか、読み込みに失敗しました。')
    }, error => setError(`同期できません: ${error.message}`))
  }, [])

  const perform = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try { await fn() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }, [])

  const create = () => perform(async () => subscribe(await createOnlineRoom()))
  const join = (code: string) => perform(async () => subscribe(await joinOnlineRoom(code)))
  const chooseDeck = (element: DeckElement) => perform(async () => {
    const current = sessionRef.current
    if (!current) return
    await selectOnlineDeck(current.code, current.seat, element)
  })
  const commit = (next: GameState, kind: 'mulligan' | 'action') => perform(async () => {
    const current = sessionRef.current
    const latest = roomRef.current
    if (!current || !latest) throw new Error('通信がまだ確立していません。')
    await commitOnlineGame(current.code, current.seat, latest.version, next, kind)
  })

  return { session, room, busy, error, create, join, chooseDeck, commit, leave }
}
