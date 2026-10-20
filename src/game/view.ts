import type { PlayerId } from './types'
import { COLS, ROWS } from './logic'

/** 現在の手番側が画面の下になるように盤面の表示順を180度回す。 */
export function visibleBoardIndices(viewer: PlayerId): number[] {
  const total = COLS * ROWS
  return Array.from({ length: total }, (_, position) =>
    viewer === 'player1' ? position : total - 1 - position,
  )
}

/** 表示座標。モデルのマス番号と独立させて扱う。 */
export function visibleCoordinate(index: number, viewer: PlayerId): [number, number] {
  const position = viewer === 'player1' ? index : COLS * ROWS - 1 - index
  return [Math.floor(position / COLS) + 1, position % COLS + 1]
}

/** 相手カードの絵だけを逆さに。統計や操作UIの文字は回転させない。 */
export function shouldRotateCard(cardOwner: PlayerId, viewer: PlayerId): boolean {
  return cardOwner !== viewer
}
