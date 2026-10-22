// 原画がまだ無いカードは、App.tsx 側の onError で既存カード画像へ切り替える。
// LF-001.jpg などを public/artwork/cards に追加すればコードの変更不要。
export function artworkImage(cardId: string): string {
  return `${import.meta.env.BASE_URL}artwork/cards/${cardId}.jpg`
}
