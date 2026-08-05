import { create } from 'zustand'
import { get, set } from 'idb-keyval'
import { getSceneTemplate, materialPresets, modelDefaults } from './presets'
import { cleanupModelAssets } from './modelAssets'
import type { BoxFace, FaceArtwork, MaterialConfig, ProceduralModelType, ProjectSnapshot, RenderJobState } from './types'

const ALL_FACES: BoxFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom', 'topFront', 'topBack', 'topLeft', 'topRight', 'bottomFront', 'bottomBack', 'bottomLeft', 'bottomRight', 'glue']
const emptyFace = (): FaceArtwork => ({ url: null, name: '', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false })
const emptyFaces = (): Record<BoxFace, FaceArtwork> => Object.fromEntries(ALL_FACES.map(face => [face, emptyFace()])) as Record<BoxFace, FaceArtwork>

export const initialSnapshot: ProjectSnapshot = {
  version: 4,
  projectName: '未命名包装提案',
  template: 'carton',
  model: modelDefaults.box,
  artwork: { url: null, name: '', mapping: 'smart', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false, crop: true, faces: emptyFaces(), innerFaces: emptyFaces() },
  material: {
    preset: '哑光纸', color: '#f2efe7', roughness: .76, metalness: 0, opacity: 1, transmission: 0,
    clearcoat: .04, textureStrength: 1, normalScale: .16, textureScale: 5, ior: 1.46, thickness: .04, clearcoatRoughness: .72,
  },
  camera: { projection: 'perspective', fov: 34, position: [5.8, 4.1, 7.2], target: [0, 1.35, 0], focusDistance: 7.2, fStop: 5.6, depthOfField: false },
  lighting: {
    ambient: .22, key: 3.2, fill: 1.15, point: .65, temperature: 5200, keyPosition: [4, 6, 4],
    shadowSoftness: 5, exposure: .88, environment: 'studio-small-09', environmentIntensity: .9,
    environmentRotation: -18, keySize: 4.5, fillSize: 5.5,
  },
  scene: { preset: '电商白底', templateId: 'commerce-white', background: '#e9e9e7', floor: true, pedestal: false, decor: false, transparent: false, productPosition: [0, 0, 0], productRotation: [0, 0, 0], productScale: 1, cyclorama: true, floorRoughness: .76, objectOverrides: {} },
  export: { format: 'png', size: 2048, ratio: '1:1', transparent: false, quality: .92, renderer: 'pathtraced', renderQuality: 'studio', samples: 128, bounces: 5, denoise: true },
  cycles: { device: 'auto', adaptiveSampling: true, samples: 256, bounces: 6, denoise: true, transparent: false },
  cadDieline: null,
}

const idleRenderJob: RenderJobState = { stage: 'idle', progress: 0, message: '', error: null, fallback: null }

interface StudioState {
  snapshot: ProjectSnapshot; past: ProjectSnapshot[]; future: ProjectSnapshot[]; hydrated: boolean; renderJob: RenderJobState
  selectedSceneObjectId: string | null
  setSnapshot: (next: ProjectSnapshot, history?: boolean) => void
  patch: <K extends keyof ProjectSnapshot>(key: K, value: Partial<ProjectSnapshot[K]> | ProjectSnapshot[K]) => void
  chooseModel: (type: ProceduralModelType) => void; applyMaterial: (name: string) => void; applyScene: (name: string) => void
  selectSceneObject: (id: string | null) => void
  setRenderJob: (value: Partial<RenderJobState>) => void; resetRenderJob: () => void
  undo: () => void; redo: () => void; hydrate: () => Promise<void>; save: () => Promise<void>; reset: () => void
}

const clone = (s: ProjectSnapshot): ProjectSnapshot => structuredClone(s)
const referencedAssetIds = (snapshots: ProjectSnapshot[]) => [...new Set(snapshots.flatMap(snapshot => snapshot.model.type === 'custom' ? [snapshot.model.assetId] : []))]

export function migrateSnapshot(saved: unknown): ProjectSnapshot | null {
  if (!saved || typeof saved !== 'object') return null
  const version = (saved as { version?: number }).version
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return null
  const legacy = saved as Partial<ProjectSnapshot>
  const defaults = clone(initialSnapshot)
  const next = { ...defaults, ...legacy, version: 4 } as ProjectSnapshot
  next.model = structuredClone(legacy.model ?? next.model)
  next.artwork = { ...defaults.artwork, ...(legacy.artwork ?? {}) }
  next.material = { ...defaults.material, ...(legacy.material ?? {}) }
  next.camera = { ...defaults.camera, ...(legacy.camera ?? {}) }
  next.lighting = { ...defaults.lighting, ...(legacy.lighting ?? {}) }
  next.scene = { ...defaults.scene, ...(legacy.scene ?? {}) }
  const migratedScene = getSceneTemplate(next.scene.templateId || next.scene.preset)
  if (!legacy.scene?.templateId) next.scene = { ...next.scene, ...migratedScene.scene, productPosition: [0, 0, 0] }
  next.scene.templateId = migratedScene.id
  next.scene.preset = migratedScene.name
  next.export = { ...defaults.export, ...(legacy.export ?? {}) }
  next.cycles = { ...defaults.cycles, ...(legacy.cycles ?? {}) }
  next.cadDieline = legacy.cadDieline ? { ...structuredClone(legacy.cadDieline), foldMapping: legacy.cadDieline.foldMapping ?? null } : null
  if (!next.template) next.template = next.model.type === 'custom' ? 'custom' : next.model.type === 'bottle' ? 'bottleLabel' : next.model.type === 'can' ? 'canLabel' : next.model.type === 'pouch' ? 'pouch' : 'carton'
  next.artwork.faces = { ...emptyFaces(), ...(legacy.artwork?.faces ?? {}) }
  next.artwork.innerFaces = { ...emptyFaces(), ...(legacy.artwork?.innerFaces ?? {}) }
  for (const face of ALL_FACES) {
    next.artwork.faces[face] = { ...emptyFace(), ...next.artwork.faces[face] }
    next.artwork.innerFaces[face] = { ...emptyFace(), ...next.artwork.innerFaces[face] }
  }
  if (next.artwork.faces.top.url && !next.artwork.faces.topFront.url) next.artwork.faces.topFront = { ...next.artwork.faces.top }
  if (next.artwork.faces.bottom.url && !next.artwork.faces.bottomFront.url) next.artwork.faces.bottomFront = { ...next.artwork.faces.bottom }
  if (next.artwork.url && !next.artwork.faces.front.url) next.artwork.faces.front = { ...emptyFace(), url: next.artwork.url, name: next.artwork.name }
  return next
}

export const useStudio = create<StudioState>((setState, getState) => ({
  snapshot: clone(initialSnapshot), past: [], future: [], hydrated: false, renderJob: { ...idleRenderJob }, selectedSceneObjectId: 'product-0',
  setSnapshot: (next, history = true) => setState(state => history
    ? { snapshot: clone(next), past: [...state.past.slice(-29), clone(state.snapshot)], future: [] }
    : { snapshot: clone(next) }),
  patch: (key, value) => {
    const state = getState(); const next = clone(state.snapshot); const current = next[key]
    ;(next as unknown as Record<string, unknown>)[key] = typeof current === 'object' && current !== null && !Array.isArray(current)
      ? { ...current, ...(value as object) } : value
    state.setSnapshot(next)
  },
  chooseModel: type => {
    const state = getState(); const next = clone(state.snapshot); next.model = structuredClone(modelDefaults[type])
    const preset = type === 'box' ? '哑光纸' : type === 'bottle' ? '亮面塑料' : type === 'can' ? '铝罐' : '磨砂塑料'
    next.material = { ...next.material, ...materialPresets[preset], preset }
    state.setSnapshot(next)
  },
  applyMaterial: name => getState().patch('material', { ...materialPresets[name], preset: name } as Partial<MaterialConfig>),
  applyScene: id => {
    const state = getState(); const template = getSceneTemplate(id); const next = clone(state.snapshot)
    next.scene = { ...next.scene, ...template.scene, templateId: template.id, preset: template.name, productPosition: [0, 0, 0], productRotation: [0, 0, 0], productScale: 1, objectOverrides: {} }
    next.lighting = { ...next.lighting, ...template.lighting }
    next.camera = { ...next.camera, ...template.camera }
    state.setSnapshot(next); setState({ selectedSceneObjectId: 'product-0' })
  },
  selectSceneObject: id => setState({ selectedSceneObjectId: id }),
  setRenderJob: value => setState(state => ({ renderJob: { ...state.renderJob, ...value } })),
  resetRenderJob: () => setState({ renderJob: { ...idleRenderJob } }),
  undo: () => setState(state => state.past.length ? { snapshot: clone(state.past.at(-1)!), past: state.past.slice(0, -1), future: [clone(state.snapshot), ...state.future].slice(0, 30) } : state),
  redo: () => setState(state => state.future.length ? { snapshot: clone(state.future[0]), past: [...state.past, clone(state.snapshot)].slice(-30), future: state.future.slice(1) } : state),
  hydrate: async () => {
    const saved = await get<unknown>('anpack-project') ?? await get<unknown>('packshot-project')
    const migrated = migrateSnapshot(saved)
    if (migrated) setState({ snapshot: migrated })
    setState({ hydrated: true })
  },
  save: async () => { const state = getState(); await set('anpack-project', clone(state.snapshot)); await cleanupModelAssets(referencedAssetIds([state.snapshot, ...state.past, ...state.future])) },
  reset: () => { setState({ snapshot: clone(initialSnapshot), past: [], future: [], renderJob: { ...idleRenderJob }, selectedSceneObjectId: 'product-0' }); void cleanupModelAssets([]) },
}))
