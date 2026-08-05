import type { CSSProperties } from 'react'
import type { FaceArtwork } from './types'

type ArtworkLike = Pick<FaceArtwork, 'url' | 'repeat' | 'scale' | 'offsetX' | 'offsetY' | 'rotation'>

export function artworkPreviewStyle(artwork: ArtworkLike): CSSProperties | undefined {
  if (!artwork.url) return undefined
  return {
    backgroundImage: `url(${artwork.url})`,
    backgroundSize: artwork.repeat ? `${100 / Math.max(.01, artwork.scale)}%` : 'cover',
    backgroundRepeat: artwork.repeat ? 'repeat' : 'no-repeat',
    backgroundPosition: `${50 + artwork.offsetX * 100}% ${50 - artwork.offsetY * 100}%`,
    transform: `rotate(${artwork.rotation}deg) scale(${artwork.repeat ? 1 : artwork.scale})`,
  }
}

function canvasSize(aspect: number, resolution = 1024) {
  const safeAspect = Math.min(8, Math.max(.125, aspect || 1))
  return safeAspect >= 1
    ? { width: resolution, height: Math.max(128, Math.round(resolution / safeAspect)) }
    : { width: Math.max(128, Math.round(resolution * safeAspect)), height: resolution }
}

function drawCoverLayer(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, artwork: ArtworkLike) {
  const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * cover; const drawHeight = image.naturalHeight * cover
  const positionX = .5 + artwork.offsetX; const positionY = .5 - artwork.offsetY
  const x = (width - drawWidth) * positionX; const y = (height - drawHeight) * positionY
  context.drawImage(image, x, y, drawWidth, drawHeight)
}

function drawRepeatedLayer(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, artwork: ArtworkLike) {
  const tileWidth = width / Math.max(.05, artwork.scale); const tileHeight = tileWidth * image.naturalHeight / image.naturalWidth
  const offsetX = artwork.offsetX * width; const offsetY = -artwork.offsetY * height
  const startX = -tileWidth + ((offsetX % tileWidth) + tileWidth) % tileWidth
  const startY = -tileHeight + ((offsetY % tileHeight) + tileHeight) % tileHeight
  for (let y = startY; y < height + tileHeight; y += tileHeight) for (let x = startX; x < width + tileWidth; x += tileWidth) context.drawImage(image, x, y, tileWidth, tileHeight)
}

export function renderArtworkCanvas(image: HTMLImageElement, artwork: ArtworkLike, aspect: number) {
  const { width, height } = canvasSize(aspect)
  const layer = document.createElement('canvas'); layer.width = width; layer.height = height
  const layerContext = layer.getContext('2d')!
  if (artwork.repeat) drawRepeatedLayer(layerContext, image, width, height, artwork)
  else drawCoverLayer(layerContext, image, width, height, artwork)

  const output = document.createElement('canvas'); output.width = width; output.height = height
  const context = output.getContext('2d')!
  context.translate(width / 2, height / 2)
  context.rotate(artwork.rotation * Math.PI / 180)
  const scale = artwork.repeat ? 1 : artwork.scale
  context.scale(scale, scale)
  context.drawImage(layer, -width / 2, -height / 2)
  return output
}
