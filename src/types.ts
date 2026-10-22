export type PlayerId = 'player1' | 'player2'

export type CardInstance = {
  instanceId: string
  cardId: string
  owner: PlayerId
}

export type MonsterOnBoard = {
  card: CardInstance
  summonedTurn: number
  equippedId: string | null
  /** 召喚ターンに通常移動可能（突撃） */
  rushTurn?: number
  /** カード効果などで、指定ターンの通常移動を禁止 */
  lockedTurn?: number
}

export type FieldCell = {
  castleOwner: PlayerId | null
  territory: CardInstance | null
  monster: MonsterOnBoard | null
  equipments: CardInstance[]
}

export type PlayerState = {
  deck: CardInstance[]
  hand: CardInstance[]
  graveyard: CardInstance[]
}

export type GamePhase = 'start' | 'draw' | 'develop' | 'main' | 'move' | 'end'

export type PendingMonsterEffect = {
  kind: 'centaur' | 'mermaid' | 'ogre'
  cellIndex: number
  instanceId: string
}

export type GameState = {
  players: Record<PlayerId, PlayerState>
  board: FieldCell[]
  activePlayer: PlayerId
  phase: GamePhase
  turn: number
  territoryPlayedThisTurn: boolean
  mainActionUsedThisTurn: boolean
  moveUsedThisTurn: boolean
  winner: PlayerId | null
  winReason: string | null
  pendingEffect: PendingMonsterEffect | null
}
