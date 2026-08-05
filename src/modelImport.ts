import * as THREE from 'three'
import { unzipSync } from 'fflate'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { CustomModelFormat, ModelAssetDependency } from './types'

const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj'] as const
const TEXTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'basis', 'tga', 'bmp', 'gif', 'hdr', 'exr'])

function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function normalizePath(name: string) {
  return decodeURIComponent(name.replaceAll('\\', '/').replace(/^\.\//, '')).toLowerCase()
}

async function expandArchives(input: File[]) {
  const output: File[] = []
  for (const file of input) {
    if (extension(file.name) !== 'zip') { output.push(file); continue }
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith('/')) continue
      output.push(new File([bytes], name, { type: '' }))
    }
  }
  return output
}

function dependencyKind(file: File): ModelAssetDependency['kind'] {
  const ext = extension(file.name)
  if (MODEL_EXTENSIONS.includes(ext as typeof MODEL_EXTENSIONS[number])) return 'model'
  if (ext === 'mtl') return 'material'
  if (TEXTURE_EXTENSIONS.has(ext)) return 'texture'
  return 'binary'
}

function chooseMainFile(files: File[]) {
  const candidates = files.filter(file => MODEL_EXTENSIONS.includes(extension(file.name) as typeof MODEL_EXTENSIONS[number]))
  if (!candidates.length) {
    const native = files.find(file => ['blend', 'c4d'].includes(extension(file.name)))
    if (native) throw new Error(`${native.name} 是原生工程格式，请先从 Blender 或 Cinema 4D 导出 GLB、glTF、FBX 或 OBJ`)
    throw new Error('未找到 GLB、glTF、FBX 或 OBJ 主模型文件')
  }
  if (candidates.length > 1) {
    const glb = candidates.find(file => extension(file.name) === 'glb')
    if (glb) return glb
  }
  return candidates[0]
}

interface ImportResult {
  root: THREE.Object3D
  name: string
  format: CustomModelFormat
  dependencies: ModelAssetDependency[]
  warnings: string[]
  files: File[]
}

export async function loadImportedFiles(input: File[], onProgress?: (progress: number, message: string) => void): Promise<ImportResult> {
  if (!input.length) throw new Error('请选择模型文件')
  const rawBytes = input.reduce((sum, file) => sum + file.size, 0)
  if (rawBytes > 250 * 1024 * 1024) throw new Error('导入文件包超过 250MB，请优化模型或纹理后重试')
  onProgress?.(5, '读取模型文件')
  const files = await expandArchives(input)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > 250 * 1024 * 1024) throw new Error('解压后的模型文件超过 250MB限制')
  const main = chooseMainFile(files); const format = extension(main.name) as CustomModelFormat
  const warnings: string[] = []
  const dependencies = files.map(file => ({ name: file.name, kind: dependencyKind(file), resolved: true, size: file.size }))
  const urlByPath = new Map<string, string>(); const urls: string[] = []
  for (const file of files) {
    const url = URL.createObjectURL(file); urls.push(url)
    const relative = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
    urlByPath.set(relative, url); urlByPath.set(normalizePath(file.name.split(/[\\/]/).pop() ?? file.name), url)
  }
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(requested => {
    if (requested.startsWith('blob:') || requested.startsWith('data:')) return requested
    const normalized = normalizePath(requested.split(/[?#]/)[0])
    const direct = urlByPath.get(normalized) ?? urlByPath.get(normalized.split('/').pop() ?? normalized)
    if (direct) return direct
    const name = requested.split('/').pop() ?? requested
    warnings.push(`缺少外部依赖：${name}`)
    return requested
  })
  manager.onProgress = (_url, loaded, total) => onProgress?.(15 + loaded / Math.max(total, 1) * 55, '解析模型与纹理')
  const mainUrl = urlByPath.get(normalizePath(main.name))!
  let root: THREE.Object3D
  try {
    if (format === 'glb' || format === 'gltf') {
      const draco = new DRACOLoader(manager); draco.setDecoderPath('/draco/')
      const ktx2 = new KTX2Loader(manager); ktx2.setTranscoderPath('/basis/')
      const canvas = document.createElement('canvas')
      const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'low-power' })
      ktx2.detectSupport(renderer)
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.loadAsync(mainUrl)
      root = gltf.scene
      if (gltf.animations.length) warnings.push(`检测到 ${gltf.animations.length} 个动画，包装工作台仅保留静态模型`)
      draco.dispose(); ktx2.dispose(); renderer.dispose()
    } else if (format === 'fbx') {
      root = await new FBXLoader(manager).loadAsync(mainUrl)
      if ((root as THREE.Group & { animations?: THREE.AnimationClip[] }).animations?.length) warnings.push('FBX动画未导入，仅使用静态姿态')
    } else {
      const objectLoader = new OBJLoader(manager)
      const mtl = files.find(file => extension(file.name) === 'mtl')
      if (mtl) {
        const materials = new MTLLoader(manager).parse(await mtl.text(), '')
        materials.preload(); objectLoader.setMaterials(materials)
      } else warnings.push('OBJ未附带MTL，将使用默认PBR材质')
      root = await objectLoader.loadAsync(mainUrl)
    }
    onProgress?.(78, '标准化坐标、尺寸与材质')
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url))
  }
  return { root, name: main.name.replace(/\.[^.]+$/, ''), format, dependencies, warnings: [...new Set(warnings)], files }
}

