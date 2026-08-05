import * as THREE from 'three'
import { strToU8, zipSync } from 'fflate'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { downloadBlob } from './modelAssets'

function safeName(value: string) {
  return value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'model'
}

export async function exportObjectGlb(root: THREE.Object3D, filename: string) {
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, trs: true, maxTextureSize: 8192 })
  if (!(result instanceof ArrayBuffer)) throw new Error('GLB 导出失败')
  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `${safeName(filename)}.glb`)
}

async function texturePng(texture: THREE.Texture) {
  const image = texture.image as CanvasImageSource & { width?: number; height?: number }
  const width = image?.width ?? 0; const height = image?.height ?? 0
  if (!image || !width || !height) return null
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) return null
  context.drawImage(image, 0, 0, width, height)
  return new Promise<Uint8Array | null>(resolve => canvas.toBlob(async blob => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/png'))
}

export async function exportObjectObjZip(root: THREE.Object3D, filename: string) {
  const base = safeName(filename); const clone = root.clone(true); const materials = new Map<string, THREE.Material>()
  clone.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const list = Array.isArray(object.material) ? object.material : [object.material]
    list.forEach((material, index) => {
      material.name = safeName(material.name || `material_${materials.size + index + 1}`)
      materials.set(material.name, material)
    })
  })
  const obj = `mtllib ${base}.mtl\n${new OBJExporter().parse(clone)}`
  const mtl: string[] = ['# Anpack OBJ material library']; const output: Record<string, Uint8Array> = {}
  let textureIndex = 0
  for (const [name, source] of materials) {
    const material = source as THREE.Material & { color?: THREE.Color; roughness?: number; metalness?: number; opacity?: number; map?: THREE.Texture | null }
    const color = material.color ?? new THREE.Color('#cccccc'); const opacity = material.opacity ?? 1
    mtl.push('', `newmtl ${name}`, `Kd ${color.r.toFixed(6)} ${color.g.toFixed(6)} ${color.b.toFixed(6)}`, `d ${opacity.toFixed(6)}`, `Pr ${(material.roughness ?? .5).toFixed(6)}`, `Pm ${(material.metalness ?? 0).toFixed(6)}`)
    if (material.map) {
      const bytes = await texturePng(material.map)
      if (bytes) { const textureName = `textures/texture_${++textureIndex}.png`; output[textureName] = bytes; mtl.push(`map_Kd ${textureName}`) }
    }
  }
  output[`${base}.obj`] = strToU8(obj); output[`${base}.mtl`] = strToU8(mtl.join('\n'))
  downloadBlob(new Blob([zipSync(output, { level: 6 })], { type: 'application/zip' }), `${base}-obj.zip`)
}

