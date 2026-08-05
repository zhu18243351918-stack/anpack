import * as THREE from 'three'

export interface GeometrySnapshot {
  position: Float32Array; normal: Float32Array | null; uv: Float32Array | null; index: Uint32Array | null
  groups: { start: number; count: number; materialIndex?: number }[]
}

export function snapshotGeometry(geometry: THREE.BufferGeometry): GeometrySnapshot {
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('网格没有 position 属性')
  const normal = geometry.getAttribute('normal'); const uv = geometry.getAttribute('uv')
  return {
    position: new Float32Array(position.array as ArrayLike<number>),
    normal: normal ? new Float32Array(normal.array as ArrayLike<number>) : null,
    uv: uv ? new Float32Array(uv.array as ArrayLike<number>) : null,
    index: geometry.index ? new Uint32Array(geometry.index.array as ArrayLike<number>) : null,
    groups: geometry.groups.map(group => ({ ...group })),
  }
}

export function restoreGeometry(geometry: THREE.BufferGeometry, snapshot: GeometrySnapshot) {
  geometry.setAttribute('position', new THREE.BufferAttribute(snapshot.position.slice(), 3))
  if (snapshot.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(snapshot.normal.slice(), 3)); else geometry.deleteAttribute('normal')
  if (snapshot.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(snapshot.uv.slice(), 2)); else geometry.deleteAttribute('uv')
  geometry.setIndex(snapshot.index ? new THREE.BufferAttribute(snapshot.index.slice(), 1) : null)
  geometry.clearGroups(); snapshot.groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex))
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.computeVertexNormals()
  for (const key of Object.keys(geometry.attributes)) geometry.getAttribute(key).needsUpdate = true
}

export function indexedGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone()
  if (!geometry.index) {
    const count = geometry.getAttribute('position').count
    geometry.setIndex(Array.from({ length: count }, (_, index) => index))
  }
  return geometry
}

function arrays(geometry: THREE.BufferGeometry) {
  const indexed = indexedGeometry(geometry)
  return {
    geometry: indexed,
    positions: Array.from(indexed.getAttribute('position').array as ArrayLike<number>),
    uvs: indexed.getAttribute('uv') ? Array.from(indexed.getAttribute('uv').array as ArrayLike<number>) : null,
    indices: Array.from(indexed.index!.array as ArrayLike<number>),
  }
}

function finalize(geometry: THREE.BufferGeometry, positions: number[], indices: number[], uvs: number[] | null) {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return geometry
}

function faceVertices(indices: number[], face: number) {
  const start = face * 3
  if (start < 0 || start + 2 >= indices.length) throw new Error('请选择有效的三角面')
  return [indices[start], indices[start + 1], indices[start + 2]] as [number, number, number]
}

function vertex(positions: number[], index: number) {
  return new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
}

export function extrudeFace(source: THREE.BufferGeometry, face: number, distance: number) {
  const { geometry, positions, uvs, indices } = arrays(source); const [a, b, c] = faceVertices(indices, face)
  const va = vertex(positions, a); const vb = vertex(positions, b); const vc = vertex(positions, c)
  const normal = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize().multiplyScalar(distance)
  const newVertices = [va.clone().add(normal), vb.clone().add(normal), vc.clone().add(normal)]
  const base = positions.length / 3
  newVertices.forEach(value => positions.push(value.x, value.y, value.z))
  if (uvs) [a, b, c].forEach(index => uvs.push(uvs[index * 2] ?? 0, uvs[index * 2 + 1] ?? 0))
  indices.splice(face * 3, 3, base, base + 1, base + 2, a, b, base + 1, a, base + 1, base, b, c, base + 2, b, base + 2, base + 1, c, a, base, c, base, base + 2)
  return finalize(geometry, positions, indices, uvs)
}

export function insetFace(source: THREE.BufferGeometry, face: number, amount: number) {
  const { geometry, positions, uvs, indices } = arrays(source); const [a, b, c] = faceVertices(indices, face)
  const sourceVertices = [vertex(positions, a), vertex(positions, b), vertex(positions, c)]
  const center = sourceVertices[0].clone().add(sourceVertices[1]).add(sourceVertices[2]).multiplyScalar(1 / 3)
  const t = THREE.MathUtils.clamp(amount, .02, .92); const base = positions.length / 3
  sourceVertices.forEach(value => { const next = value.clone().lerp(center, t); positions.push(next.x, next.y, next.z) })
  if (uvs) {
    const cu = ((uvs[a * 2] ?? 0) + (uvs[b * 2] ?? 0) + (uvs[c * 2] ?? 0)) / 3
    const cv = ((uvs[a * 2 + 1] ?? 0) + (uvs[b * 2 + 1] ?? 0) + (uvs[c * 2 + 1] ?? 0)) / 3
    ;[a, b, c].forEach(index => uvs.push(THREE.MathUtils.lerp(uvs[index * 2] ?? 0, cu, t), THREE.MathUtils.lerp(uvs[index * 2 + 1] ?? 0, cv, t)))
  }
  indices.splice(face * 3, 3, base, base + 1, base + 2, a, b, base + 1, a, base + 1, base, b, c, base + 2, b, base + 2, base + 1, c, a, base, c, base, base + 2)
  return finalize(geometry, positions, indices, uvs)
}

export function deleteFace(source: THREE.BufferGeometry, face: number) {
  const { geometry, positions, uvs, indices } = arrays(source); faceVertices(indices, face); indices.splice(face * 3, 3)
  return finalize(geometry, positions, indices, uvs)
}

export function flipFace(source: THREE.BufferGeometry, face: number) {
  const { geometry, positions, uvs, indices } = arrays(source); faceVertices(indices, face)
  const start = face * 3; [indices[start + 1], indices[start + 2]] = [indices[start + 2], indices[start + 1]]
  return finalize(geometry, positions, indices, uvs)
}

export function mergeVertices(source: THREE.BufferGeometry, selected: number[]) {
  if (selected.length < 2) throw new Error('至少选择两个顶点才能合并')
  const { geometry, positions, uvs, indices } = arrays(source); const target = selected[0]; const center = new THREE.Vector3()
  selected.forEach(index => center.add(vertex(positions, index))); center.multiplyScalar(1 / selected.length)
  positions[target * 3] = center.x; positions[target * 3 + 1] = center.y; positions[target * 3 + 2] = center.z
  const selectedSet = new Set(selected); for (let i = 0; i < indices.length; i += 1) if (selectedSet.has(indices[i])) indices[i] = target
  const clean: number[] = []; for (let i = 0; i < indices.length; i += 3) if (indices[i] !== indices[i + 1] && indices[i + 1] !== indices[i + 2] && indices[i] !== indices[i + 2]) clean.push(indices[i], indices[i + 1], indices[i + 2])
  return finalize(geometry, positions, clean, uvs)
}

export function deleteVertices(source: THREE.BufferGeometry, selected: number[]) {
  if (!selected.length) throw new Error('请选择要删除的顶点')
  const { geometry, positions, uvs, indices } = arrays(source); const remove = new Set(selected); const clean: number[] = []
  for (let i = 0; i < indices.length; i += 3) if (!remove.has(indices[i]) && !remove.has(indices[i + 1]) && !remove.has(indices[i + 2])) clean.push(indices[i], indices[i + 1], indices[i + 2])
  return finalize(geometry, positions, clean, uvs)
}

export function bevelEdge(source: THREE.BufferGeometry, edge: [number, number], amount: number) {
  const geometry = indexedGeometry(source); geometry.computeVertexNormals()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute; const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  for (const index of edge) {
    position.setXYZ(index, position.getX(index) + normal.getX(index) * amount, position.getY(index) + normal.getY(index) * amount, position.getZ(index) + normal.getZ(index) * amount)
  }
  position.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry
}

export function autoBoxUV(source: THREE.BufferGeometry) {
  const geometry = source.toNonIndexed(); geometry.computeVertexNormals()
  const position = geometry.getAttribute('position') as THREE.BufferAttribute; const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  geometry.computeBoundingBox(); const box = geometry.boundingBox!; const size = box.getSize(new THREE.Vector3())
  const uv = new Float32Array(position.count * 2)
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index); const normalX = normal.getX(index), normalY = normal.getY(index), normalZ = normal.getZ(index); const nx = Math.abs(normalX), ny = Math.abs(normalY), nz = Math.abs(normalZ)
    let u: number; let v: number; let column: number; let row: number
    if (nx >= ny && nx >= nz) {
      u = normalX >= 0 ? (box.max.z - z) / Math.max(size.z, .0001) : (z - box.min.z) / Math.max(size.z, .0001); v = (y - box.min.y) / Math.max(size.y, .0001); column = normalX >= 0 ? 0 : 1; row = 0
    } else if (ny >= nz) {
      u = (x - box.min.x) / Math.max(size.x, .0001); v = normalY >= 0 ? (box.max.z - z) / Math.max(size.z, .0001) : (z - box.min.z) / Math.max(size.z, .0001); column = normalY >= 0 ? 2 : 0; row = normalY >= 0 ? 0 : 1
    } else {
      u = normalZ >= 0 ? (x - box.min.x) / Math.max(size.x, .0001) : (box.max.x - x) / Math.max(size.x, .0001); v = (y - box.min.y) / Math.max(size.y, .0001); column = normalZ >= 0 ? 1 : 2; row = 1
    }
    const cellWidth = 1 / 3; const cellHeight = 1 / 2; const gutter = .025
    uv[index * 2] = column * cellWidth + gutter + u * (cellWidth - gutter * 2)
    uv[index * 2 + 1] = 1 - ((row + 1) * cellHeight - gutter - v * (cellHeight - gutter * 2))
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geometry
}

export function topologyInfo(geometry: THREE.BufferGeometry) {
  const indexed = indexedGeometry(geometry); const indices = indexed.index!.array as ArrayLike<number>; const edges = new Map<string, number>()
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i], indices[i + 1], indices[i + 2]]
    for (let e = 0; e < 3; e += 1) { const a = triangle[e], b = triangle[(e + 1) % 3]; const key = a < b ? `${a}:${b}` : `${b}:${a}`; edges.set(key, (edges.get(key) ?? 0) + 1) }
  }
  const nonManifoldEdges = [...edges.values()].filter(count => count > 2).length; const boundaryEdges = [...edges.values()].filter(count => count === 1).length
  return { nonManifoldEdges, boundaryEdges, manifold: nonManifoldEdges === 0, triangles: Math.floor(indices.length / 3), vertices: indexed.getAttribute('position').count }
}
