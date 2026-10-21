const movementImages = import.meta.glob('../assets/movement/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function getMovementImageSrc(cardSrc: string) {
  const match = cardSrc.match(/(LF-\d+)\.jpg$/)
  if (!match) return undefined
  return movementImages[`../assets/movement/${match[1]}.png`]
}

export function MovementArtwork({ src, name }: { src: string; name: string }) {
  const iconSrc = getMovementImageSrc(src)

  return (
    <div className="movement-artwork" aria-label={`${name}のカード右上の移動範囲図`}>
      {iconSrc ? (
        <img src={iconSrc} alt={`${name}の移動範囲（カード右上の原図）`} />
      ) : (
        <span className="movement-crop-fallback">移動範囲図を読み込めません</span>
      )}
    </div>
  )
}
