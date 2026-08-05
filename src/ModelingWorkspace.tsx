/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { Box, BoxSelect, CircleDot, Copy, Download, Eye, EyeOff, FlipHorizontal2, Layers3, Maximize2, Merge, Move3d, Plus, Redo2, Rotate3d, Scale3d, Scissors, Sparkles, Trash2, Triangle, Undo2, Upload } from 'lucide-react'
import { useStudio } from './store'
import { useModeling, findModelingObject } from './modelingStore'
import { autoBoxUV, bevelEdge, deleteFace, deleteVertices, extrudeFace, flipFace, insetFace, mergeVertices, restoreGeometry, snapshotGeometry, topologyInfo } from './meshTools'
import { cloneModelObject, getModelAsset, invalidateModelAsset, loadModelAssetObject, putModelAsset, serializeModel } from './modelAssets'
import { exportObjectGlb, exportObjectObjZip } from './modelExport'
import type { CustomMaterialSlot, CustomModelConfig, MeshSelectionMode } from './types'

function allEditableObjects(root: THREE.Group | null) {
  const objects: THREE.Object3D[] = []
  root?.traverse(object => { object.userData.modelingId ||= object.uuid; if (object !== root && (object instanceof THREE.Mesh || object.children.length)) objects.push(object) })
  return objects.slice(0, 300)
}

function selectedMesh(root: THREE.Group | null, objectId: string | null) {
  const object = findModelingObject(root, objectId)
  return object instanceof THREE.Mesh ? object : null
}

function selectionVertexIndices(mesh: THREE.Mesh, mode: MeshSelectionMode, vertices: number[], edge: [number, number] | null, face: number | null) {
  if (mode === 'vertex') return vertices
  if (mode === 'edge') return edge ? [...edge] : []
  if (mode === 'face' && face !== null) {
    const geometry = mesh.geometry; const index = geometry.index?.array
    return index ? [Number(index[face * 3]), Number(index[face * 3 + 1]), Number(index[face * 3 + 2])] : [face * 3, face * 3 + 1, face * 3 + 2]
  }
  return []
}

function faceOverlayGeometry(mesh: THREE.Mesh | null, face: number | null) {
  if (!mesh || face === null) return null
  const position = mesh.geometry.getAttribute('position'); const index = mesh.geometry.index?.array
  const ids = index ? [Number(index[face * 3]), Number(index[face * 3 + 1]), Number(index[face * 3 + 2])] : [face * 3, face * 3 + 1, face * 3 + 2]
  if (ids.some(id => id < 0 || id >= position.count)) return null
  const points = ids.flatMap(id => [position.getX(id), position.getY(id), position.getZ(id)])
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setIndex([0, 1, 2]); geometry.computeVertexNormals(); return geometry
}

function ModelingCanvas() {
  const root = useModeling(s => s.root); const state = useModeling(s => s.state); const { selectObject, setVertices, setFace, setEdge, commitGeometry, commitTransform, setWarning } = useModeling()
  const [dragging, setDragging] = useState(false); const selected = selectedMesh(root, state.selection.objectId); const selectedObject = findModelingObject(root, state.selection.objectId)
  const overlay = useMemo(() => faceOverlayGeometry(selected, state.selection.face), [selected, state.selection.face, state.dirty])
  const pivot = useMemo(() => new THREE.Object3D(), []); const transformBefore = useRef<number[] | null>(null); const subBefore = useRef<ReturnType<typeof snapshotGeometry> | null>(null); const pivotStart = useRef(new THREE.Matrix4())
  const selectedIds = selected ? selectionVertexIndices(selected, state.selectionMode, state.selection.vertices, state.selection.edge, state.selection.face) : []
  useEffect(() => () => overlay?.dispose(), [overlay])
  useEffect(() => {
    if (!selected || !selectedIds.length || state.selectionMode === 'object') return
    selected.updateMatrixWorld(true); const position = selected.geometry.getAttribute('position'); const center = new THREE.Vector3()
    selectedIds.forEach(index => center.add(new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(selected.matrixWorld)))
    center.multiplyScalar(1 / selectedIds.length); pivot.position.copy(center); pivot.rotation.set(0, 0, 0); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(true)
  }, [selected, selectedIds.join(','), state.selectionMode, state.dirty, pivot])
  const choose = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation(); const object = event.object
    if (!(object instanceof THREE.Mesh)) return
    object.userData.modelingId ||= crypto.randomUUID(); const objectId = String(object.userData.modelingId)
    if (state.selectionMode === 'object') { selectObject(objectId); return }
    if (state.selection.objectId !== objectId) selectObject(objectId)
    const face = event.faceIndex ?? null; if (face === null) return
    if (state.selectionMode === 'face') { setFace(face); return }
    const geometry = object.geometry; const index = geometry.index?.array
    const ids = index ? [Number(index[face * 3]), Number(index[face * 3 + 1]), Number(index[face * 3 + 2])] : [face * 3, face * 3 + 1, face * 3 + 2]
    const point = object.worldToLocal(event.point.clone()); const position = geometry.getAttribute('position')
    if (state.selectionMode === 'vertex') {
      const nearest = ids.sort((a, b) => point.distanceToSquared(new THREE.Vector3(position.getX(a), position.getY(a), position.getZ(a))) - point.distanceToSquared(new THREE.Vector3(position.getX(b), position.getY(b), position.getZ(b))))[0]
      setVertices(event.shiftKey ? [...new Set([...state.selection.vertices, nearest])] : [nearest]); return
    }
    const pairs: [number, number][] = [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]
    const nearestEdge = pairs.sort((left, right) => {
      const l = new THREE.Line3(new THREE.Vector3(position.getX(left[0]), position.getY(left[0]), position.getZ(left[0])), new THREE.Vector3(position.getX(left[1]), position.getY(left[1]), position.getZ(left[1]))).closestPointToPoint(point, true, new THREE.Vector3()).distanceToSquared(point)
      const r = new THREE.Line3(new THREE.Vector3(position.getX(right[0]), position.getY(right[0]), position.getZ(right[0])), new THREE.Vector3(position.getX(right[1]), position.getY(right[1]), position.getZ(right[1]))).closestPointToPoint(point, true, new THREE.Vector3()).distanceToSquared(point)
      return l - r
    })[0]
    setEdge(nearestEdge)
  }, [selectObject, setEdge, setFace, setVertices, state.selection, state.selectionMode])
  const beginTransform = () => {
    setDragging(true)
    if (state.selectionMode === 'object' && selectedObject) transformBefore.current = selectedObject.matrix.toArray()
    else if (selected) { subBefore.current = snapshotGeometry(selected.geometry); pivot.updateMatrixWorld(true); pivotStart.current.copy(pivot.matrixWorld) }
  }
  const changingTransform = () => {
    if (!selected || state.selectionMode === 'object' || !subBefore.current || !selectedIds.length) return
    restoreGeometry(selected.geometry, subBefore.current)
    pivot.updateMatrixWorld(true); selected.updateMatrixWorld(true)
    const delta = pivot.matrixWorld.clone().multiply(pivotStart.current.clone().invert()); const inverseMesh = selected.matrixWorld.clone().invert(); const position = selected.geometry.getAttribute('position') as THREE.BufferAttribute
    selectedIds.forEach(index => {
      const next = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(selected.matrixWorld).applyMatrix4(delta).applyMatrix4(inverseMesh)
      position.setXYZ(index, next.x, next.y, next.z)
    })
    position.needsUpdate = true; selected.geometry.computeVertexNormals(); selected.geometry.computeBoundingBox(); selected.geometry.computeBoundingSphere()
  }
  const endTransform = () => {
    setDragging(false)
    if (state.selectionMode === 'object' && selectedObject && transformBefore.current) commitTransform(String(selectedObject.userData.modelingId), transformBefore.current, `${state.transformMode === 'translate' ? '移动' : state.transformMode === 'rotate' ? '旋转' : '缩放'}对象`)
    else if (selected && subBefore.current) {
      const next = selected.geometry.clone(); restoreGeometry(selected.geometry, subBefore.current); commitGeometry(String(selected.userData.modelingId), next, '变换网格选择')
      subBefore.current = null
    }
  }
  return <>
    <color attach="background" args={['#17191e']} />
    <ambientLight intensity={.7} /><directionalLight position={[5, 8, 5]} intensity={2.2} castShadow /><directionalLight position={[-4, 3, -2]} intensity={.7} color="#9fc8ff" />
    <Grid infiniteGrid fadeDistance={35} sectionColor="#606772" cellColor="#343942" sectionSize={1} cellSize={.2} position={[0, -.005, 0]} />
    {root && <primitive object={root} onPointerDown={choose} />}
    {selectedObject && state.selectionMode === 'object' && <boxHelper key={`${state.selection.objectId}-${state.dirty}`} args={[selectedObject, '#ff7a22']} />}
    {selected && state.selectionMode === 'vertex' && <points geometry={selected.geometry} matrix={selected.matrixWorld} matrixAutoUpdate={false}><pointsMaterial color="#ff9a58" size={7} sizeAttenuation={false} depthTest={false} /></points>}
    {selected && state.selectionMode === 'edge' && state.selection.edge && (() => { const position = selected.geometry.getAttribute('position'); const [a, b] = state.selection.edge; const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(position.getX(a), position.getY(a), position.getZ(a)), new THREE.Vector3(position.getX(b), position.getY(b), position.getZ(b))]); return <lineSegments geometry={line} matrix={selected.matrixWorld} matrixAutoUpdate={false}><lineBasicMaterial color="#ff7a22" linewidth={2} depthTest={false} /></lineSegments> })()}
    {selected && overlay && state.selectionMode === 'face' && <mesh geometry={overlay} matrix={selected.matrixWorld} matrixAutoUpdate={false}><meshBasicMaterial color="#ff7a22" transparent opacity={.54} side={THREE.DoubleSide} depthTest={false} /></mesh>}
    {selectedObject && state.selectionMode === 'object' && <TransformControls object={selectedObject} mode={state.transformMode} onMouseDown={beginTransform} onObjectChange={() => undefined} onMouseUp={endTransform} />}
    {selected && selectedIds.length > 0 && state.selectionMode !== 'object' && <><primitive object={pivot} /><TransformControls object={pivot} mode={state.transformMode} onMouseDown={beginTransform} onObjectChange={changingTransform} onMouseUp={endTransform} /></>}
    <OrbitControls makeDefault enabled={!dragging} enableDamping dampingFactor={.08} minDistance={1} maxDistance={30} onStart={() => setWarning(null)} />
  </>
}

function SmallSlider({ label, value, min, max, step = .01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="modeler-slider"><span>{label}<b>{Number(value.toFixed(2))}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
}

type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'plane' | 'bottle' | 'pouch'

const PRIMITIVE_META: { kind: PrimitiveKind; name: string; hint: string }[] = [
  { kind: 'box', name: '盒体', hint: '立方体' }, { kind: 'cylinder', name: '圆柱', hint: '罐体' },
  { kind: 'bottle', name: '瓶体', hint: '旋转体' }, { kind: 'pouch', name: '软袋', hint: '分段基础' },
  { kind: 'sphere', name: '球体', hint: '装饰物' }, { kind: 'plane', name: '平面', hint: '标签/底板' },
]

function primitiveGeometry(kind: PrimitiveKind) {
  if (kind === 'cylinder') return new THREE.CylinderGeometry(1, 1, 2.4, 64, 4)
  if (kind === 'sphere') return new THREE.SphereGeometry(1, 48, 32)
  if (kind === 'plane') return new THREE.PlaneGeometry(2.4, 2.4, 8, 8)
  if (kind === 'bottle') {
    const points = [new THREE.Vector2(.02, 0), new THREE.Vector2(.72, .04), new THREE.Vector2(.82, .18), new THREE.Vector2(.82, 1.55), new THREE.Vector2(.76, 1.78), new THREE.Vector2(.4, 2.05), new THREE.Vector2(.34, 2.3), new THREE.Vector2(.02, 2.3)]
    return new THREE.LatheGeometry(points, 72)
  }
  if (kind === 'pouch') {
    const geometry = new THREE.BoxGeometry(2, 2.7, .52, 12, 16, 4).toNonIndexed(); const position = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index); const y = position.getY(index); const z = position.getZ(index); const vertical = THREE.MathUtils.clamp((y + 1.35) / 2.7, 0, 1); const bulge = Math.sin(Math.PI * vertical) * Math.max(0, 1 - Math.abs(x)) * .12
      position.setZ(index, z + Math.sign(z || 1) * bulge)
    }
    position.needsUpdate = true; geometry.computeVertexNormals(); return geometry
  }
  return new THREE.BoxGeometry(2, 2, 2, 2, 2, 2)
}

function VectorEditor({ label, values, suffix, step, onChange }: { label: string; values: [number, number, number]; suffix?: string; step?: number; onChange: (axis: number, value: number) => void }) {
  return <div className="modeler-vector"><span>{label}{suffix && <small>{suffix}</small>}</span><div>{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}><i>{axis}</i><input type="number" step={step ?? .01} value={Number(values[index].toFixed(3))} onChange={event => onChange(index, Number(event.target.value))} /></label>)}</div></div>
}

function UvPreview({ mesh }: { mesh: THREE.Mesh | null }) {
  const lines = useMemo(() => {
    if (!mesh) return [] as string[]; const uv = mesh.geometry.getAttribute('uv'); if (!uv) return [] as string[]
    const index = mesh.geometry.index?.array; const count = Math.min(index ? index.length : uv.count, 6000); const result: string[] = []
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = index ? [Number(index[i]), Number(index[i + 1]), Number(index[i + 2])] : [i, i + 1, i + 2]
      result.push(ids.map(id => `${(uv.getX(id) * 100).toFixed(2)},${((1 - uv.getY(id)) * 100).toFixed(2)}`).join(' '))
    }
    return result
  }, [mesh, mesh?.geometry])
  return <div className="uv-preview"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><pattern id="uv-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#ffffff12" strokeWidth=".35" /></pattern></defs><rect width="100" height="100" fill="url(#uv-grid)" />{lines.map((points, index) => <polygon key={index} points={points} fill="#ff7a2209" stroke="#f5a36d" strokeWidth=".22" />)}</svg>{!lines.length && <span>当前网格没有有效 UV</span>}</div>
}

function collectMaterialSlots(root: THREE.Group, existing: CustomMaterialSlot[]) {
  const previous = new Map(existing.map(slot => [slot.id, slot])); const result = new Map<string, CustomMaterialSlot>()
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const list = Array.isArray(object.material) ? object.material : [object.material]
    list.forEach((source, index) => {
      const material = source as THREE.MeshPhysicalMaterial; material.userData.materialId ||= crypto.randomUUID(); const id = String(material.userData.materialId); const old = previous.get(id)
      result.set(id, { id, name: material.name || `材质 ${index + 1}`, color: `#${material.color?.getHexString?.() ?? 'cccccc'}`, roughness: material.roughness ?? .5, metalness: material.metalness ?? 0, opacity: material.opacity ?? 1, clearcoat: material.clearcoat ?? 0, artworkUrl: old?.artworkUrl ?? null, artworkName: old?.artworkName ?? '', uv: old?.uv ?? { mode: 'existing', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false, crop: true } })
    })
  })
  return [...result.values()]
}

export default function ModelingWorkspace({ config, onImport, onOpenUv, sceneObjectKey, contextLabel }: { config: CustomModelConfig; onImport: () => void; onOpenUv: () => void; sceneObjectKey?: string; contextLabel?: string }) {
  const runtime = useModeling(); const state = useModeling(s => s.state); const root = useModeling(s => s.root); const asset = useModeling(s => s.asset); const past = useModeling(s => s.past); const future = useModeling(s => s.future)
  const [tab, setTab] = useState<'geometry' | 'material' | 'uv'>('geometry'); const [materialIndex, setMaterialIndex] = useState(0); const [version, setVersion] = useState(0); const [createOpen, setCreateOpen] = useState(true)
  useEffect(() => {
    let active = true; runtime.setStatus('loading')
    Promise.all([getModelAsset(config.assetId), loadModelAssetObject(config.assetId)]).then(([record, loaded]) => {
      if (!active || !record) return; const editable = cloneModelObject(loaded); editable.traverse(object => { object.userData.modelingId ||= crypto.randomUUID() }); runtime.initialize(record, editable)
    }).catch(error => runtime.setStatus('error', error instanceof Error ? error.message : '模型读取失败'))
    return () => { active = false; runtime.clear() }
  }, [config.assetId])
  const persistCurrentModel = useCallback(async () => {
    const current = useModeling.getState(); const currentRoot = current.root; const currentAsset = current.asset
    if (!currentRoot || !currentAsset) return false
    try {
      current.setStatus('saving'); const glb = await serializeModel(currentRoot); currentRoot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(currentRoot); const size = box.getSize(new THREE.Vector3()); let triangles = 0; let meshes = 0
      currentRoot.traverse(object => { if (object instanceof THREE.Mesh) { meshes += 1; triangles += Math.floor((object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3) } })
      const updated = { ...currentAsset, glb, updatedAt: Date.now(), bounds: [size.x * 50, size.y * 50, size.z * 50] as [number, number, number], triangleCount: triangles, meshCount: meshes, materials: collectMaterialSlots(currentRoot, currentAsset.materials) }
      await putModelAsset(updated); invalidateModelAsset(updated.id); current.markSaved(updated)
      const studio = useStudio.getState(); const next = structuredClone(studio.snapshot)
      const updatedConfig: CustomModelConfig = { type: 'custom', assetId: updated.id, name: updated.name, sourceFormat: updated.sourceFormat, revision: updated.updatedAt, bounds: updated.bounds, triangleCount: updated.triangleCount, meshCount: updated.meshCount, materialCount: updated.materials.length }
      if (sceneObjectKey && next.scene.objectAssets[sceneObjectKey]?.assetId === updated.id) {
        next.scene.objectAssets = { ...next.scene.objectAssets, [sceneObjectKey]: updatedConfig }; studio.setSnapshot(next, false)
      } else if (next.model.type === 'custom' && next.model.assetId === updated.id) { next.model = updatedConfig; studio.setSnapshot(next, false) }
      return true
    } catch (error) { current.setStatus('error', error instanceof Error ? error.message : '模型自动保存失败'); return false }
  }, [sceneObjectKey])
  useEffect(() => {
    if (!state.dirty || !root || !asset) return
    const timer = setTimeout(() => { void persistCurrentModel() }, 800)
    return () => clearTimeout(timer)
  }, [state.dirty, root, asset, persistCurrentModel])
  const objects = useMemo(() => allEditableObjects(root), [root, state.dirty, version]); const activeObject = findModelingObject(root, state.selection.objectId); const mesh = activeObject instanceof THREE.Mesh ? activeObject : null
  const materials = mesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []; const activeMaterial = materials[Math.min(materialIndex, Math.max(0, materials.length - 1))] as THREE.MeshPhysicalMaterial | undefined
  const topology = useMemo(() => mesh ? topologyInfo(mesh.geometry) : null, [mesh, state.dirty, version])
  const operation = (label: string, task: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry) => {
    if (!mesh) return runtime.setWarning('请先选择一个网格对象')
    try { runtime.commitGeometry(String(mesh.userData.modelingId), task(mesh.geometry), label); runtime.setWarning(null) } catch (error) { runtime.setWarning(error instanceof Error ? error.message : `${label}失败`) }
  }
  const autoUnwrapAndOpen = async () => {
    if (!mesh) return runtime.setWarning('请先选择一个网格对象')
    try {
      runtime.commitGeometry(String(mesh.userData.modelingId), autoBoxUV(mesh.geometry), '自动展开UV')
      runtime.setWarning('正在保存UV并打开2D展开设计…')
      if (await persistCurrentModel()) {
        if (sceneObjectKey) { setTab('uv'); runtime.setWarning('模板对象 UV 已保存，并会同步回场景') }
        else { runtime.setWarning(null); onOpenUv() }
      }
    } catch (error) { runtime.setWarning(error instanceof Error ? error.message : '自动展开UV失败') }
  }
  const duplicate = () => {
    if (!activeObject?.parent) return; const copy = activeObject.clone(true); copy.name = `${activeObject.name} 副本`; copy.traverse(object => { object.userData.modelingId = crypto.randomUUID(); if (object instanceof THREE.Mesh) { object.geometry = object.geometry.clone(); object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone() } }); copy.position.x += .3; activeObject.parent.add(copy); runtime.selectObject(String(copy.userData.modelingId)); runtime.markDirty(); setVersion(value => value + 1)
  }
  const remove = () => { if (!activeObject) return; activeObject.removeFromParent(); runtime.selectObject(null); runtime.markDirty(); setVersion(value => value + 1) }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null; if (target?.closest('input,select,textarea')) return
      const lower = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && lower === 'z') { event.preventDefault(); if (event.shiftKey) runtime.redo(); else runtime.undo(); return }
      if ((event.ctrlKey || event.metaKey) && lower === 'd') { event.preventDefault(); duplicate(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { if (activeObject) { event.preventDefault(); remove() }; return }
      if (lower === 'g') runtime.setTransformMode('translate'); if (lower === 'r') runtime.setTransformMode('rotate'); if (lower === 's') runtime.setTransformMode('scale')
      if (event.key === '1') runtime.setSelectionMode('object'); if (event.key === '2') runtime.setSelectionMode('vertex'); if (event.key === '3') runtime.setSelectionMode('edge'); if (event.key === '4') runtime.setSelectionMode('face')
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [runtime, activeObject, version])
  const addPrimitive = (kind: PrimitiveKind) => {
    if (!root) return
    const material = new THREE.MeshPhysicalMaterial({ name: `${PRIMITIVE_META.find(item => item.kind === kind)?.name ?? '基础'}材质`, color: kind === 'plane' ? '#bfc5ce' : '#d8d2c8', roughness: .56, metalness: kind === 'cylinder' ? .12 : 0, clearcoat: .12 })
    const geometry = primitiveGeometry(kind); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, material); mesh.name = PRIMITIVE_META.find(item => item.kind === kind)?.name ?? '新对象'; mesh.userData.modelingId = crypto.randomUUID(); mesh.castShadow = true; mesh.receiveShadow = true
    if (kind === 'plane') { mesh.rotation.x = -Math.PI / 2; mesh.position.y = .01 } else { const bounds = geometry.boundingBox; mesh.position.y = bounds ? -bounds.min.y : 1 }
    const offset = Math.min(objects.filter(object => object.parent === root).length, 6) * .16; mesh.position.x += offset; mesh.position.z += offset
    root.add(mesh); runtime.selectObject(String(mesh.userData.modelingId)); runtime.setSelectionMode('object'); runtime.markDirty(); setCreateOpen(false); setVersion(value => value + 1)
  }
  const updateTransform = (kind: 'position' | 'rotation' | 'scale', axis: number, value: number) => {
    if (!activeObject || !Number.isFinite(value)) return; const before = activeObject.matrix.toArray(); const vector = activeObject[kind] as THREE.Vector3 | THREE.Euler
    if (kind === 'rotation') { const next = [activeObject.rotation.x, activeObject.rotation.y, activeObject.rotation.z]; next[axis] = THREE.MathUtils.degToRad(value); activeObject.rotation.set(next[0], next[1], next[2]) }
    else (vector as THREE.Vector3).setComponent(axis, kind === 'scale' ? Math.max(.001, value) : value)
    activeObject.updateMatrix(); activeObject.updateMatrixWorld(true); runtime.commitTransform(String(activeObject.userData.modelingId), before, `${kind === 'position' ? '移动' : kind === 'rotation' ? '旋转' : '缩放'}对象`); setVersion(current => current + 1)
  }
  const changeMaterial = (key: 'roughness' | 'metalness' | 'opacity' | 'clearcoat', value: number) => { if (!activeMaterial) return; activeMaterial[key] = value; activeMaterial.transparent = activeMaterial.opacity < 1; activeMaterial.needsUpdate = true; runtime.markDirty(); setVersion(value => value + 1) }
  const uploadArtwork = (file?: File) => {
    if (!file || !activeMaterial) return; const reader = new FileReader(); reader.onload = () => new THREE.TextureLoader().load(String(reader.result), texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.anisotropy = 16; activeMaterial.map = texture; activeMaterial.color.set('#ffffff'); activeMaterial.needsUpdate = true; runtime.markDirty(); setVersion(value => value + 1) }); reader.readAsDataURL(file)
  }
  const modelStatus = state.status === 'saving' ? '正在自动保存' : state.status === 'loading' ? '正在载入模型' : state.status === 'error' ? state.error : state.dirty ? '有未保存修改' : '已保存到本机'
  return <main className="modeling-workspace">
    <aside className="modeler-outliner"><div className="modeler-heading"><div><b>{sceneObjectKey ? '模板对象层级' : '对象层级'}</b><span>{asset?.meshCount ?? 0} 个网格 · {(asset?.triangleCount ?? 0).toLocaleString()} 面</span></div><div className="modeler-heading-actions"><button className={`create-model-button ${createOpen ? 'active' : ''}`} onClick={() => setCreateOpen(value => !value)} title="创建几何体"><Plus size={14} />创建</button><button onClick={onImport} title="导入另一个模型"><Upload size={16} /></button></div></div>{sceneObjectKey && <div className="modeler-scene-context"><Sparkles size={15} /><div><b>正在编辑场景模板对象</b><span>{contextLabel} · 保存后自动同步回 3D 场景</span></div></div>}{createOpen && <div className="primitive-palette"><div><b>创建几何体</b><span>添加后可立即编辑</span></div><div>{PRIMITIVE_META.map(item => <button key={item.kind} onClick={() => addPrimitive(item.kind)}><Box size={15} /><span>{item.name}<small>{item.hint}</small></span></button>)}</div></div>}<div className="outliner-list">{objects.length ? objects.map(object => <button key={object.uuid} className={state.selection.objectId === object.userData.modelingId ? 'selected' : ''} onClick={() => runtime.selectObject(String(object.userData.modelingId))}>{object instanceof THREE.Mesh ? <Triangle size={14} /> : <Layers3 size={14} />}<span>{object.name || '未命名对象'}</span><i onClick={event => { event.stopPropagation(); object.visible = !object.visible; runtime.markDirty(); setVersion(value => value + 1) }}>{object.visible ? <Eye size={13} /> : <EyeOff size={13} />}</i></button>) : <div className="outliner-empty"><Box size={23} /><b>模型中没有对象</b><span>点击上方“创建”添加基础几何体</span></div>}</div>{activeObject && <div className="outliner-actions"><button onClick={duplicate}><Copy size={14} />复制</button><button onClick={remove}><Trash2 size={14} />删除</button></div>}<div className="modeler-file-guide"><b>通用格式工作流</b><span>{sceneObjectKey ? '当前修改会替换场景模板中的此对象。' : '推荐使用 GLB；Blender/C4D 原生工程请先导出。'}</span><button onClick={onImport}>导入 GLB / glTF / FBX / OBJ</button></div></aside>
    <section className="modeler-stage"><header><div className="selection-modes">{([['object', Box, '对象'], ['vertex', CircleDot, '顶点'], ['edge', Scissors, '边'], ['face', Triangle, '面']] as const).map(([mode, Icon, label]) => <button key={mode} className={state.selectionMode === mode ? 'active' : ''} onClick={() => runtime.setSelectionMode(mode)}><Icon size={15} />{label}</button>)}</div><div className="transform-modes">{([['translate', Move3d, '移动'], ['rotate', Rotate3d, '旋转'], ['scale', Scale3d, '缩放']] as const).map(([mode, Icon, label]) => <button key={mode} className={state.transformMode === mode ? 'active' : ''} onClick={() => runtime.setTransformMode(mode)}><Icon size={15} />{label}</button>)}</div><div className="modeler-history"><button disabled={!past.length} onClick={runtime.undo} title="撤销"><Undo2 size={15} /></button><button disabled={!future.length} onClick={runtime.redo} title="重做"><Redo2 size={15} /></button></div></header><div className="modeler-canvas"><Canvas shadows dpr={[1, 2]} camera={{ position: [5, 3.8, 6.5], fov: 38 }} gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}><ModelingCanvas /></Canvas>{state.status === 'loading' && <div className="modeler-loading"><span className="spinner" />正在载入自定义模型</div>}<div className={`modeler-save-state state-${state.status}`}>{modelStatus}</div>{state.warning && <div className="modeler-warning">{state.warning}</div>}</div></section>
    <aside className="modeler-properties"><nav><button className={tab === 'geometry' ? 'active' : ''} onClick={() => setTab('geometry')}>几何</button><button className={tab === 'material' ? 'active' : ''} onClick={() => setTab('material')}>材质</button><button className={tab === 'uv' ? 'active' : ''} onClick={() => setTab('uv')}>UV</button></nav><div className="modeler-panel">
      <label className="modeler-name"><span>对象名称</span><input disabled={!activeObject} value={activeObject?.name ?? ''} onChange={event => { if (activeObject) { activeObject.name = event.target.value; runtime.markDirty(); setVersion(value => value + 1) } }} /></label>
      {tab === 'geometry' && <>{activeObject && <div className="modeler-transform-panel"><div className="modeler-section-label"><b>对象变换</b><span>G / R / S</span></div><VectorEditor label="位置" values={[activeObject.position.x, activeObject.position.y, activeObject.position.z]} onChange={(axis, value) => updateTransform('position', axis, value)} /><VectorEditor label="旋转" suffix="°" step={1} values={[THREE.MathUtils.radToDeg(activeObject.rotation.x), THREE.MathUtils.radToDeg(activeObject.rotation.y), THREE.MathUtils.radToDeg(activeObject.rotation.z)]} onChange={(axis, value) => updateTransform('rotation', axis, value)} /><VectorEditor label="缩放" values={[activeObject.scale.x, activeObject.scale.y, activeObject.scale.z]} onChange={(axis, value) => updateTransform('scale', axis, value)} /></div>}{topology ? <div className="topology-stats"><span><b>{topology.vertices.toLocaleString()}</b>顶点</span><span><b>{topology.triangles.toLocaleString()}</b>三角面</span><span className={topology.manifold ? 'good' : 'bad'}><b>{topology.nonManifoldEdges}</b>非流形边</span></div> : <div className="modeler-empty">从左侧选择或创建网格对象</div>}<div className="modeler-section-label"><b>网格编辑</b><span>1 对象 · 2 点 · 3 边 · 4 面</span></div><div className="mesh-action-grid"><button disabled={!mesh || state.selection.face === null} onClick={() => operation('挤出面', geometry => extrudeFace(geometry, state.selection.face!, .16))}><Maximize2 size={15} />挤出</button><button disabled={!mesh || state.selection.face === null} onClick={() => operation('内插面', geometry => insetFace(geometry, state.selection.face!, .22))}><BoxSelect size={15} />内插</button><button disabled={!mesh || !state.selection.edge} onClick={() => operation('边倒角', geometry => bevelEdge(geometry, state.selection.edge!, .035))}><Scissors size={15} />倒角</button><button disabled={!mesh || (!state.selection.vertices.length && state.selection.face === null)} onClick={() => state.selection.face !== null ? operation('删除面', geometry => deleteFace(geometry, state.selection.face!)) : operation('删除顶点', geometry => deleteVertices(geometry, state.selection.vertices))}><Trash2 size={15} />删除</button><button disabled={!mesh || state.selection.vertices.length < 2} onClick={() => operation('合并顶点', geometry => mergeVertices(geometry, state.selection.vertices))}><Merge size={15} />合并顶点</button><button disabled={!mesh} onClick={() => operation('重算法线', geometry => { const next = geometry.clone(); next.computeVertexNormals(); return next })}><Sparkles size={15} />重算法线</button><button disabled={!mesh || state.selection.face === null} onClick={() => operation('翻转面法线', geometry => flipFace(geometry, state.selection.face!))}><FlipHorizontal2 size={15} />翻转面</button></div><div className="topology-note">先选择对象，再切换顶点、边或面模式。可使用变换手柄移动选择；Delete 删除，Ctrl+D 复制，Ctrl+Z 撤销。</div></>}
      {tab === 'material' && <>{materials.length ? <><label className="modeler-select"><span>材质槽</span><select value={materialIndex} onChange={event => setMaterialIndex(Number(event.target.value))}>{materials.map((material, index) => <option key={material.uuid} value={index}>{material.name || `材质 ${index + 1}`}</option>)}</select></label><label className="modeler-color"><span>基础颜色</span><input type="color" value={activeMaterial ? `#${activeMaterial.color.getHexString()}` : '#ffffff'} onChange={event => { if (activeMaterial) { activeMaterial.color.set(event.target.value); activeMaterial.needsUpdate = true; runtime.markDirty(); setVersion(value => value + 1) } }} /></label><SmallSlider label="粗糙度" value={activeMaterial?.roughness ?? .5} min={0} max={1} onChange={value => changeMaterial('roughness', value)} /><SmallSlider label="金属度" value={activeMaterial?.metalness ?? 0} min={0} max={1} onChange={value => changeMaterial('metalness', value)} /><SmallSlider label="透明度" value={activeMaterial?.opacity ?? 1} min={.05} max={1} onChange={value => changeMaterial('opacity', value)} /><SmallSlider label="清漆" value={activeMaterial?.clearcoat ?? 0} min={0} max={1} onChange={value => changeMaterial('clearcoat', value)} /><label className="modeler-upload"><Upload size={16} /><span>{activeMaterial?.map ? '替换包装图案' : '上传包装图案'}</span><input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => uploadArtwork(event.target.files?.[0])} /></label></> : <div className="modeler-empty">请选择带材质的网格对象</div>}</>}
      {tab === 'uv' && <><UvPreview mesh={mesh} /><button className="primary modeler-auto-uv" disabled={!mesh || state.status === 'saving'} onClick={() => void autoUnwrapAndOpen()}><Sparkles size={15} />自动展开并进入2D设计</button>{activeMaterial?.map && <><SmallSlider label="图案水平缩放" value={activeMaterial.map.repeat.x} min={.2} max={5} onChange={value => { activeMaterial.map!.repeat.x = value; activeMaterial.map!.needsUpdate = true; runtime.markDirty(); setVersion(v => v + 1) }} /><SmallSlider label="图案垂直缩放" value={activeMaterial.map.repeat.y} min={.2} max={5} onChange={value => { activeMaterial.map!.repeat.y = value; activeMaterial.map!.needsUpdate = true; runtime.markDirty(); setVersion(v => v + 1) }} /><SmallSlider label="水平偏移" value={activeMaterial.map.offset.x} min={-1} max={1} onChange={value => { activeMaterial.map!.offset.x = value; activeMaterial.map!.needsUpdate = true; runtime.markDirty(); setVersion(v => v + 1) }} /><SmallSlider label="垂直偏移" value={activeMaterial.map.offset.y} min={-1} max={1} onChange={value => { activeMaterial.map!.offset.y = value; activeMaterial.map!.needsUpdate = true; runtime.markDirty(); setVersion(v => v + 1) }} /></>}<div className="topology-note">自动展开会生成适合包装模型的六向盒式投影，并保存后进入2D UV工作区。自定义模型显示的是UV布局，不是纸盒生产刀模。</div></>}
      <div className="model-export-actions"><button disabled={!root} onClick={() => root && exportObjectGlb(root, asset?.name ?? config.name)}><Download size={14} />导出 GLB</button><button disabled={!root} onClick={() => root && exportObjectObjZip(root, asset?.name ?? config.name)}><Download size={14} />导出 OBJ ZIP</button></div>
    </div></aside>
  </main>
}
