export type ModelType = 'box' | 'bottle' | 'can' | 'pouch' | 'custom'
export type ProceduralModelType = Exclude<ModelType, 'custom'>
export type BoxFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'topFront' | 'topBack' | 'topLeft' | 'topRight' | 'bottomFront' | 'bottomBack' | 'bottomLeft' | 'bottomRight' | 'glue'
export type PackagingTemplate = 'carton' | 'mailer' | 'gift' | 'shoppingBag' | 'pouch' | 'bottleLabel' | 'canLabel' | 'custom'
export type ArtworkSurface = 'outer' | 'inner'
export type Vector3Tuple = [number, number, number]
export type RenderQuality = 'draft' | 'studio' | 'ultra'
export type ExportRenderer = 'cycles' | 'pathtraced' | 'realtime'
export type RuntimePlatform = 'web' | 'desktop'
export type RenderBackend = 'gpu-pathtracer' | 'cycles'

export interface BoxConfig { type: 'box'; width: number; height: number; depth: number; radius: number; thickness: number }
export interface BottleConfig { type: 'bottle'; height: number; diameter: number; shoulder: number; neck: number; cap: number }
export interface CanConfig { type: 'can'; height: number; diameter: number; lid: number; radius: number }
export interface PouchConfig { type: 'pouch'; width: number; height: number; depth: number; seal: number; gusset: number }
export type CustomModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'procedural'
export interface CustomModelConfig {
  type: 'custom'; assetId: string; name: string; sourceFormat: CustomModelFormat; revision: number
  bounds: Vector3Tuple; triangleCount: number; meshCount: number; materialCount: number
}
export type PackagingModelConfig = BoxConfig | BottleConfig | CanConfig | PouchConfig | CustomModelConfig

export interface FaceArtwork { url: string | null; name: string; scale: number; rotation: number; offsetX: number; offsetY: number; repeat: boolean; fit?: 'contain' | 'cover' }
export interface ArtworkTransform {
  url: string | null; name: string; mapping: 'smart' | 'front' | 'wrap' | 'dieline'; faces: Record<BoxFace, FaceArtwork>; innerFaces: Record<BoxFace, FaceArtwork>
  scale: number; rotation: number; offsetX: number; offsetY: number; repeat: boolean; crop: boolean
}
export interface MaterialConfig {
  preset: string; color: string; roughness: number; metalness: number; opacity: number
  transmission: number; clearcoat: number; textureStrength: number; normalScale: number
  textureScale: number; ior: number; thickness: number; clearcoatRoughness: number
}
export interface CameraConfig {
  projection: 'perspective' | 'orthographic'; fov: number; position: Vector3Tuple; target: Vector3Tuple
  focusDistance: number; fStop: number; depthOfField: boolean
}
export interface LightingConfig {
  ambient: number; key: number; fill: number; point: number; temperature: number
  keyPosition: Vector3Tuple; shadowSoftness: number; exposure: number
  environment: 'studio-small-09' | 'none'; environmentIntensity: number; environmentRotation: number
  keySize: number; fillSize: number
}
export interface SceneObjectTransform {
  position: Vector3Tuple; rotation: Vector3Tuple; scale: number; visible: boolean
}
export interface SceneConfig {
  preset: string; background: string; floor: boolean; pedestal: boolean; decor: boolean
  templateId: string; transparent: boolean; productPosition: Vector3Tuple; productRotation: Vector3Tuple
  productScale: number; cyclorama: boolean; floorRoughness: number
  objectOverrides: Record<string, SceneObjectTransform>
  objectAssets: Record<string, CustomModelConfig>
}
export interface ExportConfig {
  format: 'png' | 'jpg'; size: 1024 | 2048 | 4096; ratio: '1:1' | '4:3' | '3:4' | '16:9'
  transparent: boolean; quality: number; renderer: ExportRenderer; renderQuality: RenderQuality
  samples: number; bounces: number; denoise: boolean
}
export interface CyclesRenderConfig {
  device: 'auto' | 'optix' | 'cuda' | 'hip' | 'oneapi' | 'cpu'; adaptiveSampling: boolean
  samples: number; bounces: number; denoise: boolean; transparent: boolean
}
export interface UVLayoutConfig { mode: 'existing' | 'auto-box' | 'xatlas'; scale: number; rotation: number; offsetX: number; offsetY: number; repeat: boolean; crop: boolean }
export interface CustomMaterialSlot {
  id: string; name: string; color: string; roughness: number; metalness: number; opacity: number; clearcoat: number
  artworkUrl: string | null; artworkName: string; uv: UVLayoutConfig
}
export interface ModelAssetDependency { name: string; kind: 'model' | 'material' | 'texture' | 'binary'; resolved: boolean; size: number }
export interface ModelAssetRecord {
  schemaVersion: 1; id: string; name: string; sourceFormat: CustomModelFormat; createdAt: number; updatedAt: number
  glb: ArrayBuffer; preview: string | null; bounds: Vector3Tuple; triangleCount: number; meshCount: number; materialCount: number
  dependencies: ModelAssetDependency[]; materials: CustomMaterialSlot[]; warnings: string[]
}
export type MeshSelectionMode = 'object' | 'vertex' | 'edge' | 'face'
export type ModelingTransformMode = 'translate' | 'rotate' | 'scale'
export interface MeshSelection { objectId: string | null; vertices: number[]; edge: [number, number] | null; face: number | null }
export interface MeshEditCommand { id: string; label: string; objectId: string; beforeBytes: number; createdAt: number }
export interface ModelingState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'; selectionMode: MeshSelectionMode; transformMode: ModelingTransformMode
  selection: MeshSelection; dirty: boolean; error: string | null; warning: string | null
}
export type CadLineRole = 'cut' | 'fold' | 'bleed' | 'annotation'
export interface CadPoint { x: number; y: number }
export interface CadPathEntity { id: string; layer: string; role: CadLineRole; closed: boolean; points: CadPoint[] }
export interface CadLayerConfig { name: string; role: CadLineRole; visible: boolean; entityCount: number }
export interface CadPanel { id: string; name: string; points: CadPoint[]; centroid: CadPoint; area: number }
export interface CadFoldEdge { id: string; panelA: string; panelB: string; start: CadPoint; end: CadPoint; angle: number; direction: 1 | -1 }
export interface CadFoldMapping { panels: CadPanel[]; folds: CadFoldEdge[]; rootPanelId: string; progress: number; detectedAt: number; warnings: string[] }
export interface CadDielineConfig {
  id: string; name: string; sourceFormat: 'dxf' | 'created'; importedAt: number; unit: 'mm' | 'cm' | 'inch' | 'meter' | 'unitless'; scaleToMm: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }; widthMm: number; heightMm: number
  paths: CadPathEntity[]; layers: CadLayerConfig[]; unsupportedEntities: number; warnings: string[]
  artwork: FaceArtwork; foldMapping: CadFoldMapping | null
}
export interface ProjectSnapshot {
  version: 4; projectName: string; template: PackagingTemplate; model: PackagingModelConfig; artwork: ArtworkTransform
  material: MaterialConfig; camera: CameraConfig; lighting: LightingConfig; scene: SceneConfig; export: ExportConfig; cycles: CyclesRenderConfig; cadDieline: CadDielineConfig | null
}

export interface CyclesRenderJob {
  id: string; glbPath: string; outputPath: string; width: number; height: number; format: 'PNG' | 'JPEG'; quality: number
  transparent: boolean; samples: number; bounces: number; denoise: boolean; adaptiveSampling: boolean; device: CyclesRenderConfig['device']
  camera: CameraConfig; lighting: LightingConfig; scene: SceneConfig
}

export type RenderJobStage = 'idle' | 'preparing' | 'building' | 'sampling' | 'denoising' | 'encoding' | 'done' | 'cancelled' | 'error'
export interface RenderJobState { stage: RenderJobStage; progress: number; message: string; error: string | null; fallback: string | null }

export interface PackshotExportRequest {
  width: number; height: number; mime: 'image/png' | 'image/jpeg'; quality: number; transparent: boolean
  renderer: ExportRenderer; samples: number; bounces: number; denoise: boolean
  signal?: AbortSignal; onProgress?: (state: Pick<RenderJobState, 'stage' | 'progress' | 'message'>) => void
}

export interface PackshotExportResult { blob: Blob; renderer: ExportRenderer; fallbackReason?: string }
