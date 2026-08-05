import DxfParser from 'dxf-parser'
import type { CadDielineConfig, CadLineRole, CadPathEntity, CadPoint } from './types'

type CadUnit = CadDielineConfig['unit']
type DxfPoint = { x?: number; y?: number; z?: number; bulge?: number }
type DxfEntity = {
  type?: string; handle?: string | number; layer?: string; lineType?: string; shape?: boolean; closed?: boolean
  vertices?: DxfPoint[]; points?: DxfPoint[]; controlPoints?: DxfPoint[]; fitPoints?: DxfPoint[]
  center?: DxfPoint; radius?: number; startAngle?: number; endAngle?: number
  majorAxisEndPoint?: DxfPoint; axisRatio?: number
}

const unitScale: Record<CadUnit, number> = { mm: 1, cm: 10, inch: 25.4, meter: 1000, unitless: 1 }

function detectedUnit(code: unknown): CadUnit {
  if (code === 1) return 'inch'
  if (code === 4) return 'mm'
  if (code === 5) return 'cm'
  if (code === 6) return 'meter'
  return 'unitless'
}

function roleFor(layer = '', lineType = ''): CadLineRole {
  const value = `${layer} ${lineType}`.toLowerCase()
  if (/bleed|出血|出血线|bleeding/.test(value)) return 'bleed'
  if (/fold|crease|score|折|压痕|压线|虚线|dash|dashed|center/.test(value)) return 'fold'
  if (/dimension|dim|text|note|mark|标注|文字|辅助|guide/.test(value)) return 'annotation'
  return 'cut'
}

function point(source: DxfPoint | undefined, scale: number): CadPoint | null {
  if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) return null
  return { x: Number(source.x) * scale, y: Number(source.y) * scale }
}

function arcPoints(center: CadPoint, radius: number, start: number, end: number, closed = false) {
  let span = end - start
  if (closed || Math.abs(span) < 1e-8) span = Math.PI * 2
  while (span < 0) span += Math.PI * 2
  const segments = Math.max(12, Math.min(160, Math.ceil(Math.abs(span) * Math.sqrt(Math.max(radius, 1)) * .8)))
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + span * index / segments
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function bulgeSegment(start: CadPoint, end: CadPoint, bulge: number) {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-7) return [start, end]
  const dx = end.x - start.x; const dy = end.y - start.y; const chord = Math.hypot(dx, dy)
  if (chord < 1e-7) return [start, end]
  const theta = 4 * Math.atan(bulge); const midX = (start.x + end.x) / 2; const midY = (start.y + end.y) / 2
  const centerOffset = chord / (2 * Math.tan(theta / 2)); const center = { x: midX - dy / chord * centerOffset, y: midY + dx / chord * centerOffset }
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x); const segments = Math.max(4, Math.min(80, Math.ceil(Math.abs(theta) * 12)))
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + theta * index / segments; const radius = Math.hypot(start.x - center.x, start.y - center.y)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function polylinePoints(vertices: DxfPoint[], scale: number, closed: boolean) {
  const source = vertices.map(vertex => ({ point: point(vertex, scale), bulge: Number(vertex.bulge ?? 0) })).filter(item => item.point) as { point: CadPoint; bulge: number }[]
  if (source.length < 2) return []
  const result: CadPoint[] = []
  const segmentCount = closed ? source.length : source.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const current = source[index]; const next = source[(index + 1) % source.length]; const segment = bulgeSegment(current.point, next.point, current.bulge)
    result.push(...(index ? segment.slice(1) : segment))
  }
  return result
}

function ellipsePoints(entity: DxfEntity, scale: number) {
  const center = point(entity.center, scale); const axis = point(entity.majorAxisEndPoint, scale)
  if (!center || !axis) return []
  const major = Math.hypot(axis.x, axis.y); const minor = major * Number(entity.axisRatio ?? 1); const rotation = Math.atan2(axis.y, axis.x)
  const start = Number(entity.startAngle ?? 0); let end = Number(entity.endAngle ?? Math.PI * 2); if (end <= start) end += Math.PI * 2
  const segments = Math.max(24, Math.min(180, Math.ceil((end - start) * Math.sqrt(Math.max(major, 1)))))
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + (end - start) * index / segments; const x = Math.cos(angle) * major; const y = Math.sin(angle) * minor
    return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
  })
}

function entityPath(entity: DxfEntity, index: number, scale: number): CadPathEntity | null {
  const type = String(entity.type ?? '').toUpperCase(); const layer = entity.layer || '0'; const role = roleFor(layer, entity.lineType); let points: CadPoint[] = []; let closed = Boolean(entity.shape || entity.closed)
  if (type === 'LINE') points = (entity.vertices ?? []).map(value => point(value, scale)).filter(Boolean) as CadPoint[]
  else if (type === 'LWPOLYLINE' || type === 'POLYLINE') points = polylinePoints(entity.vertices ?? [], scale, closed)
  else if (type === 'ARC' || type === 'CIRCLE') {
    const center = point(entity.center, scale); const radius = Number(entity.radius ?? 0) * scale; closed = type === 'CIRCLE'
    if (center && radius > 0) points = arcPoints(center, radius, Number(entity.startAngle ?? 0), Number(entity.endAngle ?? Math.PI * 2), closed)
  } else if (type === 'ELLIPSE') { points = ellipsePoints(entity, scale); closed = Math.abs(Number(entity.endAngle ?? Math.PI * 2) - Number(entity.startAngle ?? 0)) >= Math.PI * 1.99 }
  else if (type === 'SPLINE') points = (entity.fitPoints?.length ? entity.fitPoints : entity.controlPoints ?? []).map(value => point(value, scale)).filter(Boolean) as CadPoint[]
  else if (type === '3DFACE' || type === 'SOLID') { points = (entity.vertices ?? entity.points ?? []).map(value => point(value, scale)).filter(Boolean) as CadPoint[]; closed = true }
  if (points.length < 2) return null
  return { id: String(entity.handle ?? `cad-${index}`), layer, role, closed, points }
}

export function parseCadDxf(source: string, fileName: string, unitOverride?: CadUnit): CadDielineConfig {
  if (!source.includes('SECTION') || !source.includes('ENTITIES')) throw new Error('无法识别该DXF文件，请导出为ASCII DXF R12/R2000后重试')
  const document = new DxfParser().parseSync(source)
  if (!document) throw new Error('DXF解析失败，文件可能已损坏')
  const header = document.header as Record<string, unknown>; const detected = detectedUnit(header.$INSUNITS); const unit = unitOverride ?? detected; const scale = unitScale[unit]
  const entities = document.entities as unknown as DxfEntity[]; const paths: CadPathEntity[] = []; let unsupportedEntities = 0; let pointCount = 0
  entities.forEach((entity, index) => {
    const path = entityPath(entity, index, scale)
    if (!path) { unsupportedEntities += 1; return }
    if (paths.length >= 50_000 || pointCount + path.points.length > 350_000) return
    paths.push(path); pointCount += path.points.length
  })
  if (!paths.length) throw new Error('DXF中没有找到可用的二维裁切线或折叠线')
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  paths.forEach(path => path.points.forEach(value => { minX = Math.min(minX, value.x); minY = Math.min(minY, value.y); maxX = Math.max(maxX, value.x); maxY = Math.max(maxY, value.y) }))
  const counts = new Map<string, number>(); paths.forEach(path => counts.set(path.layer, (counts.get(path.layer) ?? 0) + 1))
  const layers = [...counts.entries()].map(([name, entityCount]) => ({ name, entityCount, visible: true, role: roleFor(name, paths.find(path => path.layer === name)?.role ?? '') }))
  const warnings: string[] = []
  if (detected === 'unitless' && !unitOverride) warnings.push('文件没有标注单位，当前按毫米处理；请在导入窗口确认')
  if (unsupportedEntities) warnings.push(`${unsupportedEntities} 个文字、标注、块或不支持的实体未进入刀模线稿`)
  if (paths.length >= 50_000 || pointCount >= 350_000) warnings.push('文件内容较复杂，已限制为5万条路径或35万个采样点')
  const widthMm = maxX - minX; const heightMm = maxY - minY
  if (Math.max(widthMm, heightMm) > 3000 || Math.min(widthMm, heightMm) < 5) warnings.push('检测到异常尺寸，请确认DXF单位设置是否正确')
  return {
    id: crypto.randomUUID(), name: fileName.replace(/\.dxf$/i, ''), sourceFormat: 'dxf', importedAt: Date.now(), unit, scaleToMm: scale,
    bounds: { minX, minY, maxX, maxY }, widthMm, heightMm, paths, layers, unsupportedEntities, warnings,
    artwork: { url: null, name: '', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false }, foldMapping: null,
  }
}

export const CAD_UNIT_OPTIONS: { value: CadUnit; label: string }[] = [
  { value: 'mm', label: '毫米 mm' }, { value: 'cm', label: '厘米 cm' }, { value: 'inch', label: '英寸 inch' }, { value: 'meter', label: '米 m' }, { value: 'unitless', label: '无单位（按mm）' },
]
