import type { CSSProperties } from 'react'
import type { FaceArtwork } from './types'

type ArtworkLike = Pick<FaceArtwork, 'url' | 'repeat' | 'scale' | 'offsetX' | 'offsetY' | 'rotation' | 'fit'>

export function artworkPreviewStyle(artwork: ArtworkLike): CSSProperties | undefined {
  if (!artwork.url) return undefined
  return {
    backgroundImage: `url(${artwork.url})`,
    backgroundSize: artwork.repeat ? `${100 / Math.max(.01, artwork.scale)}%` : artwork.fit === 'cover' ? 'cover' : 'contain',
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

function drawFittedLayer(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, artwork: ArtworkLike) {
  const fit = artwork.fit === 'cover' ? Math.max(width / image.naturalWidth, height / image.naturalHeight) : Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * fit; const drawHeight = image.naturalHeight * fit
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
  else drawFittedLayer(layerContext, image, width, height, artwork)

  const output = document.createElement('canvas'); output.width = width; output.height = height
  const context = output.getContext('2d')!
  context.translate(width / 2, height / 2)
  context.rotate(artwork.rotation * Math.PI / 180)
  const scale = artwork.repeat ? 1 : artwork.scale
  context.scale(scale, scale)
  context.drawImage(layer, -width / 2, -height / 2)
  return output
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片解析失败')); image.src = source
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file)
  })
}

function smoothstep(min: number, max: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(.0001, max - min)))
  return t * t * (3 - 2 * t)
}

export async function removeSolidImageBackground(source: string, force = false) {
  const image = await loadImage(source)
  if (image.naturalWidth > 8192 || image.naturalHeight > 8192) return { url: source, removed: false, reason: '图片尺寸超过智能去底处理上限' }
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('浏览器无法处理该图片')
  context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height); const data = pixels.data
  const sampleStep = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 260)); const border: [number, number, number][] = []
  const add = (x: number, y: number) => { const index = (y * canvas.width + x) * 4; border.push([data[index], data[index + 1], data[index + 2]]) }
  for (let x = 0; x < canvas.width; x += sampleStep) { add(x, 0); add(x, canvas.height - 1) }
  for (let y = 0; y < canvas.height; y += sampleStep) { add(0, y); add(canvas.width - 1, y) }
  const background = border.reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]] as [number, number, number], [0, 0, 0] as [number, number, number]).map(value => value / Math.max(1, border.length)) as [number, number, number]
  const distance = (r: number, g: number, b: number) => Math.hypot(r - background[0], g - background[1], b - background[2])
  const backgroundLuma = background[0] * .2126 + background[1] * .7152 + background[2] * .0722
  const neutral = Math.max(...background) - Math.min(...background) < 28; const darkBackground = neutral && backgroundLuma < 82; const lightBackground = neutral && backgroundLuma > 188
  const uniformTolerance = darkBackground || lightBackground ? 62 : 28
  const uniformRatio = border.filter(color => distance(...color) < uniformTolerance).length / Math.max(1, border.length)
  let transparentPixels = 0; for (let index = 3; index < data.length; index += 4) if (data[index] < 250) transparentPixels += 1
  if (transparentPixels > data.length / 4000) return { url: source, removed: false, reason: '图片已包含透明通道' }
  if (uniformRatio < (force ? .68 : .8) || (!force && !neutral)) return { url: source, removed: false, reason: '没有检测到可安全移除的纯色背景' }
  for (let index = 0; index < data.length; index += 4) {
    const separation = darkBackground ? Math.max(data[index], data[index + 1], data[index + 2]) : lightBackground ? 255 - Math.min(data[index], data[index + 1], data[index + 2]) : distance(data[index], data[index + 1], data[index + 2])
    const alpha = darkBackground ? smoothstep(54, 128, separation) : lightBackground ? smoothstep(34, 112, separation) : smoothstep(7, 58, separation)
    if (alpha < .995) {
      if (alpha > .025) for (let channel = 0; channel < 3; channel += 1) data[index + channel] = Math.max(0, Math.min(255, (data[index + channel] - background[channel] * (1 - alpha)) / alpha))
      data[index + 3] = Math.round(alpha * 255)
    }
  }
  context.putImageData(pixels, 0, 0)
  return { url: canvas.toDataURL('image/png'), removed: true, reason: '已移除图片边缘检测到的纯色背景' }
}

export async function prepareArtworkFile(file: File) {
  const source = await readFileAsDataUrl(file)
  if (file.type !== 'image/png') return { url: source, originalUrl: null, removed: false, reason: '' }
  const result = await removeSolidImageBackground(source, false)
  return { ...result, originalUrl: result.removed ? source : null }
}
