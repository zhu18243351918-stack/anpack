import { createStore, del, entries, get, set } from 'idb-keyval'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CustomMaterialSlot, CustomModelFormat, ModelAssetDependency, ModelAssetRecord, Vector3Tuple } from './types'

const assetStore = createStore('packshot-model-assets', 'assets')
const objectCache = new Map<string, Promise<THREE.Group>>()

export function createAssetId() {
  return `asset-${crypto.randomUUID()}`
}

export async function putModelAsset(asset: ModelAssetRecord) {
  objectCache.delete(asset.id)
  await set(asset.id, asset, assetStore)
}

export async function getModelAsset(id: string) {
  return (await get<ModelAssetRecord>(id, assetStore)) ?? null
}

export async function deleteModelAsset(id: string) {
  objectCache.delete(id)
  await del(id, assetStore)
}

export async function listModelAssetIds() {
  return (await entries<string, ModelAssetRecord>(assetStore)).map(([id]) => id)
}

export async function cleanupModelAssets(referenced: string[]) {
  const keep = new Set(referenced)
  const all = await listModelAssetIds()
  await Promise.all(all.filter(id => !keep.has(id)).map(deleteModelAsset))
}

export async function serializeModel(root: THREE.Object3D) {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: false,
    trs: true,
    maxTextureSize: 8192,
  })
  if (!(result instanceof ArrayBuffer)) throw new Error('模型序列化未生成 GLB 数据')
  return result
}

export async function parseModelGlb(buffer: ArrayBuffer) {
  const loader = new GLTFLoader()
  const gltf = await loader.parseAsync(buffer.slice(0), '')
  return gltf.scene
}

export function loadModelAssetObject(id: string) {
  const cached = objectCache.get(id)
  if (cached) return cached
  const promise = getModelAsset(id).then(async asset => {
    if (!asset) throw new Error('自定义模型资产不存在或已被清理')
    return parseModelGlb(asset.glb)
  })
  objectCache.set(id, promise)
  return promise
}

export function invalidateModelAsset(id: string) {
  objectCache.delete(id)
}

export function cloneModelObject(root: THREE.Group) {
  const clone = root.clone(true)
  clone.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry = object.geometry.clone()
    object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone()
  })
  return clone
}

function toPhysicalMaterial(source: THREE.Material, index: number) {
  if (source instanceof THREE.MeshPhysicalMaterial) {
    const clone = source.clone(); clone.name ||= `材质 ${index + 1}`; return clone
  }
  if (source instanceof THREE.MeshStandardMaterial) {
    const clone = new THREE.MeshPhysicalMaterial({
      name: source.name || `材质 ${index + 1}`, color: source.color.clone(), map: source.map, normalMap: source.normalMap,
      roughness: source.roughness, roughnessMap: source.roughnessMap, metalness: source.metalness, metalnessMap: source.metalnessMap,
      emissive: source.emissive.clone(), emissiveMap: source.emissiveMap, emissiveIntensity: source.emissiveIntensity,
      alphaMap: source.alphaMap, aoMap: source.aoMap, aoMapIntensity: source.aoMapIntensity,
      opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest, side: source.side,
    })
    return clone
  }
  const legacy = source as THREE.Material & { color?: THREE.Color; map?: THREE.Texture; opacity?: number; transparent?: boolean }
  return new THREE.MeshPhysicalMaterial({
    name: source.name || `材质 ${index + 1}`,
    color: legacy.color?.clone() ?? new THREE.Color('#d8d8d8'),
    map: legacy.map ?? null,
    opacity: legacy.opacity ?? 1,
    transparent: legacy.transparent ?? false,
    roughness: .58,
    metalness: 0,
  })
}

export interface NormalizedModelInfo {
  root: THREE.Group
  boundsMm: Vector3Tuple
  triangleCount: number
  meshCount: number
  materialCount: number
  materials: CustomMaterialSlot[]
  warnings: string[]
}

export function normalizeImportedModel(input: THREE.Object3D, targetHeightMm = 180): NormalizedModelInfo {
  const root = new THREE.Group(); root.name = input.name || '导入模型'; root.add(input)
  const warnings: string[] = []; const remove: THREE.Object3D[] = []
  let meshCount = 0; let triangleCount = 0; let materialIndex = 0
  const materialMap = new Map<string, THREE.MeshPhysicalMaterial>()
  root.traverse(object => {
    object.userData.modelingId ||= crypto.randomUUID()
    if (object instanceof THREE.Camera || object instanceof THREE.Light) { remove.push(object); return }
    if (!(object instanceof THREE.Mesh)) return
    meshCount += 1
    object.name ||= `网格 ${meshCount}`
    object.geometry = object.geometry.clone()
    if (!object.geometry.getAttribute('position')) warnings.push(`${object.name} 缺少顶点数据`)
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0
    triangleCount += Math.floor(count / 3)
    if (object instanceof THREE.SkinnedMesh) warnings.push(`${object.name} 包含骨骼，已按当前静态姿态导入`)
    const sources = Array.isArray(object.material) ? object.material : [object.material]
    const normalized = sources.map(source => {
      const key = source.uuid
      let material = materialMap.get(key)
      if (!material) { material = toPhysicalMaterial(source, materialIndex++); material.userData.materialId ||= crypto.randomUUID(); materialMap.set(key, material) }
      return material
    })
    object.material = Array.isArray(object.material) ? normalized : normalized[0]
    object.castShadow = true; object.receiveShadow = true
  })
  remove.forEach(object => object.removeFromParent())
  if (!meshCount) throw new Error('文件中没有可渲染的网格对象')
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) throw new Error('无法计算模型尺寸')
  const initialSize = box.getSize(new THREE.Vector3())
  const scale = targetHeightMm / 50 / Math.max(initialSize.y, .0001)
  root.scale.setScalar(scale); root.updateMatrixWorld(true)
  const scaledBox = new THREE.Box3().setFromObject(root)
  const center = scaledBox.getCenter(new THREE.Vector3())
  root.position.x -= center.x; root.position.z -= center.z; root.position.y -= scaledBox.min.y
  root.updateMatrixWorld(true)
  const finalSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
  const boundsMm: Vector3Tuple = [finalSize.x * 50, finalSize.y * 50, finalSize.z * 50]
  if (triangleCount > 500_000) warnings.push(`模型包含 ${triangleCount.toLocaleString()} 个三角面，编辑和路径追踪可能变慢`)
  const materials: CustomMaterialSlot[] = [...materialMap.values()].map(material => ({
    id: String(material.userData.materialId), name: material.name || '未命名材质', color: `#${material.color.getHexString()}`,
    roughness: material.roughness, metalness: material.metalness, opacity: material.opacity, clearcoat: material.clearcoat,
    artworkUrl: null, artworkName: '', uv: { mode: 'existing', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false, crop: true },
  }))
  return { root, boundsMm, triangleCount, meshCount, materialCount: materials.length, materials, warnings }
}

export async function createModelAsset(args: {
  root: THREE.Object3D; name: string; sourceFormat: CustomModelFormat; dependencies?: ModelAssetDependency[]; warnings?: string[]; targetHeightMm?: number
}) {
  const normalized = normalizeImportedModel(args.root, args.targetHeightMm)
  if (normalized.triangleCount > 2_000_000) throw new Error('模型超过 200 万三角面硬限制，请在 Blender 或 C4D 中减面后重新导入')
  const glb = await serializeModel(normalized.root)
  const now = Date.now()
  const asset: ModelAssetRecord = {
    schemaVersion: 1, id: createAssetId(), name: args.name, sourceFormat: args.sourceFormat, createdAt: now, updatedAt: now,
    glb, preview: null, bounds: normalized.boundsMm, triangleCount: normalized.triangleCount, meshCount: normalized.meshCount,
    materialCount: normalized.materialCount, dependencies: args.dependencies ?? [], materials: normalized.materials,
    warnings: [...(args.warnings ?? []), ...normalized.warnings],
  }
  await putModelAsset(asset)
  return asset
}

export function modelAssetToConfig(asset: ModelAssetRecord) {
  return {
    type: 'custom' as const, assetId: asset.id, name: asset.name, sourceFormat: asset.sourceFormat, revision: asset.updatedAt,
    bounds: asset.bounds, triangleCount: asset.triangleCount, meshCount: asset.meshCount, materialCount: asset.materialCount,
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500)
}
