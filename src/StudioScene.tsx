import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls, OrthographicCamera, PerspectiveCamera, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from './store'
import { renderArtworkCanvas } from './artworkTransform'
import { getSceneTemplate } from './presets'
import { DEFAULT_SCENE_OBJECT_TRANSFORM, sceneObjectAssetKey } from './sceneObjects'
import { cloneModelObject, loadModelAssetObject, serializeModel } from './modelAssets'
import type { BoxFace, CameraConfig, CustomModelConfig, FaceArtwork, MaterialConfig, PackagingModelConfig, PackshotExportRequest, PackshotExportResult } from './types'

declare global {
  interface Window {
    __packshotExport?: (request: PackshotExportRequest) => Promise<PackshotExportResult>
    __packshotExportSceneObjectGlb?: (id: string) => Promise<ArrayBuffer>
  }
}

type SurfaceMaps = { normalMap: THREE.Texture; roughnessMap: THREE.Texture }

function useConfiguredTexture(artwork: Pick<FaceArtwork, 'url' | 'repeat' | 'scale' | 'offsetX' | 'offsetY' | 'rotation'>, aspect = 1) {
  const textureKey = `${artwork.url ?? ''}|${artwork.repeat}|${artwork.scale}|${artwork.offsetX}|${artwork.offsetY}|${artwork.rotation}|${aspect.toFixed(4)}`
  const [base, setBase] = useState<{ key: string; texture: THREE.CanvasTexture } | null>(null)
  useEffect(() => {
    if (!artwork.url) return
    let active = true; let generated: THREE.CanvasTexture | null = null
    const image = new Image()
    image.onload = () => {
      if (!active) return
      const texture = new THREE.CanvasTexture(renderArtworkCanvas(image, artwork, aspect))
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
      texture.anisotropy = 16
      texture.needsUpdate = true
      generated = texture
      setBase({ key: textureKey, texture })
    }
    image.src = artwork.url
    return () => { active = false; generated?.dispose() }
  }, [artwork, aspect, textureKey])
  return artwork.url && base?.key === textureKey ? base.texture : null
}

function useArtworkTexture(aspect = 1) {
  const artwork = useStudio(s => s.snapshot.artwork)
  return useConfiguredTexture(artwork, aspect)
}

function useFaceTexture(face: BoxFace, aspect: number) {
  const artwork = useStudio(s => s.snapshot.artwork.faces[face])
  return useConfiguredTexture(artwork, aspect)
}

function seededNoise(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createSurfaceMaps(material: MaterialConfig): SurfaceMaps {
  const size = 128
  const normal = document.createElement('canvas'); normal.width = size; normal.height = size
  const rough = document.createElement('canvas'); rough.width = size; rough.height = size
  const normalCtx = normal.getContext('2d')!; const roughCtx = rough.getContext('2d')!
  const normalData = normalCtx.createImageData(size, size); const roughData = roughCtx.createImageData(size, size)
  const seed = material.preset.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const paper = material.preset.includes('纸')
  const metal = material.preset.includes('铝')
  for (let i = 0; i < size * size; i += 1) {
    const fine = seededNoise(i, seed) - .5
    const fibre = paper ? Math.sin((i % size) * .48 + seededNoise(Math.floor(i / size), seed) * 5) * .16 : 0
    const brushed = metal ? Math.sin((i % size) * 1.7) * .07 : 0
    const nx = 128 + (fine + fibre) * 34; const ny = 128 + (fine * .7 + brushed) * 28
    normalData.data[i * 4] = nx; normalData.data[i * 4 + 1] = ny; normalData.data[i * 4 + 2] = 248; normalData.data[i * 4 + 3] = 255
    const variation = fine * (paper ? 34 : metal ? 18 : 24)
    const value = THREE.MathUtils.clamp(material.roughness * 255 + variation, 12, 245)
    roughData.data[i * 4] = value; roughData.data[i * 4 + 1] = value; roughData.data[i * 4 + 2] = value; roughData.data[i * 4 + 3] = 255
  }
  normalCtx.putImageData(normalData, 0, 0); roughCtx.putImageData(roughData, 0, 0)
  const normalMap = new THREE.CanvasTexture(normal); const roughnessMap = new THREE.CanvasTexture(rough)
  for (const texture of [normalMap, roughnessMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(material.textureScale, material.textureScale)
    texture.anisotropy = 8
    texture.needsUpdate = true
  }
  normalMap.colorSpace = THREE.NoColorSpace; roughnessMap.colorSpace = THREE.NoColorSpace
  return { normalMap, roughnessMap }
}

function useSurfaceMaps(material: MaterialConfig) {
  const maps = useMemo(() => createSurfaceMaps(material), [material])
  useEffect(() => () => { maps.normalMap.dispose(); maps.roughnessMap.dispose() }, [maps])
  return maps
}

function materialProps(material: MaterialConfig, map: THREE.Texture | null, maps: SurfaceMaps, printed = false) {
  return {
    color: map ? '#ffffff' : material.color,
    roughness: printed ? Math.max(.18, material.roughness) : material.roughness,
    roughnessMap: maps.roughnessMap,
    metalness: printed ? Math.min(.35, material.metalness) : material.metalness,
    transparent: printed || material.opacity < 1 || material.transmission > 0,
    alphaTest: printed ? .001 : 0,
    opacity: printed ? material.opacity * material.textureStrength : material.opacity,
    transmission: printed ? 0 : material.transmission,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(material.normalScale, material.normalScale),
    ior: material.ior,
    thickness: material.thickness,
    map: map ?? undefined,
    envMapIntensity: 1.25,
  }
}

function roundedPlaneGeometry(width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2 - .001, height / 2 - .001)); const x = -width / 2; const y = -height / 2
  const shape = new THREE.Shape()
  shape.moveTo(x + r, y); shape.lineTo(x + width - r, y); shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r); shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y)
  const geometry = new THREE.ShapeGeometry(shape, 16); const pos = geometry.attributes.position; const uv = geometry.attributes.uv
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, (pos.getX(i) + width / 2) / width, (pos.getY(i) + height / 2) / height)
  uv.needsUpdate = true
  return geometry
}

function ArtworkFaceSurface({ texture, material, maps, width, height, radius, position, rotation }: {
  texture: THREE.Texture | null; material: MaterialConfig; maps: SurfaceMaps; width: number; height: number; radius: number
  position: [number, number, number]; rotation: [number, number, number]
}) {
  const geometry = useMemo(() => roundedPlaneGeometry(width, height, radius), [width, height, radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!texture) return null
  return <mesh position={position} rotation={rotation} geometry={geometry} castShadow receiveShadow>
    <meshPhysicalMaterial key={texture.uuid} {...materialProps(material, texture, maps, true)} side={THREE.FrontSide} polygonOffset polygonOffsetFactor={-2} />
  </mesh>
}

function BoxModel({ config }: { config: Extract<PackagingModelConfig, { type: 'box' }> }) {
  const material = useStudio(s => s.snapshot.material); const template = useStudio(s => s.snapshot.template); const maps = useSurfaceMaps(material)
  const [w, h, d] = [config.width / 48, config.height / 48, config.depth / 48]
  const topFace: BoxFace = template === 'carton' ? 'topFront' : 'top'; const bottomFace: BoxFace = template === 'carton' ? 'bottomFront' : 'bottom'
  const front = useFaceTexture('front', w / h); const back = useFaceTexture('back', w / h); const left = useFaceTexture('left', d / h); const right = useFaceTexture('right', d / h); const top = useFaceTexture(topFace, w / d); const bottom = useFaceTexture(bottomFace, w / d)
  const faceRadius = Math.min(config.radius / 48, .18); const offset = Math.max(.0025, config.thickness / 480)
  return <group position={[0, h / 2, 0]} name="packaging-model">
    <RoundedBox args={[w, h, d]} radius={Math.max(.012, faceRadius)} smoothness={8} castShadow receiveShadow>
      <meshPhysicalMaterial {...materialProps(material, null, maps)} />
    </RoundedBox>
    <ArtworkFaceSurface texture={front} material={material} maps={maps} width={w - offset * 2} height={h - offset * 2} radius={faceRadius} position={[0, 0, d / 2 + offset]} rotation={[0, 0, 0]} />
    <ArtworkFaceSurface texture={back} material={material} maps={maps} width={w - offset * 2} height={h - offset * 2} radius={faceRadius} position={[0, 0, -d / 2 - offset]} rotation={[0, Math.PI, 0]} />
    <ArtworkFaceSurface texture={right} material={material} maps={maps} width={d - offset * 2} height={h - offset * 2} radius={faceRadius} position={[w / 2 + offset, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
    <ArtworkFaceSurface texture={left} material={material} maps={maps} width={d - offset * 2} height={h - offset * 2} radius={faceRadius} position={[-w / 2 - offset, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
    <ArtworkFaceSurface texture={top} material={material} maps={maps} width={w - offset * 2} height={d - offset * 2} radius={faceRadius} position={[0, h / 2 + offset, 0]} rotation={[-Math.PI / 2, 0, 0]} />
    <ArtworkFaceSurface texture={bottom} material={material} maps={maps} width={w - offset * 2} height={d - offset * 2} radius={faceRadius} position={[0, -h / 2 - offset, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <mesh position={[-w / 2 + .025, 0, -d / 2 - .003]} castShadow><boxGeometry args={[.025, h * .94, .012]} /><meshStandardMaterial color="#6f675b" roughness={.95} /></mesh>
  </group>
}

function labelArc(mapping: 'smart' | 'front' | 'wrap' | 'dieline') {
  return mapping === 'wrap' ? Math.PI * 2 : Math.PI * .5
}

function BottleModel({ config }: { config: Extract<PackagingModelConfig, { type: 'bottle' }> }) {
  const material = useStudio(s => s.snapshot.material); const artwork = useStudio(s => s.snapshot.artwork); const maps = useSurfaceMaps(material)
  const h = config.height / 55; const r = config.diameter / 100; const neck = config.neck / 100; const shoulder = config.shoulder / 70
  const points = useMemo(() => [
    new THREE.Vector2(0, .02), new THREE.Vector2(r * .82, .02), new THREE.Vector2(r * .96, .08), new THREE.Vector2(r, .17),
    new THREE.Vector2(r, Math.max(.55, h - shoulder)), new THREE.Vector2(r * .94, h - shoulder * .7), new THREE.Vector2(neck * 1.45, h - .24),
    new THREE.Vector2(neck, h - .1), new THREE.Vector2(neck, h), new THREE.Vector2(0, h),
  ], [h, r, neck, shoulder])
  const labelH = h * .48; const arc = labelArc(artwork.mapping); const texture = useArtworkTexture(r * arc / labelH)
  return <group name="packaging-model">
    <mesh castShadow receiveShadow><latheGeometry args={[points, 96]} /><meshPhysicalMaterial {...materialProps(material, null, maps)} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, h * .47, 0]} rotation={[0, .48, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r * 1.012, r * 1.012, labelH, 128, 1, true, -arc / 2, arc]} />
      <meshPhysicalMaterial key={texture?.uuid ?? 'empty'} {...materialProps(material, texture, maps, true)} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, h - .035, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[neck * 1.04, .035, 12, 64]} /><meshStandardMaterial color="#dfe2e4" roughness={.3} metalness={.2} /></mesh>
    <mesh position={[0, h + config.cap / 110, 0]} castShadow>
      <cylinderGeometry args={[neck * 1.12, neck * 1.12, config.cap / 55, 64]} />
      <meshPhysicalMaterial color="#d7d9dc" roughness={.28} metalness={.18} clearcoat={.55} clearcoatRoughness={.16} />
    </mesh>
    {[.1, .22, .34, .46, .58, .7, .82].map(value => <mesh key={value} position={[0, h + config.cap / 55 * value, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[neck * 1.125, .008, 5, 64]} /><meshStandardMaterial color="#bfc3c7" roughness={.4} /></mesh>)}
    <mesh position={[0, .055, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r * .83, .025, 8, 72]} /><meshStandardMaterial color={material.color} roughness={material.roughness} /></mesh>
  </group>
}

function CanModel({ config }: { config: Extract<PackagingModelConfig, { type: 'can' }> }) {
  const material = useStudio(s => s.snapshot.material); const artwork = useStudio(s => s.snapshot.artwork); const maps = useSurfaceMaps(material)
  const h = config.height / 52; const r = config.diameter / 100; const lid = Math.max(.04, config.lid / 120); const arc = labelArc(artwork.mapping)
  const texture = useArtworkTexture(r * arc / (h * .82))
  return <group position={[0, h / 2, 0]} name="packaging-model">
    <mesh castShadow receiveShadow><cylinderGeometry args={[r, r, h, 128, 2]} /><meshPhysicalMaterial {...materialProps({ ...material, metalness: Math.max(.72, material.metalness), roughness: Math.min(.38, material.roughness) }, null, maps)} /></mesh>
    <mesh rotation={[0, .48, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r * 1.006, r * 1.006, h * .82, 160, 1, true, -arc / 2, arc]} />
      <meshPhysicalMaterial key={texture?.uuid ?? 'empty'} {...materialProps(material, texture, maps, true)} side={THREE.DoubleSide} />
    </mesh>
    {[-1, 1].map(side => <group key={side} position={[0, side * h / 2, 0]}>
      <mesh position={[0, side * lid * .35, 0]} castShadow><cylinderGeometry args={[r * .94, r * .96, lid, 96]} /><meshPhysicalMaterial color="#bcc2c5" metalness={.94} roughness={.21} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r * .91, .045, 10, 96]} /><meshStandardMaterial color="#d4d8da" metalness={.95} roughness={.18} /></mesh>
    </group>)}
    <mesh position={[0, h / 2 + lid * .72, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[r * .57, .016, 6, 72]} /><meshStandardMaterial color="#9ca3a6" metalness={.95} roughness={.22} /></mesh>
    <RoundedBox args={[r * .52, .055, r * .18]} radius={.04} smoothness={4} position={[0, h / 2 + lid * .8, .08]} rotation={[0, .18, 0]} castShadow><meshStandardMaterial color="#aeb4b7" metalness={.94} roughness={.2} /></RoundedBox>
  </group>
}

function createPouchPanelGeometry(width: number, height: number, depth: number, gusset: number, front: boolean) {
  const segX = 28; const segY = 34; const positions: number[] = []; const uvs: number[] = []; const indices: number[] = []
  const sign = front ? 1 : -1
  for (let y = 0; y <= segY; y += 1) {
    const v = y / segY
    for (let x = 0; x <= segX; x += 1) {
      const u = x / segX
      const edge = Math.sin(Math.PI * u)
      const bodyBulge = .34 + Math.sin(Math.PI * v) * .66
      const bottomBulge = Math.pow(1 - v, 3) * gusset * .75
      const taper = 1 - v * .055
      positions.push((u - .5) * width * taper, (v - .5) * height, sign * (depth * bodyBulge * (.72 + edge * .28) / 2 + bottomBulge))
      uvs.push(u, v)
    }
  }
  for (let y = 0; y < segY; y += 1) for (let x = 0; x < segX; x += 1) {
    const a = y * (segX + 1) + x; const b = a + 1; const c = a + segX + 1; const d = c + 1
    if (front) indices.push(a, b, d, a, d, c); else indices.push(a, d, b, a, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals()
  return geometry
}

function PouchPanel({ front, width, height, depth, gusset, texture, material, maps }: { front: boolean; width: number; height: number; depth: number; gusset: number; texture: THREE.Texture | null; material: MaterialConfig; maps: SurfaceMaps }) {
  const geometry = useMemo(() => createPouchPanelGeometry(width, height, depth, gusset, front), [width, height, depth, gusset, front])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} castShadow receiveShadow><meshPhysicalMaterial key={`${front}-${texture?.uuid ?? 'empty'}`} {...materialProps(material, front ? texture : null, maps, Boolean(front && texture))} side={THREE.DoubleSide} /></mesh>
}

function PouchModel({ config }: { config: Extract<PackagingModelConfig, { type: 'pouch' }> }) {
  const material = useStudio(s => s.snapshot.material); const maps = useSurfaceMaps(material)
  const [w, h, d] = [config.width / 50, config.height / 50, config.depth / 50]; const gusset = config.gusset / 100
  const texture = useArtworkTexture(w / h)
  return <group position={[0, h / 2, 0]} name="packaging-model">
    <PouchPanel front width={w} height={h} depth={d} gusset={gusset} texture={texture} material={material} maps={maps} />
    <PouchPanel front={false} width={w} height={h} depth={d} gusset={gusset} texture={null} material={material} maps={maps} />
    {[-1, 1].map(side => <mesh key={side} position={[side * w * .485, 0, 0]} castShadow><boxGeometry args={[.055, h * .96, d * .72]} /><meshPhysicalMaterial {...materialProps(material, null, maps)} /></mesh>)}
    <mesh position={[0, h / 2 - config.seal / 100, 0]} castShadow><boxGeometry args={[w * .96, config.seal / 50, d * .68]} /><meshPhysicalMaterial {...materialProps(material, null, maps)} /></mesh>
    <mesh position={[0, -h / 2 + .04, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[d * .31, d * .31, w * .82, 48]} /><meshPhysicalMaterial {...materialProps(material, null, maps)} /></mesh>
  </group>
}

function CustomModel({ config }: { config: Extract<PackagingModelConfig, { type: 'custom' }> }) {
  const [root, setRoot] = useState<THREE.Group | null>(null)
  useEffect(() => {
    let active = true
    loadModelAssetObject(config.assetId).then(source => { if (active) setRoot(cloneModelObject(source)) }).catch(() => { if (active) setRoot(null) })
    return () => { active = false; setRoot(null) }
  }, [config.assetId, config.revision])
  if (!root) return <group name="packaging-model"><mesh position={[0, .9, 0]}><boxGeometry args={[1.3, 1.8, 1]} /><meshStandardMaterial color="#676d77" wireframe /></mesh></group>
  root.name = 'packaging-model'
  return <primitive object={root} />
}

function ProductModel({ config }: { config: PackagingModelConfig }) {
  return config.type === 'box' ? <BoxModel config={config} /> : config.type === 'bottle' ? <BottleModel config={config} /> : config.type === 'can' ? <CanModel config={config} /> : config.type === 'pouch' ? <PouchModel config={config} /> : <CustomModel config={config} />
}

function SceneAssetModel({ config, id }: { config: CustomModelConfig; id: string }) {
  const [root, setRoot] = useState<THREE.Group | null>(null)
  useEffect(() => {
    let active = true
    loadModelAssetObject(config.assetId).then(source => { if (active) setRoot(cloneModelObject(source)) }).catch(() => { if (active) setRoot(null) })
    return () => { active = false; setRoot(null) }
  }, [config.assetId, config.revision])
  if (!root) return <group><mesh><boxGeometry args={[.35, .35, .35]} /><meshStandardMaterial color="#7d838c" wireframe /></mesh></group>
  root.name = `scene-model:${id}`
  return <primitive object={root} />
}

function EditableSceneObject({ id, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, children }: { id: string; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number; children: ReactNode }) {
  const sceneConfig = useStudio(s => s.snapshot.scene)
  const override = sceneConfig.objectOverrides[id] ?? DEFAULT_SCENE_OBJECT_TRANSFORM
  const customAsset = sceneConfig.objectAssets[sceneObjectAssetKey(sceneConfig.templateId, id)]
  const selected = useStudio(s => s.selectedSceneObjectId === id)
  const select = useStudio(s => s.selectSceneObject)
  if (!override.visible) return null
  const finalPosition: [number, number, number] = [position[0] + override.position[0], position[1] + override.position[1], position[2] + override.position[2]]
  const finalRotation: [number, number, number] = [rotation[0] + override.rotation[0], rotation[1] + override.rotation[1], rotation[2] + override.rotation[2]]
  return <group
    name={`scene-object:${id}`}
    position={finalPosition}
    rotation={finalRotation}
    scale={scale * override.scale}
    userData={{ sceneObjectId: id }}
    onClick={event => { event.stopPropagation(); select(id) }}
    onPointerOver={event => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}
  >
    {customAsset ? <SceneAssetModel config={customAsset} id={id} /> : children}
    {selected && <pointLight name="preview-only" color="#ff7a22" intensity={.22} distance={2.6} decay={2} />}
  </group>
}

function Product() {
  const model = useStudio(s => s.snapshot.model); const packagingTemplate = useStudio(s => s.snapshot.template); const scene = useStudio(s => s.snapshot.scene)
  const template = getSceneTemplate(scene.templateId || scene.preset)
  const config = model.type === 'box' && packagingTemplate === 'mailer' ? { ...model, height: model.depth, depth: model.height } : model
  return <group name="product-root" position={scene.productPosition} rotation={scene.productRotation} scale={scene.productScale}>
    {template.products.map((instance, index) => <EditableSceneObject key={`${template.id}-${index}`} id={`product-${index}`} position={instance.position} rotation={instance.rotation} scale={instance.scale}><ProductModel config={config} /></EditableSceneObject>)}
  </group>
}

function SceneDecor() {
  const scene = useStudio(s => s.snapshot.scene); const template = getSceneTemplate(scene.templateId || scene.preset)
  if (!scene.decor && !scene.pedestal) return null
  const matte = (color: string, roughness = .65) => <meshPhysicalMaterial color={color} roughness={roughness} clearcoat={.08} />
  if (template.id === 'soft-gradient') return <group name="scene-decor">
    {scene.decor && <><EditableSceneObject id="decor-ring" position={[-2.25, 1.15, -1.35]} rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><torusGeometry args={[.8, .18, 32, 96]} />{matte('#ded8cc', .72)}</mesh></EditableSceneObject><EditableSceneObject id="decor-sphere" position={[2.15, .36, -.75]}><mesh castShadow><sphereGeometry args={[.34, 48, 48]} />{matte('#9d988f', .48)}</mesh></EditableSceneObject></>}
  </group>
  if (template.id === 'warm-beauty') return <group name="scene-decor">
    {scene.pedestal && <EditableSceneObject id="pedestal" position={[0, .22, 0]}><mesh receiveShadow castShadow><cylinderGeometry args={[1.45, 1.55, .44, 96]} />{matte('#d8a083', .58)}</mesh></EditableSceneObject>}
    {scene.decor && <><EditableSceneObject id="decor-arch" position={[-1.65, 1.65, -2.25]}><RoundedBox args={[3.15, 3.3, .34]} radius={1.35} smoothness={8} castShadow>{matte('#b96855', .78)}</RoundedBox></EditableSceneObject><EditableSceneObject id="decor-sphere" position={[2.05, .4, -.65]}><mesh castShadow><sphereGeometry args={[.36, 48, 48]} />{matte('#f1c4a7', .36)}</mesh></EditableSceneObject></>}
  </group>
  if (template.id === 'blue-geometric') {
    const spheres = [[-2.35, .48, .2, .29], [2.25, .52, -.25, .36], [.2, 2.65, -1.25, .3], [1.75, 1.45, -1.2, .2]] as const
    return <group name="scene-decor">{scene.decor && <>
      <EditableSceneObject id="decor-platform-main" position={[-1.45, .24, -1.15]} rotation={[0, -.32, -.05]}><RoundedBox args={[5.4, .28, 2.05]} radius={.08} smoothness={5} castShadow receiveShadow>{matte('#0b5ea7', .42)}</RoundedBox></EditableSceneObject>
      <EditableSceneObject id="decor-platform-back" position={[1.45, .58, -1.85]} rotation={[0, .22, .12]}><RoundedBox args={[4.4, .18, 1.15]} radius={.06} smoothness={4} castShadow>{matte('#113e70', .38)}</RoundedBox></EditableSceneObject>
      <EditableSceneObject id="decor-accent" position={[.1, 1.02, -.45]} rotation={[0, -.25, -.18]}><RoundedBox args={[3.6, .08, .12]} radius={.03} smoothness={3} castShadow>{matte('#ff7a22', .3)}</RoundedBox></EditableSceneObject>
      {spheres.map(([x, y, z, r], index) => <EditableSceneObject key={index} id={`decor-sphere-${index + 1}`} position={[x, y, z]}><mesh castShadow><sphereGeometry args={[r, 48, 48]} /><meshPhysicalMaterial color="#9cd5ee" metalness={.55} roughness={.14} clearcoat={1} /></mesh></EditableSceneObject>)}
    </>}</group>
  }
  if (template.id === 'dark-luxury') return <group name="scene-decor">
    {scene.pedestal && <EditableSceneObject id="pedestal" position={[0, .3, 0]}><RoundedBox args={[2.75, .6, 2.35]} radius={.1} smoothness={5} castShadow receiveShadow>{matte('#17191d', .28)}</RoundedBox></EditableSceneObject>}
    {scene.decor && <><EditableSceneObject id="decor-block" position={[-2.05, .85, -.8]} rotation={[0, .28, 0]}><RoundedBox args={[1.35, 1.7, 1.2]} radius={.08} smoothness={5} castShadow>{matte('#272329', .38)}</RoundedBox></EditableSceneObject><EditableSceneObject id="decor-ring" position={[1.95, 1.5, -1.55]} rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><torusGeometry args={[.68, .045, 24, 96]} /><meshPhysicalMaterial color="#c89545" metalness={.88} roughness={.2} /></mesh></EditableSceneObject></>}
  </group>
  if (template.id === 'cool-warm') return <group name="scene-decor">
    {scene.pedestal && <EditableSceneObject id="pedestal" position={[.3, .22, 0]}><mesh receiveShadow castShadow><cylinderGeometry args={[1.38, 1.48, .44, 80]} />{matte('#d57c62', .52)}</mesh></EditableSceneObject>}
    {scene.decor && <><EditableSceneObject id="decor-platform" position={[-1.65, .28, -1.35]} rotation={[0, -.3, .08]}><RoundedBox args={[3.4, .22, 1.4]} radius={.07} smoothness={4} castShadow>{matte('#2a8291', .48)}</RoundedBox></EditableSceneObject><EditableSceneObject id="decor-panel" position={[2.15, 1.4, -2.1]} rotation={[0, -.2, 0]}><RoundedBox args={[2.2, 2.8, .26]} radius={.2} smoothness={5} castShadow>{matte('#c8614e', .62)}</RoundedBox></EditableSceneObject></>}
  </group>
  if (template.id === 'floating-launch') {
    const spheres = [[-2.15, 2.35, -.8, .3], [2.15, .48, -.2, .24], [1.9, 2.7, -1.2, .18]] as const
    return <group name="scene-decor">{scene.decor && <><EditableSceneObject id="decor-ring" position={[0, 1.35, -1.5]} rotation={[Math.PI / 2, 0, .2]}><mesh castShadow><torusGeometry args={[1.4, .1, 32, 120]} /><meshPhysicalMaterial color="#f0d955" metalness={.15} roughness={.3} /></mesh></EditableSceneObject>{spheres.map(([x, y, z, r], index) => <EditableSceneObject key={index} id={`decor-sphere-${index + 1}`} position={[x, y, z]}><mesh castShadow><sphereGeometry args={[r, 40, 40]} />{matte(index === 1 ? '#ff936d' : '#b7f1d2', .28)}</mesh></EditableSceneObject>)}</>}</group>
  }
  if (template.id === 'water-clear') {
    const bubbles = [[-1.65, .45, -.4, .28], [1.45, .75, -.7, .22], [1.95, 1.75, -1.5, .16], [-1.3, 2.25, -1.7, .14]] as const
    return <group name="scene-decor">
      {scene.pedestal && <EditableSceneObject id="pedestal" position={[0, .18, 0]}><mesh receiveShadow castShadow><cylinderGeometry args={[1.35, 1.5, .36, 96]} /><meshPhysicalMaterial color="#bfeaf0" roughness={.08} transmission={.35} thickness={.4} clearcoat={1} /></mesh></EditableSceneObject>}
      {scene.decor && <>{bubbles.map(([x, y, z, r], index) => <EditableSceneObject key={index} id={`decor-bubble-${index + 1}`} position={[x, y, z]}><mesh castShadow><sphereGeometry args={[r, 48, 48]} /><meshPhysicalMaterial color="#d8f8fb" roughness={.04} transmission={.72} thickness={.32} clearcoat={1} /></mesh></EditableSceneObject>)}</>}
    </group>
  }
  if (template.id === 'botanical-natural') {
    const leaves = [[-1.7, 1.45, -1.35, -.65], [1.75, 1.2, -1.45, .55], [2.05, .65, -.55, .95]] as const
    return <group name="scene-decor">
      {scene.pedestal && <EditableSceneObject id="pedestal" position={[0, .12, 0]}><mesh receiveShadow castShadow><cylinderGeometry args={[1.5, 1.65, .24, 72]} />{matte('#b9b3a4', .9)}</mesh></EditableSceneObject>}
      {scene.decor && <><EditableSceneObject id="decor-rock" position={[-1.8, .28, -.4]}><mesh scale={[1.5, .42, .95]} castShadow><sphereGeometry args={[.55, 48, 48]} />{matte('#827f72', .94)}</mesh></EditableSceneObject>{leaves.map(([x, y, z, rz], index) => <EditableSceneObject key={index} id={`decor-leaf-${index + 1}`} position={[x, y, z]} rotation={[0, 0, rz]}><mesh scale={[.28, .78, .08]} castShadow><sphereGeometry args={[.55, 36, 36]} />{matte(index === 1 ? '#667b56' : '#526a47', .8)}</mesh></EditableSceneObject>)}</>}
    </group>
  }
  return null
}

function createCycloramaGeometry() {
  const width = 26; const segmentsX = 2; const path: { y: number; z: number }[] = [{ y: 0, z: 9 }, { y: 0, z: -2.8 }]
  const radius = 1.4
  for (let i = 1; i <= 12; i += 1) { const a = i / 12 * Math.PI / 2; path.push({ y: radius * (1 - Math.cos(a)), z: -2.8 - radius * Math.sin(a) }) }
  path.push({ y: 11, z: -4.2 })
  const positions: number[] = []; const uvs: number[] = []; const indices: number[] = []
  for (let p = 0; p < path.length; p += 1) for (let x = 0; x <= segmentsX; x += 1) {
    positions.push((x / segmentsX - .5) * width, path[p].y, path[p].z); uvs.push(x / segmentsX, p / (path.length - 1))
  }
  for (let p = 0; p < path.length - 1; p += 1) for (let x = 0; x < segmentsX; x += 1) {
    const a = p * (segmentsX + 1) + x; const b = a + 1; const c = a + segmentsX + 1; const d = c + 1; indices.push(a, b, d, a, d, c)
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry
}

function Cyclorama() {
  const sceneConfig = useStudio(s => s.snapshot.scene); const geometry = useMemo(() => createCycloramaGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!sceneConfig.floor || !sceneConfig.cyclorama) return null
  return <mesh geometry={geometry} receiveShadow><meshPhysicalMaterial color={sceneConfig.templateId === 'dark-luxury' ? '#0c0d11' : sceneConfig.background} roughness={sceneConfig.floorRoughness} metalness={0} /></mesh>
}

function StudioEnvironment() {
  const scene = useThree(state => state.scene); const lighting = useStudio(s => s.snapshot.lighting)
  useEffect(() => {
    if (lighting.environment === 'none') { scene.environment = null; return }
    let active = true; let texture: THREE.DataTexture | null = null
    new RGBELoader().load('/environments/studio_small_09_1k.hdr', loaded => {
      if (!active) { loaded.dispose(); return }
      texture = loaded; loaded.mapping = THREE.EquirectangularReflectionMapping; scene.environment = loaded
    }, undefined, () => { if (active) scene.environment = null })
    return () => { active = false; if (scene.environment === texture) scene.environment = null; texture?.dispose() }
  }, [scene, lighting.environment])
  useEffect(() => {
    scene.environmentIntensity = lighting.environmentIntensity * .72
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad(lighting.environmentRotation), 0)
  }, [scene, lighting.environmentIntensity, lighting.environmentRotation])
  return null
}

function kelvinColor(kelvin: number) {
  const temperature = kelvin / 100; let red: number; let green: number; const blue: number = temperature >= 66 ? 255 : temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307
  if (temperature <= 66) { red = 255; green = 99.4708025861 * Math.log(temperature) - 161.1195681661 } else { red = 329.698727446 * Math.pow(temperature - 60, -.1332047592); green = 288.1221695283 * Math.pow(temperature - 60, -.0755148492) }
  return new THREE.Color(THREE.MathUtils.clamp(red, 0, 255) / 255, THREE.MathUtils.clamp(green, 0, 255) / 255, THREE.MathUtils.clamp(blue, 0, 255) / 255)
}

function AreaLight({ position, target, intensity, width, height, color }: { position: [number, number, number]; target: [number, number, number]; intensity: number; width: number; height: number; color: THREE.ColorRepresentation }) {
  const ref = useRef<THREE.RectAreaLight>(null)
  useEffect(() => { ref.current?.lookAt(...target); ref.current?.updateMatrixWorld() }, [target])
  return <rectAreaLight ref={ref} position={position} intensity={intensity} width={width} height={height} color={color} />
}

function modelHeight(model: PackagingModelConfig, template?: string) {
  return model.type === 'box' ? (template === 'mailer' ? model.depth : model.height) / 48 : model.type === 'bottle' ? model.height / 55 + model.cap / 55 : model.type === 'can' ? model.height / 52 : model.type === 'pouch' ? model.height / 50 : model.bounds[1] / 50
}

function modelFrameSize(model: PackagingModelConfig, template?: string) {
  if (model.type === 'box') {
    const width = model.width / 48; const height = (template === 'mailer' ? model.depth : model.height) / 48; const depth = (template === 'mailer' ? model.height : model.depth) / 48
    return Math.max(height, width * .82, depth * .72)
  }
  if (model.type === 'bottle') return Math.max(modelHeight(model), model.diameter / 100 * 1.35)
  if (model.type === 'can') return Math.max(modelHeight(model), model.diameter / 100 * 1.35)
  if (model.type === 'pouch') return Math.max(modelHeight(model), model.width / 50 * .82)
  return Math.max(model.bounds[1] / 50, model.bounds[0] / 50 * .82, model.bounds[2] / 50 * .72)
}

function composeCamera(model: PackagingModelConfig, config: CameraConfig, productPosition: [number, number, number], packagingTemplate: string, sceneTemplateId: string) {
  const sceneTemplate = getSceneTemplate(sceneTemplateId)
  const height = modelHeight(model, packagingTemplate)
  const frameSize = modelFrameSize(model, packagingTemplate) * sceneTemplate.frameScale
  const target = new THREE.Vector3(productPosition[0] + sceneTemplate.targetOffset[0], productPosition[1] + height * .46 + sceneTemplate.targetOffset[1], productPosition[2] + sceneTemplate.targetOffset[2])
  const direction = new THREE.Vector3(...config.position).sub(new THREE.Vector3(...config.target)).normalize()
  const fov = THREE.MathUtils.degToRad(config.fov)
  const distance = Math.max(2.5, frameSize / (2 * Math.tan(fov / 2) * .62))
  return { target, position: target.clone().addScaledVector(direction, distance) }
}

function SceneContent() {
  const snapshot = useStudio(s => s.snapshot); const controls = useRef<OrbitControlsImpl>(null)
  const { camera, gl, scene } = useThree()
  const modelKey = JSON.stringify(snapshot.model); const cameraKey = JSON.stringify(snapshot.camera); const productPositionKey = snapshot.scene.productPosition.join(','); const compositionKey = `${modelKey}|${snapshot.template}|${productPositionKey}|${snapshot.scene.templateId}`
  const composition = useMemo(() => composeCamera(JSON.parse(modelKey) as PackagingModelConfig, JSON.parse(cameraKey) as CameraConfig, productPositionKey.split(',').map(Number) as [number, number, number], snapshot.template, snapshot.scene.templateId), [modelKey, cameraKey, productPositionKey, snapshot.template, snapshot.scene.templateId])
  useEffect(() => {
    const cameraConfig = JSON.parse(cameraKey) as CameraConfig
    camera.position.copy(composition.position)
    camera.lookAt(composition.target)
    if (camera instanceof THREE.PerspectiveCamera) { camera.fov = cameraConfig.fov; camera.updateProjectionMatrix() }
    controls.current?.target.copy(composition.target); controls.current?.update()
  }, [cameraKey, compositionKey, composition, camera])
  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = snapshot.lighting.exposure; gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.VSMShadowMap
  }, [gl, snapshot.lighting.exposure])
  useEffect(() => {
    window.__packshotExport = async request => {
      request.onProgress?.({ stage: 'preparing', progress: 4, message: '加载本地写实渲染引擎' })
      const { renderPackshot } = await import('./renderExport')
      return renderPackshot(scene, camera, request, snapshot.camera, snapshot.lighting.exposure)
    }
    return () => { delete window.__packshotExport }
  }, [camera, scene, snapshot.camera, snapshot.lighting.exposure])
  useEffect(() => {
    window.__packshotExportProductGlb = async () => {
      const source = scene.getObjectByName('packaging-model')
      if (!source) throw new Error('当前产品模型尚未准备完成')
      const clone = source.clone(true)
      clone.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry = object.geometry.clone()
        object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone()
      })
      return serializeModel(clone)
    }
    return () => { delete window.__packshotExportProductGlb }
  }, [scene, snapshot.model, snapshot.artwork, snapshot.material])
  useEffect(() => {
    window.__packshotExportSceneObjectGlb = async id => {
      const source = scene.getObjectByName(`scene-object:${id}`)
      if (!source) throw new Error('该模板对象当前未显示，请先开启对象显示后重试')
      const root = new THREE.Group(); root.name = id
      source.children.filter(child => child.name !== 'preview-only').forEach(child => {
        const clone = child.clone(true); const remove: THREE.Object3D[] = []
        clone.traverse(object => {
          if (object.name === 'preview-only' || object instanceof THREE.Light) { remove.push(object); return }
          if (!(object instanceof THREE.Mesh)) return
          object.geometry = object.geometry.clone()
          object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone()
        })
        remove.forEach(object => object.removeFromParent()); root.add(clone)
      })
      if (!root.children.length) throw new Error('该模板对象没有可编辑网格')
      return serializeModel(root)
    }
    return () => { delete window.__packshotExportSceneObjectGlb }
  }, [scene, snapshot.scene.templateId, snapshot.scene.objectAssets])
  useEffect(() => {
    scene.background = snapshot.scene.transparent ? null : new THREE.Color(snapshot.scene.background)
    scene.backgroundIntensity = .82
  }, [scene, snapshot.scene.background, snapshot.scene.transparent])
  const keyColor = useMemo(() => kelvinColor(snapshot.lighting.temperature), [snapshot.lighting.temperature])
  const fillColor = useMemo(() => kelvinColor(Math.min(7800, snapshot.lighting.temperature + 1100)), [snapshot.lighting.temperature])
  return <>
    {snapshot.camera.projection === 'perspective' ? <PerspectiveCamera makeDefault position={composition.position.toArray()} fov={snapshot.camera.fov} /> : <OrthographicCamera makeDefault position={composition.position.toArray()} zoom={110} />}
    <StudioEnvironment />
    <ambientLight intensity={snapshot.lighting.ambient} />
    <directionalLight castShadow color={keyColor} intensity={snapshot.lighting.key * .16} position={snapshot.lighting.keyPosition} shadow-mapSize={[4096, 4096]} shadow-radius={snapshot.lighting.shadowSoftness} shadow-bias={-.00015} />
    <AreaLight position={snapshot.lighting.keyPosition} target={[0, 1.3, 0]} intensity={snapshot.lighting.key * 1.25} width={snapshot.lighting.keySize} height={snapshot.lighting.keySize * .72} color={keyColor} />
    <AreaLight position={[-4.5, 3.4, 2.5]} target={[0, 1.2, 0]} intensity={snapshot.lighting.fill * .9} width={snapshot.lighting.fillSize} height={snapshot.lighting.fillSize} color={fillColor} />
    <pointLight intensity={snapshot.lighting.point * 1.8} position={[1.8, 4.4, -3.2]} color="#ffd0ad" distance={12} decay={2} />
    <Product />
    <Cyclorama />
    {snapshot.scene.floor && !snapshot.scene.cyclorama && <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -.02, 0]}><planeGeometry args={[30, 30]} /><meshPhysicalMaterial color={snapshot.scene.background} roughness={snapshot.scene.floorRoughness} /></mesh>}
    {snapshot.scene.floor && <group name="preview-only"><ContactShadows position={[0, .008, 0]} opacity={snapshot.scene.templateId === 'dark-luxury' ? .5 : .3} blur={4.2} scale={12} far={7} resolution={1024} /></group>}
    <SceneDecor />
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} minDistance={2.3} maxDistance={14} />
  </>
}

export default function StudioScene() {
  return <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' }} camera={{ position: [4.8, 3.2, 5.8], fov: 34 }}>
    <SceneContent />
  </Canvas>
}
