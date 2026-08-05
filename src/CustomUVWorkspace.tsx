import { useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Layers3, PackageOpen, RotateCcw, Save, Sparkles, Triangle } from 'lucide-react'
import * as THREE from 'three'
import { cloneModelObject, getModelAsset, invalidateModelAsset, loadModelAssetObject, putModelAsset, serializeModel } from './modelAssets'
import { useStudio } from './store'
import type { CustomMaterialSlot, CustomModelConfig, UVLayoutConfig } from './types'

function meshesOf(root: THREE.Group | null) {
  const result: THREE.Mesh[] = []; root?.traverse(object => { if (object instanceof THREE.Mesh) result.push(object) }); return result
}

function polygonsOf(mesh: THREE.Mesh | null) {
  if (!mesh) return [] as string[]; const uv = mesh.geometry.getAttribute('uv'); if (!uv) return [] as string[]
  const index = mesh.geometry.index?.array; const count = Math.min(index ? index.length : uv.count, 30_000); const polygons: string[] = []
  for (let i = 0; i + 2 < count; i += 3) {
    const ids = index ? [Number(index[i]), Number(index[i + 1]), Number(index[i + 2])] : [i, i + 1, i + 2]
    polygons.push(ids.map(id => `${(uv.getX(id) * 1000).toFixed(2)},${((1 - uv.getY(id)) * 1000).toFixed(2)}`).join(' '))
  }
  return polygons
}

const defaultUv = (): UVLayoutConfig => ({ mode: 'existing', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false, crop: true })

function materialList(mesh: THREE.Mesh | null) {
  return mesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
}

function materialId(material: THREE.Material, index: number) {
  material.userData.materialId ||= `${material.name || 'material'}-${index}`; return String(material.userData.materialId)
}

function applyUvToTexture(material: THREE.Material | null, uv: UVLayoutConfig) {
  if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) return
  material.map.wrapS = material.map.wrapT = uv.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  material.map.center.set(.5, .5); material.map.repeat.set(uv.scale, uv.scale); material.map.rotation = THREE.MathUtils.degToRad(uv.rotation); material.map.offset.set(uv.offsetX, uv.offsetY); material.map.needsUpdate = true; material.needsUpdate = true
}

function UvSlider({ label, value, min, max, step = .01, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="uv-control"><span><b>{label}</b><em>{Number(value.toFixed(2))}{unit}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
}

export default function CustomUVWorkspace({ config, onModeling, onPackagingLibrary }: { config: CustomModelConfig; onModeling: () => void; onPackagingLibrary: () => void }) {
  const [root, setRoot] = useState<THREE.Group | null>(null); const [asset, setAsset] = useState<Awaited<ReturnType<typeof getModelAsset>>>(null); const [meshIndex, setMeshIndex] = useState(0); const [slotIndex, setSlotIndex] = useState(0)
  const [dirty, setDirty] = useState(false); const [status, setStatus] = useState('正在读取模型UV'); const [zoom, setZoom] = useState(1)
  useEffect(() => {
    let active = true
    Promise.all([getModelAsset(config.assetId), loadModelAssetObject(config.assetId)]).then(([record, source]) => { if (!active) return; if (!record) throw new Error('模型资产不存在'); setAsset(record); setRoot(cloneModelObject(source)); setStatus('UV展开已载入') }).catch(error => { if (active) setStatus(error instanceof Error ? error.message : 'UV读取失败') })
    return () => { active = false }
  }, [config.assetId, config.revision])
  const meshes = useMemo(() => meshesOf(root), [root]); const mesh = meshes[Math.min(meshIndex, Math.max(0, meshes.length - 1))] ?? null; const materials = materialList(mesh); const material = materials[Math.min(slotIndex, Math.max(0, materials.length - 1))] ?? null
  const slotId = material ? materialId(material, slotIndex) : ''; const slot = asset?.materials.find(item => item.id === slotId) ?? asset?.materials.find(item => item.name === material?.name) ?? null
  const uv = slot?.uv ?? defaultUv(); const polygons = useMemo(() => polygonsOf(mesh), [mesh])
  useEffect(() => {
    if (!dirty || !root || !asset) return
    const timer = setTimeout(async () => {
      try {
        setStatus('正在保存UV与图案'); const glb = await serializeModel(root); const updated = { ...asset, glb, materials: asset.materials, updatedAt: Date.now() }; await putModelAsset(updated); invalidateModelAsset(updated.id); setAsset(updated); setDirty(false); setStatus('UV与图案已保存到本机')
        const studio = useStudio.getState(); const next = structuredClone(studio.snapshot); if (next.model.type === 'custom' && next.model.assetId === updated.id) { next.model.revision = updated.updatedAt; studio.setSnapshot(next, false) }
      } catch (error) { setStatus(error instanceof Error ? error.message : 'UV保存失败') }
    }, 600)
    return () => clearTimeout(timer)
  }, [dirty, root, asset])
  const updateUv = (value: Partial<UVLayoutConfig>) => {
    if (!asset || !slot) return; const nextUv = { ...slot.uv, ...value }; const nextMaterials = asset.materials.map(item => item.id === slot.id ? { ...item, uv: nextUv } : item); const nextAsset = { ...asset, materials: nextMaterials }; setAsset(nextAsset); applyUvToTexture(material, nextUv); setDirty(true)
  }
  const upload = (file?: File) => {
    if (!file || !asset || !material) return; const reader = new FileReader(); reader.onload = () => {
      const url = String(reader.result); new THREE.TextureLoader().load(url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 16
        if (material instanceof THREE.MeshStandardMaterial) { material.map = texture; material.color.set('#ffffff'); material.needsUpdate = true; applyUvToTexture(material, uv) }
        const id = slot?.id ?? materialId(material, slotIndex); const nextSlot: CustomMaterialSlot = slot ? { ...slot, artworkUrl: url, artworkName: file.name } : { id, name: material.name || `材质 ${slotIndex + 1}`, color: '#ffffff', roughness: .5, metalness: 0, opacity: 1, clearcoat: 0, artworkUrl: url, artworkName: file.name, uv: defaultUv() }
        const nextMaterials = slot ? asset.materials.map(item => item.id === slot.id ? nextSlot : item) : [...asset.materials, nextSlot]; setAsset({ ...asset, materials: nextMaterials }); setDirty(true)
      })
    }; reader.readAsDataURL(file)
  }
  const artwork = slot?.artworkUrl
  return <main className="custom-uv-workspace">
    <aside className="custom-uv-left"><div className="two-d-heading"><b>2D 展开设计</b><span>包装结构展开与自定义模型UV都保留</span></div><div className="uv-section-switch"><button onClick={onPackagingLibrary}><PackageOpen size={14} />包装结构库</button><button className="active"><Triangle size={14} />自定义模型UV</button></div><div className="uv-mesh-list">{meshes.map((item, index) => <button key={item.uuid} className={meshIndex === index ? 'selected' : ''} onClick={() => { setMeshIndex(index); setSlotIndex(0) }}><Triangle size={14} /><div><b>{item.name || `网格 ${index + 1}`}</b><small>{Math.floor((item.geometry.index?.count ?? item.geometry.getAttribute('position').count) / 3).toLocaleString()} 三角面</small></div>{meshIndex === index && <Check size={13} />}</button>)}</div><div className="uv-workflow-note"><Sparkles size={16} /><div><b>UV展开设计</b><span>这是自定义模型的2D包装展开，不是纸盒刀模。上传图案后会实时同步到3D场景。</span></div></div><button className="ghost wide" onClick={onModeling}><Layers3 size={14} />返回建模编辑</button></aside>
    <section className="custom-uv-stage"><header><span><i className="live-dot" />{config.name} · UV展开图</span><div><button onClick={() => setZoom(value => Math.max(.4, value - .15))}>−</button><b>{Math.round(zoom * 100)}%</b><button onClick={() => setZoom(value => Math.min(3, value + .15))}>＋</button></div><span>{polygons.length.toLocaleString()} 个UV三角面</span></header><div className="uv-board-wrap"><div className="uv-board" style={{ transform: `scale(${zoom})` }}><svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"><defs><pattern id="uv-checker" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#f1f1f1" /><rect width="40" height="40" fill="#dedede" /><rect x="40" y="40" width="40" height="40" fill="#dedede" /></pattern>{artwork && <pattern id="uv-artwork" width="1000" height="1000" patternUnits="userSpaceOnUse" patternTransform={`translate(${uv.offsetX * 1000} ${-uv.offsetY * 1000}) rotate(${uv.rotation} 500 500) scale(${1 / Math.max(uv.scale, .01)})`}><image href={artwork} x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid slice" /></pattern>}</defs><rect width="1000" height="1000" fill="url(#uv-checker)" />{artwork && <rect width="1000" height="1000" fill="url(#uv-artwork)" opacity=".72" />}{polygons.map((points, index) => <polygon key={index} points={points} fill={artwork ? '#ff7a2204' : '#ff7a220d'} stroke="#38424d" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />)}</svg>{!polygons.length && <div className="uv-board-empty"><Triangle size={31} /><b>当前网格没有UV展开</b><span>返回建模编辑，点击“自动展开并进入2D设计”。</span></div>}</div></div><footer><span>{status}</span><span>UV 0–1 工作区 · 图案仅保存在本机</span></footer></section>
    <aside className="custom-uv-right"><div className="two-d-tabs"><button className="active">图案与UV</button></div><div className="properties"><label className="select-row"><span>材质槽</span><select value={slotIndex} disabled={!materials.length} onChange={event => setSlotIndex(Number(event.target.value))}>{materials.map((item, index) => <option key={item.uuid} value={index}>{item.name || `材质 ${index + 1}`}</option>)}</select></label><label className={`uv-artwork-upload ${artwork ? 'has-image' : ''}`}>{artwork ? <img src={artwork} alt="包装图案" /> : <ImagePlus size={25} />}<span>{slot?.artworkName || '上传包装图案'}</span><small>PNG / JPG / WebP</small><input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => upload(event.target.files?.[0])} /></label><UvSlider label="图案缩放" value={uv.scale} min={.2} max={5} onChange={value => updateUv({ scale: value })} /><UvSlider label="旋转" value={uv.rotation} min={-180} max={180} step={1} unit="°" onChange={value => updateUv({ rotation: value })} /><UvSlider label="水平偏移" value={uv.offsetX} min={-1} max={1} onChange={value => updateUv({ offsetX: value })} /><UvSlider label="垂直偏移" value={uv.offsetY} min={-1} max={1} onChange={value => updateUv({ offsetY: value })} /><label className="switch-row"><span>重复平铺</span><button className={`switch ${uv.repeat ? 'on' : ''}`} onClick={() => updateUv({ repeat: !uv.repeat })}><i /></button></label><button className="ghost wide" onClick={() => updateUv({ scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false })}><RotateCcw size={14} />恢复图案适配</button><div className="uv-save-card"><Save size={15} /><div><b>{dirty ? '等待自动保存' : '模型资产已同步'}</b><span>返回3D预览即可查看最终贴图效果。</span></div></div></div></aside>
  </main>
}
