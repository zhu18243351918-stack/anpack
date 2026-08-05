import type { CadDielineConfig, CadFoldEdge, CadFoldMapping, CadLineRole, CadPanel, CadPoint } from './types'

interface Segment { a: CadPoint; b: CadPoint; role: CadLineRole; cuts: number[] }
interface GraphEdge { a: string; b: string; role: CadLineRole }

const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: CadPoint, b: CadPoint, c: CadPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

function polygonArea(points: CadPoint[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) { const current = points[index]; const next = points[(index + 1) % points.length]; area += current.x * next.y - next.x * current.y }
  return area / 2
}

function centroid(points: CadPoint[], signedArea: number) {
  let x = 0; let y = 0
  for (let index = 0; index < points.length; index += 1) { const current = points[index]; const next = points[(index + 1) % points.length]; const value = current.x * next.y - next.x * current.y; x += (current.x + next.x) * value; y += (current.y + next.y) * value }
  const divisor = signedArea * 6
  if (Math.abs(divisor) < 1e-8) return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }
  return { x: x / divisor, y: y / divisor }
}

function simplify(points: CadPoint[], tolerance: number) {
  if (points.length < 4) return points
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]; const next = points[(index + 1) % points.length]
    return Math.abs(cross(previous, point, next)) > tolerance * Math.max(distance(previous, point), distance(point, next), 1)
  })
}

function intersection(left: Segment, right: Segment) {
  const rx = left.b.x - left.a.x; const ry = left.b.y - left.a.y; const sx = right.b.x - right.a.x; const sy = right.b.y - right.a.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 1e-10) return null
  const qx = right.a.x - left.a.x; const qy = right.a.y - left.a.y; const t = (qx * sy - qy * sx) / denominator; const u = (qx * ry - qy * rx) / denominator
  if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) }
}

function segmentsFrom(config: CadDielineConfig) {
  const roles = new Map(config.layers.map(layer => [layer.name, layer.role])); const result: Segment[] = []
  config.paths.forEach(path => {
    const role = roles.get(path.layer) ?? path.role; if (role !== 'cut' && role !== 'fold') return
    const count = path.closed ? path.points.length : path.points.length - 1
    for (let index = 0; index < count; index += 1) { const a = path.points[index]; const b = path.points[(index + 1) % path.points.length]; if (distance(a, b) > .01) result.push({ a, b, role, cuts: [0, 1] }) }
  })
  return result
}

export function detectCadPanels(config: CadDielineConfig): CadFoldMapping {
  const warnings: string[] = []; let segments = segmentsFrom(config)
  if (segments.length > 1800) { segments = segments.filter((_, index) => index % Math.ceil(segments.length / 1800) === 0); warnings.push('CAD曲线采样点较多，面板识别已进行简化；请检查边缘是否完整') }
  for (let left = 0; left < segments.length; left += 1) for (let right = left + 1; right < segments.length; right += 1) {
    const hit = intersection(segments[left], segments[right]); if (!hit) continue; segments[left].cuts.push(hit.t); segments[right].cuts.push(hit.u)
  }
  const span = Math.max(config.widthMm, config.heightMm); const tolerance = Math.max(.015, span * 1e-5); const nodes = new Map<string, CadPoint>(); const edges = new Map<string, GraphEdge>()
  const nodeKey = (point: CadPoint) => `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`
  const addNode = (value: CadPoint) => { const key = nodeKey(value); if (!nodes.has(key)) nodes.set(key, value); return key }
  segments.forEach(segment => {
    const values = [...new Set(segment.cuts.map(value => Number(value.toFixed(7))))].sort((a, b) => a - b)
    for (let index = 0; index + 1 < values.length; index += 1) {
      const t1 = values[index]; const t2 = values[index + 1]; if (t2 - t1 < 1e-7) continue
      const p1 = { x: segment.a.x + (segment.b.x - segment.a.x) * t1, y: segment.a.y + (segment.b.y - segment.a.y) * t1 }; const p2 = { x: segment.a.x + (segment.b.x - segment.a.x) * t2, y: segment.a.y + (segment.b.y - segment.a.y) * t2 }
      const a = addNode(p1); const b = addNode(p2); if (a === b) continue; const key = a < b ? `${a}|${b}` : `${b}|${a}`; const old = edges.get(key); edges.set(key, { a, b, role: old?.role === 'fold' || segment.role === 'fold' ? 'fold' : 'cut' })
    }
  })
  const neighbors = new Map<string, string[]>(); edges.forEach(edge => { neighbors.set(edge.a, [...(neighbors.get(edge.a) ?? []), edge.b]); neighbors.set(edge.b, [...(neighbors.get(edge.b) ?? []), edge.a]) })
  neighbors.forEach((values, key) => { const origin = nodes.get(key)!; values.sort((left, right) => Math.atan2(nodes.get(left)!.y - origin.y, nodes.get(left)!.x - origin.x) - Math.atan2(nodes.get(right)!.y - origin.y, nodes.get(right)!.x - origin.x)) })
  const visited = new Set<string>(); const cycles: { keys: string[]; points: CadPoint[]; area: number }[] = []
  edges.forEach(edge => [edge.a, edge.b].forEach(startA => {
    const startB = startA === edge.a ? edge.b : edge.a; const start = `${startA}>${startB}`; if (visited.has(start)) return
    const keys = [startA]; let from = startA; let to = startB; let closed = false
    for (let guard = 0; guard < edges.size * 2 + 10; guard += 1) {
      visited.add(`${from}>${to}`); keys.push(to); const list = neighbors.get(to) ?? []; const reverseIndex = list.indexOf(from); if (reverseIndex < 0 || list.length < 2) break
      const next = list[(reverseIndex - 1 + list.length) % list.length]; from = to; to = next
      if (from === startA && to === startB) { closed = true; break }
    }
    if (!closed || keys.length < 4) return
    keys.pop(); const points = keys.map(key => nodes.get(key)!); const area = polygonArea(points); if (area > Math.max(1, config.widthMm * config.heightMm * 1e-6)) cycles.push({ keys, points: simplify(points, tolerance), area })
  }))
  if (!cycles.length) throw new Error('没有识别到封闭面板。请确保裁切线与折叠线端点连接，并正确设置图层用途。')
  const rawPanels = cycles.map((cycle, index) => ({ id: `panel-${index + 1}`, name: `面板 ${index + 1}`, points: cycle.points, centroid: centroid(cycle.points, cycle.area), area: cycle.area, nodeKeys: cycle.keys }))
  const edgePanels = new Map<string, string[]>(); rawPanels.forEach(panel => { for (let index = 0; index < panel.nodeKeys.length; index += 1) { const a = panel.nodeKeys[index]; const b = panel.nodeKeys[(index + 1) % panel.nodeKeys.length]; const key = a < b ? `${a}|${b}` : `${b}|${a}`; edgePanels.set(key, [...(edgePanels.get(key) ?? []), panel.id]) } })
  const rawFolds: CadFoldEdge[] = []; edges.forEach((edge, key) => {
    const linked = edgePanels.get(key) ?? []; if (edge.role !== 'fold' || linked.length !== 2) return
    const aPanel = rawPanels.find(panel => panel.id === linked[0])!; const start = nodes.get(edge.a)!; const end = nodes.get(edge.b)!; const side = cross(start, end, aPanel.centroid)
    rawFolds.push({ id: `fold-${rawFolds.length + 1}`, panelA: linked[0], panelB: linked[1], start, end, angle: 90, direction: side >= 0 ? 1 : -1 })
  })
  const adjacency = new Map<string, string[]>(); rawPanels.forEach(panel => adjacency.set(panel.id, [])); rawFolds.forEach(fold => { adjacency.get(fold.panelA)!.push(fold.panelB); adjacency.get(fold.panelB)!.push(fold.panelA) })
  const components: string[][] = []; const seen = new Set<string>(); rawPanels.forEach(panel => { if (seen.has(panel.id)) return; const queue = [panel.id]; const component: string[] = []; seen.add(panel.id); while (queue.length) { const id = queue.shift()!; component.push(id); (adjacency.get(id) ?? []).forEach(next => { if (!seen.has(next)) { seen.add(next); queue.push(next) } }) } components.push(component) })
  const best = components.sort((left, right) => right.reduce((sum, id) => sum + rawPanels.find(panel => panel.id === id)!.area, 0) - left.reduce((sum, id) => sum + rawPanels.find(panel => panel.id === id)!.area, 0))[0]
  const keep = new Set(best); const keptRaw = rawPanels.filter(panel => keep.has(panel.id)).sort((left, right) => right.area - left.area); const panels: CadPanel[] = keptRaw.map((panel, index) => ({ id: panel.id, name: index === 0 ? '主面板' : `面板 ${index + 1}`, points: panel.points, centroid: panel.centroid, area: panel.area })); const folds = rawFolds.filter(fold => keep.has(fold.panelA) && keep.has(fold.panelB))
  if (rawPanels.length !== panels.length) warnings.push(`已忽略 ${rawPanels.length - panels.length} 个未连接到主要折叠结构的孔洞或独立轮廓`)
  if (!folds.length) warnings.push('没有识别到连接两个面板的折叠线，目前只能显示单个平面')
  return { panels, folds, rootPanelId: panels[0].id, progress: 0, detectedAt: Date.now(), warnings }
}

