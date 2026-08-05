import { create } from 'zustand'
import * as THREE from 'three'
import { restoreGeometry, snapshotGeometry, type GeometrySnapshot } from './meshTools'
import type { MeshSelection, MeshSelectionMode, ModelAssetRecord, ModelingState, ModelingTransformMode } from './types'

interface GeometryHistory { kind: 'geometry'; label: string; objectId: string; before: GeometrySnapshot; after: GeometrySnapshot; bytes: number }
interface TransformHistory { kind: 'transform'; label: string; objectId: string; before: number[]; after: number[]; bytes: number }
type HistoryEntry = GeometryHistory | TransformHistory

const emptySelection: MeshSelection = { objectId: null, vertices: [], edge: null, face: null }
const initialModeling: ModelingState = { status: 'idle', selectionMode: 'object', transformMode: 'translate', selection: emptySelection, dirty: false, error: null, warning: null }

function matrixArray(object: THREE.Object3D) {
  object.updateMatrix(); return object.matrix.toArray()
}

function applyMatrixArray(object: THREE.Object3D, values: number[]) {
  object.matrix.fromArray(values); object.matrix.decompose(object.position, object.quaternion, object.scale); object.updateMatrixWorld(true)
}

function findObject(root: THREE.Group | null, id: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null
  root?.traverse(object => { if (object.userData.modelingId === id) result = object })
  return result as THREE.Object3D | null
}

function historyBytes(entry: HistoryEntry) {
  return entry.bytes
}

interface ModelingRuntime {
  state: ModelingState
  asset: ModelAssetRecord | null
  root: THREE.Group | null
  past: HistoryEntry[]
  future: HistoryEntry[]
  initialize: (asset: ModelAssetRecord, root: THREE.Group) => void
  clear: () => void
  setStatus: (status: ModelingState['status'], error?: string | null) => void
  setSelectionMode: (mode: MeshSelectionMode) => void
  setTransformMode: (mode: ModelingTransformMode) => void
  selectObject: (objectId: string | null) => void
  setVertices: (vertices: number[]) => void
  setFace: (face: number | null) => void
  setEdge: (edge: [number, number] | null) => void
  setWarning: (warning: string | null) => void
  commitGeometry: (objectId: string, next: THREE.BufferGeometry, label: string) => void
  commitTransform: (objectId: string, before: number[], label: string) => void
  markDirty: () => void
  markSaved: (asset: ModelAssetRecord) => void
  undo: () => void
  redo: () => void
}

function boundedHistory(entries: HistoryEntry[]) {
  const result = entries.slice(-30); let bytes = result.reduce((sum, entry) => sum + historyBytes(entry), 0)
  while (result.length > 1 && bytes > 256 * 1024 * 1024) bytes -= historyBytes(result.shift()!)
  return result
}

export const useModeling = create<ModelingRuntime>((setState, getState) => ({
  state: { ...initialModeling, selection: { ...emptySelection } }, asset: null, root: null, past: [], future: [],
  initialize: (asset, root) => setState({ asset, root, past: [], future: [], state: { ...initialModeling, status: 'ready', selection: { ...emptySelection } } }),
  clear: () => setState({ asset: null, root: null, past: [], future: [], state: { ...initialModeling, selection: { ...emptySelection } } }),
  setStatus: (status, error = null) => setState(current => ({ state: { ...current.state, status, error } })),
  setSelectionMode: selectionMode => setState(current => ({ state: { ...current.state, selectionMode, selection: { ...current.state.selection, vertices: [], edge: null, face: null } } })),
  setTransformMode: transformMode => setState(current => ({ state: { ...current.state, transformMode } })),
  selectObject: objectId => setState(current => ({ state: { ...current.state, selection: { objectId, vertices: [], edge: null, face: null } } })),
  setVertices: vertices => setState(current => ({ state: { ...current.state, selection: { ...current.state.selection, vertices, edge: null, face: null } } })),
  setFace: face => setState(current => ({ state: { ...current.state, selection: { ...current.state.selection, face, vertices: [], edge: null } } })),
  setEdge: edge => setState(current => ({ state: { ...current.state, selection: { ...current.state.selection, edge, vertices: [], face: null } } })),
  setWarning: warning => setState(current => ({ state: { ...current.state, warning } })),
  commitGeometry: (objectId, next, label) => {
    const current = getState(); const object = findObject(current.root, objectId)
    if (!(object instanceof THREE.Mesh)) throw new Error('未找到可编辑网格')
    const before = snapshotGeometry(object.geometry); const after = snapshotGeometry(next)
    object.geometry.dispose(); object.geometry = next; object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere(); object.updateMatrixWorld(true)
    const bytes = before.position.byteLength + (before.index?.byteLength ?? 0) + after.position.byteLength + (after.index?.byteLength ?? 0)
    const entry: GeometryHistory = { kind: 'geometry', label, objectId, before, after, bytes }
    setState({ past: boundedHistory([...current.past, entry]), future: [], state: { ...current.state, dirty: true, error: null } })
  },
  commitTransform: (objectId, before, label) => {
    const current = getState(); const object = findObject(current.root, objectId); if (!object) return
    const after = matrixArray(object); if (after.every((value, index) => Math.abs(value - before[index]) < 1e-8)) return
    const entry: TransformHistory = { kind: 'transform', label, objectId, before, after, bytes: 256 }
    setState({ past: boundedHistory([...current.past, entry]), future: [], state: { ...current.state, dirty: true } })
  },
  markDirty: () => setState(current => ({ state: { ...current.state, dirty: true } })),
  markSaved: asset => setState(current => ({ asset, state: { ...current.state, status: 'ready', dirty: false, error: null } })),
  undo: () => {
    const current = getState(); const entry = current.past.at(-1); if (!entry) return
    const object = findObject(current.root, entry.objectId); if (!object) return
    if (entry.kind === 'geometry' && object instanceof THREE.Mesh) restoreGeometry(object.geometry, entry.before)
    if (entry.kind === 'transform') applyMatrixArray(object, entry.before)
    setState({ past: current.past.slice(0, -1), future: [entry, ...current.future].slice(0, 30), state: { ...current.state, dirty: true } })
  },
  redo: () => {
    const current = getState(); const entry = current.future[0]; if (!entry) return
    const object = findObject(current.root, entry.objectId); if (!object) return
    if (entry.kind === 'geometry' && object instanceof THREE.Mesh) restoreGeometry(object.geometry, entry.after)
    if (entry.kind === 'transform') applyMatrixArray(object, entry.after)
    setState({ past: boundedHistory([...current.past, entry]), future: current.future.slice(1), state: { ...current.state, dirty: true } })
  },
}))

export function findModelingObject(root: THREE.Group | null, id: string | null) {
  return id ? findObject(root, id) : null
}
