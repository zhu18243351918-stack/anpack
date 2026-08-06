import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, ChevronDown, CircleHelp, Download, FileUp, FolderOpen, ImagePlus, Lightbulb, LogOut, PackageOpen, Play, Redo2, RotateCcw, Save, Search, Sparkles, Undo2, Upload, UserRound, Wine, Wrench, X } from 'lucide-react'
import * as THREE from 'three'
import StudioScene from './StudioScene'
import ModelingWorkspace from './ModelingWorkspace'
import ModelingStartDialog from './ModelingStartDialog'
import CustomUVWorkspace from './CustomUVWorkspace'
import CadDielineWorkspace from './CadDielineWorkspace'
import CadFoldWorkspace from './CadFoldWorkspace'
import CadImportDialog from './CadImportDialog'
import CadCreateDialog from './CadCreateDialog'
import { chooseOutputFile, openProjectFile, saveBlobToDownloads, saveProjectFile, supportsFileLocations, writeOutputFile, type FileHandleLike } from './filePersistence'
import ModelImportDialog from './ModelImportDialog'
import DielineEditor, { FACE_LABELS, TEMPLATE_META } from './DielineEditor'
import { prepareArtworkFile, removeSolidImageBackground } from './artworkTransform'
import { getSceneTemplate, materialPresets, sceneTemplates } from './presets'
import { DEFAULT_SCENE_OBJECT_TRANSFORM, getSceneObjectDescriptors, sceneObjectAssetKey, type SceneObjectDescriptor } from './sceneObjects'
import { useStudio } from './store'
import { createModelAsset, modelAssetToConfig, parseModelGlb } from './modelAssets'
import { isDesktopRuntime } from './runtime'
import { useAuth } from './auth'
import type { ArtworkSurface, BoxFace, CameraConfig, CustomModelConfig, ExportConfig, ModelAssetRecord, ModelType, PackagingModelConfig, PackagingTemplate, ProceduralModelType } from './types'

const MODEL_META: { type: ProceduralModelType; name: string; desc: string; icon: typeof Box }[] = [
  { type: 'box', name: '精品纸盒', desc: '六面包装 · 圆角', icon: Box },
  { type: 'bottle', name: '标签瓶', desc: '瓶身 · 瓶盖', icon: Wine },
  { type: 'can', name: '圆罐', desc: '环绕标签 · 金属盖', icon: PackageOpen },
  { type: 'pouch', name: '自立软袋', desc: '封边 · 底部鼓包', icon: PackageOpen },
]
declare global { interface Window { __packshotExportProductGlb?: () => Promise<ArrayBuffer> } }
const RATIOS: Record<ExportConfig['ratio'], number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9 }

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return <label className="control"><span><b>{label}</b><span className="number-field"><span className="number-edit" role="spinbutton" aria-label={`${label}数值`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} contentEditable suppressContentEditableWarning onBlur={e => { const next = Number(e.currentTarget.textContent); if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); else e.currentTarget.textContent = String(Number(value.toFixed(2))) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}>{String(Number(value.toFixed(2)))}</span><i>{unit}</i></span></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="switch-row"><span>{label}</span><button className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-label={label}><i /></button></label>
}

function FieldTitle({ children, hint }: { children: React.ReactNode; hint?: string }) { return <div className="section-title"><span>{children}</span>{hint && <small>{hint}</small>}</div> }

function ModelParameters() {
  const model = useStudio(s => s.snapshot.model); const patch = useStudio(s => s.patch)
  const set = (key: string, value: number) => patch('model', { [key]: value } as Partial<PackagingModelConfig>)
  if (model.type === 'custom') return <div className="custom-model-summary"><span className="model-thumb custom"><Wrench size={25} /></span><div><b>{model.name}</b><small>{model.meshCount} 个网格 · {model.triangleCount.toLocaleString()} 三角面</small><small>{model.bounds.map(value => Math.round(value)).join(' × ')} mm · {model.sourceFormat.toUpperCase()}</small></div></div>
  if (model.type === 'box') return <><Slider label="宽度" value={model.width} min={40} max={180} unit="mm" onChange={v => set('width', v)} /><Slider label="高度" value={model.height} min={60} max={240} unit="mm" onChange={v => set('height', v)} /><Slider label="深度" value={model.depth} min={20} max={120} unit="mm" onChange={v => set('depth', v)} /><Slider label="圆角" value={model.radius} min={0} max={12} step={.5} unit="mm" onChange={v => set('radius', v)} /><Slider label="纸张厚度" value={model.thickness} min={.2} max={2} step={.1} unit="mm" onChange={v => set('thickness', v)} /></>
  if (model.type === 'bottle') return <><Slider label="瓶高" value={model.height} min={100} max={260} unit="mm" onChange={v => set('height', v)} /><Slider label="瓶身直径" value={model.diameter} min={35} max={110} unit="mm" onChange={v => set('diameter', v)} /><Slider label="肩部高度" value={model.shoulder} min={12} max={55} unit="mm" onChange={v => set('shoulder', v)} /><Slider label="瓶颈直径" value={model.neck} min={15} max={48} unit="mm" onChange={v => set('neck', v)} /><Slider label="瓶盖高度" value={model.cap} min={10} max={42} unit="mm" onChange={v => set('cap', v)} /></>
  if (model.type === 'can') return <><Slider label="罐高" value={model.height} min={60} max={220} unit="mm" onChange={v => set('height', v)} /><Slider label="直径" value={model.diameter} min={40} max={130} unit="mm" onChange={v => set('diameter', v)} /><Slider label="罐盖高度" value={model.lid} min={2} max={16} unit="mm" onChange={v => set('lid', v)} /><Slider label="边缘圆角" value={model.radius} min={1} max={12} unit="mm" onChange={v => set('radius', v)} /></>
  return <><Slider label="袋宽" value={model.width} min={60} max={180} unit="mm" onChange={v => set('width', v)} /><Slider label="袋高" value={model.height} min={90} max={260} unit="mm" onChange={v => set('height', v)} /><Slider label="厚度" value={model.depth} min={8} max={60} unit="mm" onChange={v => set('depth', v)} /><Slider label="顶部封边" value={model.seal} min={5} max={25} unit="mm" onChange={v => set('seal', v)} /><Slider label="底部鼓包" value={model.gusset} min={5} max={30} unit="mm" onChange={v => set('gusset', v)} /></>
}

function ArtworkPanel({ onError }: { onError: (s: string) => void }) {
  const artwork = useStudio(s => s.snapshot.artwork); const patch = useStudio(s => s.patch); const input = useRef<HTMLInputElement>(null)
  const [backgroundNote, setBackgroundNote] = useState('')
  const upload = async (file?: File) => {
    if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return onError('仅支持 PNG、JPG 或 WebP 图像')
    if (file.size > 18 * 1024 * 1024) return onError('图像超过 18MB，请压缩后重试')
    try { const prepared = await prepareArtworkFile(file); patch('artwork', { url: prepared.url, originalUrl: prepared.originalUrl, backgroundMode: prepared.removed ? 'removed' : 'auto', name: file.name, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }); setBackgroundNote(prepared.removed ? '已自动移除纯色背景' : '') }
    catch (reason) { onError(reason instanceof Error ? reason.message : '图像读取失败，请换一个文件重试') }
  }
  const sample = (kind: 'citrus' | 'mono') => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1200; const ctx = canvas.getContext('2d')!
    if (kind === 'citrus') { const g = ctx.createLinearGradient(0, 0, 900, 1200); g.addColorStop(0, '#f5e5b8'); g.addColorStop(1, '#ef8e58'); ctx.fillStyle = g; ctx.fillRect(0, 0, 900, 1200); ctx.strokeStyle = '#fff'; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(650, 310, 180, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#f7b434'; ctx.beginPath(); ctx.arc(650, 310, 115, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#25231f'; ctx.font = '54px sans-serif'; ctx.fillText('C I T R U S', 90, 200); ctx.font = 'bold 112px sans-serif'; ctx.fillText('SUN DROP', 90, 820); ctx.font = '28px sans-serif'; ctx.fillText('BOTANICAL DRINK · 250 ML', 94, 1030) }
    else { ctx.fillStyle = '#ebe7dd'; ctx.fillRect(0, 0, 900, 1200); ctx.fillStyle = '#1f2421'; ctx.beginPath(); ctx.moveTo(0, 830); ctx.lineTo(900, 480); ctx.lineTo(900, 760); ctx.lineTo(0, 1110); ctx.fill(); ctx.strokeStyle = '#1f2421'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(690, 230, 120, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#1f2421'; ctx.font = '46px sans-serif'; ctx.fillText('F I E L D  N O T E', 85, 230); ctx.font = 'bold 106px sans-serif'; ctx.fillText('FORM / 01', 85, 500); ctx.fillStyle = '#ebe7dd'; ctx.font = '26px sans-serif'; ctx.fillText('OBJECTS FOR QUIET LIVING', 88, 1110) }
    patch('artwork', { url: canvas.toDataURL('image/png'), originalUrl: null, backgroundMode: 'keep', name: kind === 'citrus' ? '柑橘饮品示例' : '黑白生活方式示例' }); setBackgroundNote('')
  }
  return <div className="panel-stack"><FieldTitle hint="本地处理，不会上传">包装图案</FieldTitle>
    <button className={`upload-card ${artwork.url ? 'has-image' : ''}`} onClick={() => input.current?.click()}>{artwork.url ? <img src={artwork.url} alt="包装图案预览" /> : <ImagePlus size={25} />}<span>{artwork.url ? artwork.name : '上传包装设计图'}</span><small>PNG / JPG / WebP · 最大 18MB</small></button>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])} />
    {(backgroundNote || artwork.backgroundMode === 'removed') && <div className="artwork-fix-note"><span><Check size={13} />{backgroundNote || '图片纯色背景已被移除'}</span>{artwork.originalUrl && <button onClick={() => { patch('artwork', { url: artwork.originalUrl, originalUrl: null, backgroundMode: 'keep' }); setBackgroundNote('') }}>取消去底</button>}</div>}
    <div className="sample-row"><button onClick={() => sample('citrus')}><i className="sample-citrus" />柑橘示例</button><button onClick={() => sample('mono')}><i className="sample-mono" />黑白示例</button></div>
    <label className="select-row"><span>映射方式</span><select value={artwork.mapping} onChange={e => patch('artwork', { mapping: e.target.value as typeof artwork.mapping })}><option value="smart">智能适配</option><option value="front">主展示面</option><option value="wrap">环绕标签</option><option value="dieline">纸盒展开图</option></select></label>
    <Slider label="图案缩放" value={artwork.scale} min={.35} max={3} step={.05} onChange={v => patch('artwork', { scale: v })} /><Slider label="旋转" value={artwork.rotation} min={-180} max={180} unit="°" onChange={v => patch('artwork', { rotation: v })} /><Slider label="水平偏移" value={artwork.offsetX} min={-.5} max={.5} step={.01} onChange={v => patch('artwork', { offsetX: v })} /><Slider label="垂直偏移" value={artwork.offsetY} min={-.5} max={.5} step={.01} onChange={v => patch('artwork', { offsetY: v })} />
    <Switch label="重复平铺" checked={artwork.repeat} onChange={v => patch('artwork', { repeat: v })} /><button className="ghost wide" onClick={() => patch('artwork', { scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false })}><RotateCcw size={14} />恢复贴图默认值</button>
  </div>
}

function MaterialPanel() {
  const material = useStudio(s => s.snapshot.material); const patch = useStudio(s => s.patch); const apply = useStudio(s => s.applyMaterial)
  return <div className="panel-stack"><FieldTitle>材质预设</FieldTitle><div className="preset-grid">{Object.entries(materialPresets).map(([name, p]) => <button key={name} className={`material-card ${material.preset === name ? 'selected' : ''}`} onClick={() => apply(name)}><i style={{ background: p.color, opacity: p.opacity }} /> <span>{name}</span>{material.preset === name && <Check size={13} />}</button>)}</div><FieldTitle hint="PBR 微表面">高级材质</FieldTitle><label className="color-row"><span>基础颜色</span><input type="color" value={material.color} onChange={e => patch('material', { color: e.target.value })} /></label><Slider label="粗糙度" value={material.roughness} min={0} max={1} step={.01} onChange={v => patch('material', { roughness: v })} /><Slider label="金属度" value={material.metalness} min={0} max={1} step={.01} onChange={v => patch('material', { metalness: v })} /><Slider label="透明度" value={material.opacity} min={.15} max={1} step={.01} onChange={v => patch('material', { opacity: v })} /><Slider label="透光度" value={material.transmission} min={0} max={1} step={.01} onChange={v => patch('material', { transmission: v })} /><Slider label="清漆" value={material.clearcoat} min={0} max={1} step={.01} onChange={v => patch('material', { clearcoat: v })} /><Slider label="清漆粗糙度" value={material.clearcoatRoughness} min={0} max={1} step={.01} onChange={v => patch('material', { clearcoatRoughness: v })} /><Slider label="微表面强度" value={material.normalScale} min={0} max={.6} step={.01} onChange={v => patch('material', { normalScale: v })} /><Slider label="纹理密度" value={material.textureScale} min={1} max={20} step={.5} onChange={v => patch('material', { textureScale: v })} /><Slider label="折射率" value={material.ior} min={1} max={2.2} step={.01} onChange={v => patch('material', { ior: v })} /><Slider label="实体厚度" value={material.thickness} min={.01} max={1} step={.01} onChange={v => patch('material', { thickness: v })} /><Slider label="图案强度" value={material.textureStrength} min={0} max={1} step={.01} onChange={v => patch('material', { textureStrength: v })} /></div>
}

function CameraPanel() {
  const camera = useStudio(s => s.snapshot.camera); const patch = useStudio(s => s.patch)
  const views: { n: string; p: CameraConfig['position'] }[] = [{ n: '前右', p: [5.8, 4.1, 7.2] }, { n: '正面', p: [0, 2.8, 8] }, { n: '前左', p: [-5.8, 4.1, 7.2] }, { n: '顶右', p: [5.8, 7.2, 5.5] }, { n: '正顶', p: [0, 9, .01] }, { n: '顶左', p: [-5.8, 7.2, 5.5] }]
  return <div className="panel-stack"><FieldTitle>快捷视角</FieldTitle><div className="view-grid">{views.map(v => <button key={v.n} onClick={() => patch('camera', { position: v.p })}><span className="view-cube" />{v.n}</button>)}</div><label className="segmented"><button className={camera.projection === 'perspective' ? 'active' : ''} onClick={() => patch('camera', { projection: 'perspective' })}>透视</button><button className={camera.projection === 'orthographic' ? 'active' : ''} onClick={() => patch('camera', { projection: 'orthographic' })}>正交</button></label><Slider label="视场角" value={camera.fov} min={18} max={65} unit="°" onChange={v => patch('camera', { fov: v })} /><Switch label="导出景深" checked={camera.depthOfField} onChange={v => patch('camera', { depthOfField: v })} />{camera.depthOfField && <><Slider label="焦点距离" value={camera.focusDistance} min={1} max={14} step={.1} onChange={v => patch('camera', { focusDistance: v })} /><Slider label="光圈" value={camera.fStop} min={1.4} max={16} step={.1} unit="f" onChange={v => patch('camera', { fStop: v })} /></>}<button className="ghost wide" onClick={() => patch('camera', { position: [5.8, 4.1, 7.2], target: [0, 1.35, 0], fov: 34, focusDistance: 7.2, fStop: 5.6 })}><RotateCcw size={14} />恢复默认构图</button></div>
}

function LightingPanel() {
  const lighting = useStudio(s => s.snapshot.lighting); const patch = useStudio(s => s.patch)
  return <div className="panel-stack"><FieldTitle>光照组合</FieldTitle><div className="light-summary"><span className="sun-orb" /><div><b>HDR 影棚布光</b><small>环境反射 · 柔光箱 · 轮廓光</small></div></div><Switch label="HDR 环境反射" checked={lighting.environment !== 'none'} onChange={v => patch('lighting', { environment: v ? 'studio-small-09' : 'none' })} /><Slider label="环境强度" value={lighting.environmentIntensity} min={0} max={3} step={.05} onChange={v => patch('lighting', { environmentIntensity: v })} /><Slider label="环境旋转" value={lighting.environmentRotation} min={-180} max={180} unit="°" onChange={v => patch('lighting', { environmentRotation: v })} /><Slider label="环境补光" value={lighting.ambient} min={0} max={2} step={.05} onChange={v => patch('lighting', { ambient: v })} /><Slider label="主光亮度" value={lighting.key} min={0} max={8} step={.1} onChange={v => patch('lighting', { key: v })} /><Slider label="主光尺寸" value={lighting.keySize} min={1} max={10} step={.1} onChange={v => patch('lighting', { keySize: v })} /><Slider label="辅光亮度" value={lighting.fill} min={0} max={5} step={.1} onChange={v => patch('lighting', { fill: v })} /><Slider label="辅光尺寸" value={lighting.fillSize} min={1} max={10} step={.1} onChange={v => patch('lighting', { fillSize: v })} /><Slider label="轮廓光" value={lighting.point} min={0} max={4} step={.1} onChange={v => patch('lighting', { point: v })} /><Slider label="色温" value={lighting.temperature} min={2800} max={7500} step={100} unit="K" onChange={v => patch('lighting', { temperature: v })} /><Slider label="阴影柔度" value={lighting.shadowSoftness} min={0} max={12} step={.5} onChange={v => patch('lighting', { shadowSoftness: v })} /><Slider label="环境曝光" value={lighting.exposure} min={.4} max={2} step={.05} onChange={v => patch('lighting', { exposure: v })} /></div>
}

function SceneThumbnail({ className }: { className: string }) {
  return <span className={`scene-thumb ${className}`} aria-hidden="true"><span className="thumb-plane plane-a" /><span className="thumb-plane plane-b" /><span className="thumb-product product-a" /><span className="thumb-product product-b" /><span className="thumb-orb orb-a" /><span className="thumb-orb orb-b" /></span>
}

function SceneLibrary({ onRender }: { onRender: () => void }) {
  const scene = useStudio(s => s.snapshot.scene); const modelType = useStudio(s => s.snapshot.model.type); const apply = useStudio(s => s.applyScene); const patch = useStudio(s => s.patch)
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('全部')
  const categories = ['全部', '电商基础', '美妆个护', '食品饮料', '高端质感', '创意构图'] as const
  const filtered = sceneTemplates.filter(template => (category === '全部' || template.category === category) && (!query.trim() || `${template.name}${template.description}${template.tags.join('')}`.toLowerCase().includes(query.trim().toLowerCase())))
  const selected = getSceneTemplate(scene.templateId || scene.preset)
  const modelNames: Record<ModelType, string> = { box: '纸盒', bottle: '瓶器', can: '罐装', pouch: '软袋', custom: '自定义模型' }
  return <div className="scene-library scene-library-pro">
    <div className="library-heading"><div><b>商业场景库</b><span>选择构图，当前包装会自动替换进去</span></div><span className="scene-count">{sceneTemplates.length}</span></div>
    <label className="scene-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索场景、用途或风格" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={13} /></button>}</label>
    <div className="scene-chips" role="tablist" aria-label="场景分类">{categories.map(item => <button role="tab" aria-selected={category === item} key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className="scene-grid rich">{filtered.map(template => {
      const compatible = template.compatible.includes(modelType); const active = selected.id === template.id
      return <button key={template.id} className={`scene-card-rich ${active ? 'selected' : ''}`} onClick={() => apply(template.id)} disabled={!compatible} aria-pressed={active}>
        <SceneThumbnail className={template.thumbnail} />
        <span className="scene-card-copy"><b>{template.name}</b><small>{template.description}</small><span><i>{template.category}</i><em>{compatible ? `适配${modelNames[modelType]}` : '暂不适配'}</em></span></span>
        {active && <span className="scene-selected"><Check size={12} /></span>}
      </button>
    })}</div>
    {!filtered.length && <div className="scene-empty"><Search size={22} /><b>没有匹配的场景</b><span>尝试更换分类或搜索词</span></div>}
    <div className="scene-use-card"><div><span className="scene-use-icon"><Sparkles size={16} /></span><p><b>{selected.name}</b><small>{selected.products.length} 个包装实例 · {selected.category}</small></p></div><button className="primary scene-render" onClick={onRender}><Play size={14} fill="currentColor" />使用当前包装立即渲染</button></div>
    <details className="scene-adjustments"><summary>自定义当前场景</summary><div><Switch label="地面与阴影" checked={scene.floor} onChange={v => patch('scene', { floor: v })} /><Switch label="无缝弧形影棚" checked={scene.cyclorama} onChange={v => patch('scene', { cyclorama: v, floor: v || scene.floor })} /><Switch label="展示台" checked={scene.pedestal} onChange={v => patch('scene', { pedestal: v })} /><Switch label="装饰物" checked={scene.decor} onChange={v => patch('scene', { decor: v })} /><Slider label="地面粗糙度" value={scene.floorRoughness} min={.1} max={1} step={.01} onChange={v => patch('scene', { floorRoughness: v })} /><label className="color-row"><span>背景颜色</span><input type="color" value={scene.background} onChange={e => patch('scene', { background: e.target.value, transparent: false })} /></label></div></details>
  </div>
}

function SceneObjectEditor({ onModelObject, busy }: { onModelObject: (object: SceneObjectDescriptor) => void; busy: boolean }) {
  const scene = useStudio(s => s.snapshot.scene); const patch = useStudio(s => s.patch)
  const selectedId = useStudio(s => s.selectedSceneObjectId); const select = useStudio(s => s.selectSceneObject)
  const template = getSceneTemplate(scene.templateId || scene.preset)
  const objects = useMemo(() => getSceneObjectDescriptors(template.id, template.products.length), [template.id, template.products.length])
  const selected = objects.find(object => object.id === selectedId) ?? objects[0]
  if (!selected) return <div className="scene-object-empty"><b>当前场景没有可编辑对象</b><span>切换其他场景模板后，可单独调整其中的包装和装饰模型。</span></div>
  const transform = scene.objectOverrides[selected.id] ?? DEFAULT_SCENE_OBJECT_TRANSFORM
  const assetKey = sceneObjectAssetKey(template.id, selected.id); const customAsset = scene.objectAssets[assetKey]
  const groupVisible = selected.kind === 'pedestal' ? scene.pedestal : selected.kind === 'decor' ? scene.decor : true
  const update = (value: Partial<typeof transform>) => patch('scene', { objectOverrides: { ...scene.objectOverrides, [selected.id]: { ...transform, ...value } } })
  const updatePosition = (axis: number, value: number) => { const position = [...transform.position] as typeof transform.position; position[axis] = value; update({ position }) }
  const updateRotation = (axis: number, value: number) => { const rotation = [...transform.rotation] as typeof transform.rotation; rotation[axis] = value * Math.PI / 180; update({ rotation }) }
  const setVisible = (visible: boolean) => patch('scene', {
    objectOverrides: { ...scene.objectOverrides, [selected.id]: { ...transform, visible } },
    ...(visible && selected.kind === 'pedestal' ? { pedestal: true } : {}),
    ...(visible && selected.kind === 'decor' ? { decor: true } : {}),
  })
  const reset = () => { const objectOverrides = { ...scene.objectOverrides }; delete objectOverrides[selected.id]; patch('scene', { objectOverrides }) }
  const restoreTemplateModel = () => { const objectAssets = { ...scene.objectAssets }; delete objectAssets[assetKey]; patch('scene', { objectAssets }) }
  return <div className="scene-object-editor">
    <FieldTitle hint={`${objects.length} 个对象`}>场景对象</FieldTitle>
    <div className="scene-object-list" role="listbox" aria-label="场景对象">
      {objects.map(object => {
        const override = scene.objectOverrides[object.id]; const enabledByGroup = object.kind === 'pedestal' ? scene.pedestal : object.kind === 'decor' ? scene.decor : true
        const modeled = Boolean(scene.objectAssets[sceneObjectAssetKey(template.id, object.id)])
        const visible = enabledByGroup && (override?.visible ?? true)
        return <button key={object.id} role="option" aria-selected={selected.id === object.id} className={selected.id === object.id ? 'selected' : ''} onClick={() => select(object.id)}><i className={`scene-object-dot ${object.kind}`} /><span><b>{object.label}</b><small>{object.kind === 'product' ? '包装模型' : object.kind === 'pedestal' ? '展示台' : '装饰模型'}</small></span><em className={modeled ? 'modeled' : visible ? '' : 'hidden'}>{modeled ? '已建模' : visible ? '显示' : '隐藏'}</em></button>
      })}
    </div>
    <div className="scene-object-current"><span><b>{selected.label}</b><small>拖动数值实时更新，也可在画布中点击对象选择</small></span><button className="scene-object-reset" onClick={reset}><RotateCcw size={13} />重置位置</button></div>
    <button className="scene-model-edit-button" disabled={busy || !groupVisible || !transform.visible} onClick={() => onModelObject(selected)}><Wrench size={15} /><span><b>{busy ? '正在准备网格' : customAsset ? '继续编辑模板模型' : selected.kind === 'product' ? '编辑包装网格' : '转换并进入建模编辑'}</b><small>{selected.kind === 'product' ? '编辑当前包装的点、边、面和材质' : '修改后会自动替换场景中的此对象'}</small></span></button>
    {customAsset && selected.kind !== 'product' && <button className="scene-restore-model" onClick={restoreTemplateModel}><RotateCcw size={13} />恢复模板原始模型</button>}
    <Switch label="显示此对象" checked={groupVisible && transform.visible} onChange={setVisible} />
    <div className="scene-transform-group"><small>位置偏移</small><Slider label="左右 X" value={transform.position[0]} min={-5} max={5} step={.05} onChange={v => updatePosition(0, v)} /><Slider label="上下 Y" value={transform.position[1]} min={-3} max={5} step={.05} onChange={v => updatePosition(1, v)} /><Slider label="前后 Z" value={transform.position[2]} min={-5} max={5} step={.05} onChange={v => updatePosition(2, v)} /></div>
    <div className="scene-transform-group"><small>旋转</small><Slider label="旋转 X" value={transform.rotation[0] * 180 / Math.PI} min={-180} max={180} unit="°" onChange={v => updateRotation(0, v)} /><Slider label="旋转 Y" value={transform.rotation[1] * 180 / Math.PI} min={-180} max={180} unit="°" onChange={v => updateRotation(1, v)} /><Slider label="旋转 Z" value={transform.rotation[2] * 180 / Math.PI} min={-180} max={180} unit="°" onChange={v => updateRotation(2, v)} /></div>
    <Slider label="对象缩放" value={transform.scale} min={.15} max={3} step={.05} onChange={v => update({ scale: v })} />
  </div>
}

function FaceEditorPanel({ face, surface, onError }: { face: BoxFace; surface: ArtworkSurface; onError: (message: string) => void }) {
  const artwork = useStudio(s => s.snapshot.artwork); const patch = useStudio(s => s.patch); const input = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false); const [backgroundNote, setBackgroundNote] = useState('')
  const surfaceKey = surface === 'outer' ? 'faces' : 'innerFaces'; const surfaceFaces = artwork[surfaceKey]; const current = surfaceFaces[face]
  const updateFace = (value: Partial<typeof current>) => { const nextFace = { ...current, ...value }; patch('artwork', { [surfaceKey]: { ...surfaceFaces, [face]: nextFace }, ...(surface === 'outer' && face === 'front' ? { url: nextFace.url, name: nextFace.name, scale: nextFace.scale, rotation: nextFace.rotation, offsetX: nextFace.offsetX, offsetY: nextFace.offsetY, repeat: nextFace.repeat } : {}) }) }
  const upload = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return onError('仅支持 PNG、JPG 或 WebP 图像')
    if (file.size > 18 * 1024 * 1024) return onError('图像超过 18MB，请压缩后重试')
    setProcessing(true)
    try { const prepared = await prepareArtworkFile(file); updateFace({ url: prepared.url, originalUrl: prepared.originalUrl, backgroundMode: prepared.removed ? 'removed' : 'auto', name: file.name, fit: 'contain', scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }); setBackgroundNote(prepared.removed ? '已自动识别并移除图片中的纯色底' : '') }
    catch (reason) { onError(reason instanceof Error ? reason.message : '图片读取失败，请重新选择文件') }
    finally { setProcessing(false) }
  }
  const removeBackground = async () => {
    if (!current.url || processing) return; setProcessing(true)
    try { const result = await removeSolidImageBackground(current.url, true); if (!result.removed) { setBackgroundNote(''); onError(result.reason) } else { updateFace({ url: result.url, originalUrl: current.originalUrl ?? current.url, backgroundMode: 'removed', fit: 'contain' }); setBackgroundNote(result.reason) } }
    catch (reason) { onError(reason instanceof Error ? reason.message : '智能去底失败') }
    finally { setProcessing(false) }
  }
  useEffect(() => {
    const source = current.url
    if (!source?.startsWith('data:image/png') || current.backgroundMode === 'keep' || current.backgroundMode === 'removed') return
    let active = true
    void removeSolidImageBackground(source, false).then(result => {
      if (!active || !result.removed) return
      const studio = useStudio.getState(); const latest = studio.snapshot.artwork; const key = surface === 'outer' ? 'faces' : 'innerFaces'; const latestFaces = latest[key]
      if (latestFaces[face].url !== source) return
      const nextFace = { ...latestFaces[face], url: result.url, originalUrl: source, backgroundMode: 'removed' as const, fit: 'contain' as const }
      studio.patch('artwork', { [key]: { ...latestFaces, [face]: nextFace }, ...(surface === 'outer' && face === 'front' ? { url: result.url, scale: nextFace.scale, rotation: nextFace.rotation, offsetX: nextFace.offsetX, offsetY: nextFace.offsetY, repeat: nextFace.repeat } : {}) })
      setBackgroundNote('已自动修复没有 Alpha 通道的纯色底 PNG')
    }).catch(() => undefined)
    return () => { active = false }
  }, [current.url, current.backgroundMode, face, surface])
  const cancelBackgroundRemoval = () => {
    if (!current.originalUrl) return
    updateFace({ url: current.originalUrl, originalUrl: null, backgroundMode: 'keep' }); setBackgroundNote('')
  }
  return <div className="face-editor"><FieldTitle hint={surface === 'outer' ? '外侧独立贴图' : '内侧独立贴图'}>{FACE_LABELS[face]}图案</FieldTitle>
    <button className={`face-upload ${current.url ? 'has-image' : ''}`} disabled={processing} onClick={() => input.current?.click()}>{current.url ? <img src={current.url} alt={`${FACE_LABELS[face]}图案`} /> : <ImagePlus size={25} />}<span>{processing ? '正在分析图片' : current.url ? current.name : `上传${FACE_LABELS[face]}图片`}</span><small>支持透明 PNG · 默认完整显示</small></button>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])} />
    {(backgroundNote || current.backgroundMode === 'removed') && <div className="artwork-fix-note"><span><Check size={13} />{backgroundNote || '图片纯色背景已被移除'}</span>{current.originalUrl && <button onClick={cancelBackgroundRemoval}>取消去底</button>}</div>}
    <div className="artwork-fit-mode"><span>适配方式</span><div><button className={(current.fit ?? 'contain') === 'contain' ? 'active' : ''} onClick={() => updateFace({ fit: 'contain' })}>完整显示</button><button className={current.fit === 'cover' ? 'active' : ''} onClick={() => updateFace({ fit: 'cover' })}>铺满裁切</button></div></div>
    <Slider label="图案缩放" value={current.scale} min={.35} max={3} step={.05} onChange={v => updateFace({ scale: v })} />
    <Slider label="旋转" value={current.rotation} min={-180} max={180} unit="°" onChange={v => updateFace({ rotation: v })} />
    <Slider label="水平偏移" value={current.offsetX} min={-.5} max={.5} step={.01} onChange={v => updateFace({ offsetX: v })} />
    <Slider label="垂直偏移" value={current.offsetY} min={-.5} max={.5} step={.01} onChange={v => updateFace({ offsetY: v })} />
    <Switch label="重复平铺" checked={current.repeat} onChange={v => updateFace({ repeat: v })} />
    <button className="ghost wide face-remove-background" disabled={!current.url || processing} onClick={() => void removeBackground()}><Sparkles size={14} />智能移除纯色背景</button>
    <div className="face-actions"><button className="ghost" onClick={() => updateFace({ fit: 'contain', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false })}><RotateCcw size={14} />重置适配</button><button className="ghost danger" disabled={!current.url} onClick={() => { updateFace({ url: null, originalUrl: null, backgroundMode: 'auto', name: '' }); setBackgroundNote('') }}>移除图案</button></div>
  </div>
}

function ExportDialog({ onClose, onToast }: { onClose: () => void; onToast: (v: string) => void }) {
  const config = useStudio(s => s.snapshot.export); const patch = useStudio(s => s.patch); const renderJob = useStudio(s => s.renderJob); const setRenderJob = useStudio(s => s.setRenderJob); const resetRenderJob = useStudio(s => s.resetRenderJob)
  const [busy, setBusy] = useState(false); const [outputHandle, setOutputHandle] = useState<FileHandleLike | null>(null); const [cyclesRuntimeReady, setCyclesRuntimeReady] = useState<boolean | null>(null); const controller = useRef<AbortController | null>(null)
  useEffect(() => { if (!isDesktopRuntime && config.renderer === 'cycles') patch('export', { renderer: 'pathtraced' }) }, [config.renderer, patch])
  useEffect(() => { if (isDesktopRuntime) void import('./cyclesRender').then(module => module.getCyclesRuntimeStatus()).then(status => setCyclesRuntimeReady(status.installed)).catch(() => setCyclesRuntimeReady(false)) }, [])
  const dims = useMemo(() => { const r = RATIOS[config.ratio]; return r >= 1 ? [config.size, Math.round(config.size / r)] : [Math.round(config.size * r), config.size] }, [config])
  const outputName = `packshot-${dims[0]}x${dims[1]}.${config.format}`
  const pathQualityPresets = {
    draft: { name: '草稿', detail: '24 样本', samples: 24, bounces: 3 },
    studio: { name: '影棚', detail: '128 样本', samples: 128, bounces: 5 },
    ultra: { name: '极致', detail: '256 样本', samples: 256, bounces: 7 },
  } as const
  const cyclesQualityPresets = { draft: { name: '草稿', detail: '64 样本', samples: 64, bounces: 3 }, studio: { name: '影棚', detail: '256 样本', samples: 256, bounces: 6 }, ultra: { name: '极致', detail: '512 样本', samples: 512, bounces: 10 } } as const
  const qualityPresets = config.renderer === 'cycles' ? cyclesQualityPresets : pathQualityPresets
  const chooseQuality = (quality: keyof typeof qualityPresets) => { const preset = qualityPresets[quality]; patch('export', { renderQuality: quality, samples: preset.samples, bounces: preset.bounces }) }
  const selectOutput = async () => {
    try { const handle = await chooseOutputFile(outputName, config.format === 'png' ? 'image/png' : 'image/jpeg', `.${config.format}`, config.format === 'png' ? 'PNG 产品效果图' : 'JPG 产品效果图'); if (handle) setOutputHandle(handle) }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) onToast('无法选择导出位置，将使用浏览器下载文件夹') }
  }
  const download = async () => {
    if (busy || (config.renderer !== 'cycles' && !window.__packshotExport)) return
    resetRenderJob(); setBusy(true); controller.current = new AbortController(); setRenderJob({ stage: 'preparing', progress: 2, message: '准备独立渲染场景', error: null, fallback: null })
    try {
      if (config.renderer === 'cycles') {
        const { runCyclesRender } = await import('./cyclesRender')
        const result = await runCyclesRender({ width: dims[0], height: dims[1], outputPath: outputHandle?.path, signal: controller.current.signal, onProgress: state => setRenderJob(state) })
        setCyclesRuntimeReady(true)
        setRenderJob({ stage: 'done', progress: 100, message: `Cycles 渲染完成 · ${result.device}`, fallback: result.fallback ?? null })
        onToast(`Cycles 效果图已导出到 ${result.outputPath}`); return
      }
      const result = await window.__packshotExport!({
        width: dims[0], height: dims[1], mime: config.format === 'png' ? 'image/png' : 'image/jpeg', quality: config.quality,
        transparent: config.transparent && config.format === 'png', renderer: config.renderer, samples: config.samples,
        bounces: config.bounces, denoise: config.denoise, signal: controller.current.signal,
        onProgress: state => setRenderJob(state),
      })
      if (outputHandle) await writeOutputFile(outputHandle, result.blob); else saveBlobToDownloads(result.blob, outputName)
      setRenderJob({ stage: 'done', progress: 100, message: result.renderer === 'pathtraced' ? '写实渲染完成' : '增强 WebGL 渲染完成', fallback: result.fallbackReason ?? null })
      onToast(result.fallbackReason ? '路径追踪不可用，已自动使用增强 WebGL 导出' : outputHandle ? `效果图已导出到 ${outputHandle.name}` : '写实效果图已导出到浏览器下载文件夹')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setRenderJob({ stage: 'cancelled', progress: 0, message: '渲染已取消' }); onToast('已取消本次渲染') }
      else { const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '渲染失败'; setRenderJob({ stage: 'error', error: message, message }); onToast(config.renderer === 'cycles' ? 'Cycles 渲染失败，具体原因已显示' : '渲染失败，建议降低分辨率或质量后重试') }
    } finally { setBusy(false); controller.current = null }
  }
  return <div className="modal-backdrop"><div className="export-modal render-export"><header><div><span className="modal-icon"><Download size={19} /></span><div><b>导出写实产品效果图</b><small>{config.renderer === 'cycles' ? 'Blender Cycles 本地最终渲染' : '本地 GPU 路径追踪 · 图案不会上传'}</small></div></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header><div className="export-body">
    <FieldTitle hint={config.renderer === 'cycles' ? '桌面最终渲染' : config.renderer === 'pathtraced' ? '网页版推荐' : '快速'}>渲染引擎</FieldTitle><label className={`segmented export-engine ${isDesktopRuntime ? 'three-engines' : ''}`}>{isDesktopRuntime && <button className={config.renderer === 'cycles' ? 'active' : ''} onClick={() => patch('export', { renderer: 'cycles' })}>Blender Cycles</button>}<button className={config.renderer === 'pathtraced' ? 'active' : ''} onClick={() => patch('export', { renderer: 'pathtraced' })}>GPU 路径追踪</button><button className={config.renderer === 'realtime' ? 'active' : ''} onClick={() => patch('export', { renderer: 'realtime' })}>增强 WebGL</button></label>{!isDesktopRuntime && <div className="cycles-desktop-note"><Sparkles size={15} /><div><b>需要 Blender Cycles？</b><span>下载 Windows 桌面版即可使用离线最终渲染。</span></div></div>}{isDesktopRuntime && config.renderer === 'cycles' && <div className="cycles-desktop-note"><Sparkles size={15} /><div><b>{cyclesRuntimeReady ? 'Cycles 组件已安装' : cyclesRuntimeReady === false ? '首次使用将下载 Cycles 组件' : '正在检查 Cycles 组件'}</b><span>{cyclesRuntimeReady ? '运行环境保存在本机，后续更新主程序无需重复下载。' : '约 350 MB，仅需下载一次；下载完成后会自动开始渲染。'}</span></div></div>}
    <div className="export-grid"><label className="select-row"><span>文件格式</span><select value={config.format} onChange={e => { setOutputHandle(null); patch('export', { format: e.target.value as ExportConfig['format'] }) }}><option value="png">PNG</option><option value="jpg">JPG</option></select></label><label className="select-row"><span>画面比例</span><select value={config.ratio} onChange={e => patch('export', { ratio: e.target.value as ExportConfig['ratio'] })}>{Object.keys(RATIOS).map(r => <option key={r}>{r}</option>)}</select></label></div>
    <FieldTitle>输出尺寸</FieldTitle><div className="quality-options">{([1024, 2048, 4096] as const).map(size => <button key={size} className={config.size === size ? 'selected' : ''} onClick={() => patch('export', { size })}><b>{size / 1024}K</b><span>{size}px</span></button>)}</div>
    {config.renderer !== 'realtime' && <><FieldTitle hint={`${qualityPresets[config.renderQuality].samples} 样本 · ${qualityPresets[config.renderQuality].bounces} 次反弹`}>写实质量</FieldTitle><div className="render-quality-options">{(Object.keys(qualityPresets) as (keyof typeof qualityPresets)[]).map(key => <button key={key} className={config.renderQuality === key ? 'selected' : ''} onClick={() => chooseQuality(key)}><b>{qualityPresets[key].name}</b><span>{qualityPresets[key].detail}</span></button>)}</div><Switch label={config.renderer === 'cycles' ? 'Cycles 降噪' : '边缘保持降噪'} checked={config.denoise} onChange={v => patch('export', { denoise: v })} /></>}
    {config.format === 'jpg' && <Slider label="JPG 质量" value={config.quality} min={.5} max={1} step={.01} onChange={v => patch('export', { quality: v })} />}<Switch label="透明背景（仅 PNG）" checked={config.transparent && config.format === 'png'} onChange={v => patch('export', { transparent: v })} /><FieldTitle hint={outputHandle ? '已选择' : '可选'}>导出位置</FieldTitle><div className={`export-location ${outputHandle ? 'selected' : ''}`}><span><FolderOpen size={17} /></span><div><b>{outputHandle?.name ?? '浏览器默认下载文件夹'}</b><small>{supportsFileLocations() ? '可选择文件夹和文件名' : '当前浏览器不支持自定义路径'}</small></div><button className="ghost" disabled={!supportsFileLocations() || busy} onClick={() => void selectOutput()}>{outputHandle ? '更改位置' : '选择位置'}</button></div>
    {busy || renderJob.stage === 'done' || renderJob.stage === 'error' || renderJob.stage === 'cancelled' ? <div className={`render-progress state-${renderJob.stage}`}><div><span>{renderJob.message || '准备渲染'}</span><b>{Math.round(renderJob.progress)}%</b></div><i><span style={{ width: `${renderJob.progress}%` }} /></i>{renderJob.fallback && <small>回退原因：{renderJob.fallback}</small>}{renderJob.error && <small>{renderJob.error}</small>}</div> : <div className="export-summary"><span>预计输出</span><b>{dims[0]} × {dims[1]} px</b><small>{config.renderer === 'cycles' ? '将启动内置 Blender 后台渲染' : config.renderer === 'pathtraced' ? (config.size === 4096 ? '4K 可能需要数分钟' : '由显卡逐步累积光线') : '通常数秒完成'}</small></div>}
  </div><footer>{busy ? <button className="ghost danger" onClick={() => controller.current?.abort()}>取消渲染</button> : <button className="ghost" onClick={onClose}>关闭</button>}<button className="primary" onClick={download} disabled={busy}>{busy ? <><span className="spinner" />{Math.round(renderJob.progress)}%</> : <><Download size={15} />开始写实渲染</>}</button></footer></div></div>
}

function ModelLibrary({ onSelect, onImport, onConvert, converting }: { onSelect: (type: ProceduralModelType) => void; onImport: () => void; onConvert: () => void; converting: boolean }) {
  const model = useStudio(s => s.snapshot.model)
  return <><div className="library-heading"><div><b>包装模型</b><span>参数模型或导入自定义网格</span></div></div><button className="import-model-card" onClick={onImport}><span><Upload size={20} /></span><div><b>导入自定义模型</b><small>GLB · glTF · FBX · OBJ · ZIP</small></div><i>本地解析</i></button>{model.type === 'custom' && <button className="active-custom-model" onClick={() => undefined}><span className="model-thumb custom"><Wrench size={27} /></span><div><b>{model.name}</b><small>{model.meshCount} 网格 · {model.triangleCount.toLocaleString()} 面</small></div><Check size={15} /></button>}<div className="model-list">{MODEL_META.map(({ type, name, desc, icon: Icon }) => <button key={type} className={model.type === type ? 'selected' : ''} onClick={() => onSelect(type)}><span className={`model-thumb ${type}`}><Icon size={28} /></span><div><b>{name}</b><small>{desc}</small></div>{model.type === type && <Check size={15} />}</button>)}</div>{model.type !== 'custom' && <button className="convert-mesh-card" onClick={onConvert} disabled={converting}><Wrench size={16} /><div><b>{converting ? '正在生成可编辑网格' : '转换为可编辑网格'}</b><small>保留当前材质与图案；转换后不再同步2D展开尺寸</small></div></button>}<div className="tip-card"><Lightbulb size={17} /><div><b>推荐工作流</b><span>复杂结构在 Blender/C4D 中制作后导出 GLB；网页端负责包装贴图、常用网格修改和场景渲染。</span></div></div></>
}

export default function App() {
  const auth = useAuth()
  const snapshot = useStudio(s => s.snapshot); const past = useStudio(s => s.past); const future = useStudio(s => s.future); const { hydrate, save, undo, redo, chooseModel, patch, setSnapshot } = useStudio()
  const [editorMode, setEditorMode] = useState<'2d' | '3d' | 'modeling'>('2d'); const [selectedFace, setSelectedFace] = useState<BoxFace>('front'); const [surface, setSurface] = useState<ArtworkSurface>('outer')
  const [twoDView, setTwoDView] = useState<'templates' | 'uv' | 'cad' | 'cad-fold'>('templates')
  const [leftTab, setLeftTab] = useState<'scene' | 'model' | 'artwork'>('model'); const [rightTab, setRightTab] = useState<'model' | 'material' | 'camera' | 'light'>('model')
  const [exportOpen, setExportOpen] = useState(false); const [importOpen, setImportOpen] = useState(false); const [modelingStartOpen, setModelingStartOpen] = useState(false); const [cadImportOpen, setCadImportOpen] = useState(false); const [cadCreateOpen, setCadCreateOpen] = useState(false); const [converting, setConverting] = useState(false); const [sceneModelingTarget, setSceneModelingTarget] = useState<{ key: string; config: CustomModelConfig; label: string } | null>(null); const [projectSaving, setProjectSaving] = useState(false); const [accountMenuOpen, setAccountMenuOpen] = useState(false); const [toast, setToast] = useState(''); const [error, setError] = useState('')
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const activeMode = editorMode
  const accountName = String(auth.user?.user_metadata?.full_name || auth.user?.email?.split('@')[0] || 'Anpack 用户')
  const accountEmail = auth.user?.email || (auth.status === 'offline' ? '当前为离线授权' : '已验证账户')
  const accountInitials = accountName.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '').slice(0, 2).toUpperCase() || 'AP'
  useEffect(() => { hydrate() }, [hydrate])
  useEffect(() => { const t = setTimeout(() => save(), 650); return () => clearTimeout(t) }, [snapshot, save])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])
  useEffect(() => {
    if (!accountMenuOpen) return
    const onPointerDown = (event: PointerEvent) => { if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false) }
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuOpen(false) }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('keydown', onEscape) }
  }, [accountMenuOpen])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (activeMode !== 'modeling' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [undo, redo, activeMode])
  const faces = TEMPLATE_META[snapshot.template].faces; const visibleFaces = surface === 'outer' ? snapshot.artwork.faces : snapshot.artwork.innerFaces
  const selectTemplate = (template: Exclude<PackagingTemplate, 'custom'>) => { setSceneModelingTarget(null); patch('template', template); const type: ProceduralModelType = template === 'bottleLabel' ? 'bottle' : template === 'canLabel' ? 'can' : template === 'pouch' || template === 'shoppingBag' ? 'pouch' : 'box'; if (snapshot.model.type !== type) chooseModel(type); const nextFace = TEMPLATE_META[template].faces[0]; if (nextFace) setSelectedFace(nextFace) }
  const selectModel = (type: ProceduralModelType) => { setSceneModelingTarget(null); chooseModel(type); patch('template', type === 'bottle' ? 'bottleLabel' : type === 'can' ? 'canLabel' : type === 'pouch' ? 'pouch' : 'carton') }
  const activateCustomAsset = (asset: ModelAssetRecord) => {
    const studio = useStudio.getState(); const next = structuredClone(studio.snapshot); next.model = modelAssetToConfig(asset); next.template = 'custom'; studio.setSnapshot(next); setSceneModelingTarget(null); setImportOpen(false); setModelingStartOpen(false); setEditorMode('modeling'); setToast('模型已准备好，可开始编辑')
  }
  const activateSceneImportedAsset = (asset: ModelAssetRecord) => {
    if (!sceneModelingTarget) { activateCustomAsset(asset); return }
    const config = modelAssetToConfig(asset); const studio = useStudio.getState(); const next = structuredClone(studio.snapshot)
    next.scene.objectAssets = { ...next.scene.objectAssets, [sceneModelingTarget.key]: config }; studio.setSnapshot(next)
    setSceneModelingTarget({ ...sceneModelingTarget, config }); setImportOpen(false); setEditorMode('modeling'); setToast('导入模型已替换当前模板对象')
  }
  const convertCurrentModel = async () => {
    if (snapshot.model.type === 'custom') { setModelingStartOpen(false); setEditorMode('modeling'); return }
    if (converting) return
    setConverting(true)
    try {
      if (!window.__packshotExportProductGlb) { setEditorMode('3d'); await new Promise(resolve => setTimeout(resolve, 420)) }
      if (!window.__packshotExportProductGlb) throw new Error('3D 模型尚未准备完成，请稍后重试')
      const glb = await window.__packshotExportProductGlb(); const root = await parseModelGlb(glb)
      const targetHeight = snapshot.model.type === 'box' ? (snapshot.template === 'mailer' ? snapshot.model.depth : snapshot.model.height) : snapshot.model.height
      const asset = await createModelAsset({ root, name: `${TEMPLATE_META[snapshot.template].name}-可编辑模型`, sourceFormat: 'procedural', targetHeightMm: targetHeight })
      activateCustomAsset(asset)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '转换可编辑网格失败') }
    finally { setConverting(false) }
  }
  const createBlankModel = async () => {
    if (converting) return; setConverting(true)
    try {
      const root = new THREE.Group(); root.name = '新建模型'
      const material = new THREE.MeshPhysicalMaterial({ name: '基础材质', color: '#d8d2c8', roughness: .58, metalness: 0, clearcoat: .12 })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2, 1, 1, 1), material); mesh.name = '立方体'; mesh.position.y = 1; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh)
      const asset = await createModelAsset({ root, name: '未命名包装模型', sourceFormat: 'procedural', targetHeightMm: 180 })
      activateCustomAsset(asset)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建模型失败') }
    finally { setConverting(false) }
  }
  const editSceneObject = async (object: SceneObjectDescriptor) => {
    if (converting) return
    if (object.kind === 'product') {
      setSceneModelingTarget(null)
      if (snapshot.model.type === 'custom') { setEditorMode('modeling'); return }
      await convertCurrentModel(); return
    }
    setConverting(true)
    try {
      const template = getSceneTemplate(snapshot.scene.templateId || snapshot.scene.preset); const key = sceneObjectAssetKey(template.id, object.id)
      let config = snapshot.scene.objectAssets[key]
      if (!config) {
        if (!window.__packshotExportSceneObjectGlb) throw new Error('模板模型尚未准备完成，请稍后重试')
        const glb = await window.__packshotExportSceneObjectGlb(object.id); const root = await parseModelGlb(glb)
        const asset = await createModelAsset({ root, name: `${template.name}-${object.label}`, sourceFormat: 'procedural', preserveTransform: true })
        config = modelAssetToConfig(asset)
        const studio = useStudio.getState(); const next = structuredClone(studio.snapshot); next.scene.objectAssets = { ...next.scene.objectAssets, [key]: config }; studio.setSnapshot(next)
      }
      setSceneModelingTarget({ key, config, label: `${template.name} / ${object.label}` }); setEditorMode('modeling'); setToast(`${object.label} 已同步到建模编辑器`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '模板对象转换失败') }
    finally { setConverting(false) }
  }
  const storeProject = async (saveAs: boolean) => {
    if (projectSaving) return; setProjectSaving(true)
    try { await save(); const result = await saveProjectFile(useStudio.getState().snapshot, saveAs); setToast(result.fallback ? `项目已下载为 ${result.name}` : `项目已储存到 ${result.name}`) }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '项目储存失败') }
    finally { setProjectSaving(false) }
  }
  const openProject = async () => { try { const result = await openProjectFile(); setSnapshot(result.snapshot); setTwoDView(result.snapshot.model.type === 'custom' ? 'uv' : 'templates'); setEditorMode('2d'); setToast(`已打开 ${result.name}`) } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '项目打开失败') } }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Box size={20} /></span><b>Anpack</b></div><div className="project-name"><input value={snapshot.projectName} onChange={e => patch('projectName', e.target.value)} /><ChevronDown size={14} /></div><div className="history"><button disabled={activeMode === 'modeling' || !past.length} onClick={undo} aria-label="撤销"><Undo2 size={17} /></button><button disabled={activeMode === 'modeling' || !future.length} onClick={redo} aria-label="重做"><Redo2 size={17} /></button><span>自动保存</span></div><div className="mode-switch mode-switch-three"><button className={activeMode === '2d' ? 'active' : ''} onClick={() => { setTwoDView('templates'); setEditorMode('2d') }}>2D 展开设计</button><button className={activeMode === '3d' ? 'active' : ''} onClick={() => setEditorMode('3d')}>3D 效果预览</button><button className={activeMode === 'modeling' ? 'active' : ''} onClick={() => sceneModelingTarget || snapshot.model.type === 'custom' ? setEditorMode('modeling') : setModelingStartOpen(true)}><Wrench size={13} />建模编辑</button></div><div className="top-actions"><div className="project-file-actions"><button className="ghost" onClick={() => void openProject()}><FolderOpen size={14} />打开</button><button className="ghost" disabled={projectSaving} onClick={() => void storeProject(false)}><Save size={15} />{projectSaving ? '储存中' : '储存'}</button><button className="ghost save-as" disabled={projectSaving} onClick={() => void storeProject(true)}>另存为</button></div><button className="primary" onClick={() => { setEditorMode('3d'); setExportOpen(true) }}><Download size={15} />渲染导出</button><div className="account-menu-wrap" ref={accountMenuRef}><button className="avatar" title="账户菜单" aria-label="账户菜单" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}>{accountInitials}</button>{accountMenuOpen && <div className="account-popover" role="menu"><div className="account-popover-head"><span><UserRound size={17} /></span><div><b>{accountName}</b><small>{accountEmail}</small></div></div><div className="account-session"><i />{auth.status === 'offline' ? `离线授权至 ${auth.offlineUntil ? new Date(auth.offlineUntil).toLocaleDateString('zh-CN') : '本地有效期'}` : '账号已验证 · 项目仅保存在本机'}</div><button className="account-signout" role="menuitem" onClick={() => { setAccountMenuOpen(false); void auth.signOut() }}><LogOut size={15} />退出登录</button></div>}</div></div></header>
    {activeMode === '2d' && twoDView === 'cad-fold' && snapshot.cadDieline?.foldMapping ? <CadFoldWorkspace config={snapshot.cadDieline} onDieline={() => setTwoDView('cad')} onError={setError} /> : activeMode === '2d' && twoDView === 'cad' && snapshot.cadDieline ? <CadDielineWorkspace config={snapshot.cadDieline} onLibrary={() => setTwoDView('templates')} onReimport={() => setCadImportOpen(true)} onFold={() => setTwoDView('cad-fold')} onError={setError} /> : activeMode === '2d' && snapshot.model.type === 'custom' && twoDView === 'uv' ? <CustomUVWorkspace config={snapshot.model} onModeling={() => setEditorMode('modeling')} onPackagingLibrary={() => setTwoDView('templates')} /> : activeMode === '2d' ? <main className="two-d-workspace">
      <aside className="two-d-left"><div className="two-d-heading"><b>包装结构库</b><span>选择标准盒型、创建结构或导入CAD刀模</span></div><button className="cad-import-entry" onClick={() => setCadImportOpen(true)}><span><FileUp size={20} /></span><div><b>导入 CAD</b><small>上传盒型结构个性化设计 · DXF</small></div><i>本地解析</i></button><button className="cad-create-entry" onClick={() => setCadCreateOpen(true)}><span><PackageOpen size={20} /></span><div><b>创建包装结构</b><small>绘制裁切线、折叠线与出血线</small></div><i>新建</i></button>{snapshot.cadDieline && <button className="cad-existing-entry" onClick={() => setTwoDView('cad')}><span><Check size={15} /></span><div><b>我的结构：{snapshot.cadDieline.name}</b><small>{Number(snapshot.cadDieline.widthMm.toFixed(1))} × {Number(snapshot.cadDieline.heightMm.toFixed(1))} mm · {snapshot.cadDieline.layers.length} 图层</small></div><i>打开</i></button>}{snapshot.model.type === 'custom' && <button className="custom-uv-entry" onClick={() => setTwoDView('uv')}><span><Wrench size={18} /></span><div><b>当前自定义模型 UV</b><small>{snapshot.model.name} · 查看贴图展开</small></div><i>进入</i></button>}<div className="template-grid">{(Object.keys(TEMPLATE_META).filter(template => template !== 'custom') as Exclude<PackagingTemplate, 'custom'>[]).map(template => <button key={template} className={snapshot.template === template ? 'selected' : ''} onClick={() => selectTemplate(template)}><span className={`template-icon template-${template}`}><PackageOpen size={21} /></span><b>{TEMPLATE_META[template].name}</b><small>{TEMPLATE_META[template].category}</small>{snapshot.template === template && <Check size={13} />}</button>)}</div>{faces.length > 0 && <><FieldTitle hint={`${faces.filter(face => visibleFaces[face].url).length}/${faces.length}`}>{surface === 'outer' ? '外侧' : '内侧'}图案面</FieldTitle><div className="face-list">{faces.map(face => <button key={face} className={selectedFace === face ? 'selected' : ''} onClick={() => setSelectedFace(face)}><span className={`face-swatch ${visibleFaces[face].url ? 'filled' : ''}`} style={visibleFaces[face].url ? { backgroundImage: `url(${visibleFaces[face].url})` } : undefined} /><div><b>{FACE_LABELS[face]}</b><small>{visibleFaces[face].url ? visibleFaces[face].name : '未添加图案'}</small></div>{visibleFaces[face].url ? <Check size={14} /> : <ImagePlus size={14} />}</button>)}</div></>}<div className="tip-card"><Lightbulb size={17} /><div><b>{snapshot.model.type === 'custom' ? '结构库仍然可用' : '操作提示'}</b><span>{snapshot.model.type === 'custom' ? '选择下面任意包装结构即可切换回参数化模型；当前自定义模型可通过撤销恢复。' : '直插纸盒包含4个盒身面、8个上下插舌和1个粘合舌，共13个可编辑印刷面。'}</span></div></div></aside>
      <section className="two-d-stage"><div className="stage-header"><span><i className="live-dot" />{TEMPLATE_META[snapshot.template].name}展开图</span><div className="surface-switch"><button className={surface === 'outer' ? 'active' : ''} onClick={() => setSurface('outer')}>外侧</button><button className={surface === 'inner' ? 'active' : ''} onClick={() => setSurface('inner')}>内侧</button></div><span>虚线为折叠线 · 实线为裁切线</span></div><DielineEditor selectedFace={selectedFace} surface={surface} onSelectFace={setSelectedFace} /></section>
      <aside className="two-d-right"><div className="two-d-tabs"><button className="active">尺寸与图案</button></div><div className="properties">{snapshot.model.type === 'custom' ? <><FieldTitle hint="自定义模型">选择一个包装结构</FieldTitle><div className="custom-template-empty"><PackageOpen size={28} /><b>包装结构库没有被删除</b><span>从左侧选择纸盒、飞机盒、礼盒、手提袋、软袋或标签结构，即可恢复对应的参数尺寸与展开图。</span><button className="primary wide" onClick={() => setTwoDView('uv')}><Wrench size={14} />查看当前模型UV</button></div></> : <><FieldTitle hint="当前结构">{TEMPLATE_META[snapshot.template].name}</FieldTitle><ModelParameters /><div className="panel-divider" /><FaceEditorPanel face={selectedFace} surface={surface} onError={setError} /></>}</div></aside>
    </main> : activeMode === 'modeling' && (sceneModelingTarget || snapshot.model.type === 'custom') ? <ModelingWorkspace config={sceneModelingTarget?.config ?? snapshot.model as CustomModelConfig} sceneObjectKey={sceneModelingTarget?.key} contextLabel={sceneModelingTarget?.label} onImport={() => setImportOpen(true)} onOpenUv={() => { setTwoDView('uv'); setEditorMode('2d') }} /> : <main className="workspace"><aside className="left-sidebar"><nav className="rail"><button className={leftTab === 'scene' ? 'active' : ''} onClick={() => setLeftTab('scene')}><span className="grid-icon" />场景</button><button className={leftTab === 'model' ? 'active' : ''} onClick={() => setLeftTab('model')}><Box size={21} />模型</button><button className={leftTab === 'artwork' ? 'active' : ''} onClick={() => setLeftTab('artwork')}><Upload size={21} />标签</button><button className="help"><CircleHelp size={20} />帮助</button></nav><section className="library">{leftTab === 'model' && <ModelLibrary onSelect={selectModel} onImport={() => setImportOpen(true)} onConvert={convertCurrentModel} converting={converting} />}{leftTab === 'artwork' && <ArtworkPanel onError={setError} />}{leftTab === 'scene' && <SceneLibrary onRender={() => setExportOpen(true)} />}</section></aside><section className="stage"><div className="stage-header"><span><i className="live-dot" />实时 3D 预览</span><span>拖拽旋转 · 滚轮缩放 · 右键平移</span></div><div className="canvas-wrap"><StudioScene /><div className="canvas-badge">HDR · PBR 实时预览</div><div className="canvas-tools"><button onClick={() => patch('camera', { position: [5.8, 4.1, 7.2], target: [0, 1.35, 0] })}><RotateCcw size={15} />重置视角</button><span>{snapshot.model.type === 'box' ? `${snapshot.model.width} × ${snapshot.model.height} × ${snapshot.model.depth} mm` : snapshot.model.type === 'custom' ? `${snapshot.model.name} · ${snapshot.model.triangleCount.toLocaleString()} 面` : '参数化模型'}</span></div></div></section><aside className="right-panel"><nav>{([['model', '模型'], ['material', '材质'], ['camera', '视角'], ['light', '光影']] as const).map(([key, label]) => <button key={key} onClick={() => setRightTab(key)} className={rightTab === key ? 'active' : ''}>{label}</button>)}</nav><div className="properties">{rightTab === 'model' && <><SceneObjectEditor onModelObject={object => void editSceneObject(object)} busy={converting} /><FieldTitle hint={snapshot.model.type.toUpperCase()}>包装模型尺寸</FieldTitle><ModelParameters /><details className="scene-group-adjustments"><summary>包装组整体调整</summary><div><Slider label="整体缩放" value={snapshot.scene.productScale} min={.45} max={1.6} step={.05} onChange={v => patch('scene', { productScale: v })} /><Slider label="水平旋转" value={snapshot.scene.productRotation[1] * 180 / Math.PI} min={-180} max={180} step={1} unit="°" onChange={v => patch('scene', { productRotation: [snapshot.scene.productRotation[0], v * Math.PI / 180, snapshot.scene.productRotation[2]] })} /><Slider label="左右" value={snapshot.scene.productPosition[0]} min={-3} max={3} step={.05} onChange={v => patch('scene', { productPosition: [v, snapshot.scene.productPosition[1], snapshot.scene.productPosition[2]] })} /><Slider label="上下" value={snapshot.scene.productPosition[1]} min={-1} max={3} step={.05} onChange={v => patch('scene', { productPosition: [snapshot.scene.productPosition[0], v, snapshot.scene.productPosition[2]] })} /><Slider label="前后" value={snapshot.scene.productPosition[2]} min={-3} max={3} step={.05} onChange={v => patch('scene', { productPosition: [snapshot.scene.productPosition[0], snapshot.scene.productPosition[1], v] })} /></div></details></>}{rightTab === 'material' && <MaterialPanel />}{rightTab === 'camera' && <CameraPanel />}{rightTab === 'light' && <LightingPanel />}</div></aside></main>}
    {modelingStartOpen && snapshot.model.type !== 'custom' && <ModelingStartDialog currentName={TEMPLATE_META[snapshot.template].name} busy={converting} onClose={() => setModelingStartOpen(false)} onConvert={() => void convertCurrentModel()} onCreate={() => void createBlankModel()} onImport={() => { setModelingStartOpen(false); setImportOpen(true) }} />}{importOpen && <ModelImportDialog onClose={() => setImportOpen(false)} onImported={sceneModelingTarget ? activateSceneImportedAsset : activateCustomAsset} />}{cadImportOpen && <CadImportDialog onClose={() => setCadImportOpen(false)} onImported={config => { patch('cadDieline', config); setCadImportOpen(false); setTwoDView('cad'); setEditorMode('2d'); setToast('CAD盒型结构已导入') }} />}{cadCreateOpen && <CadCreateDialog onClose={() => setCadCreateOpen(false)} onCreated={config => { patch('cadDieline', config); setCadCreateOpen(false); setTwoDView('cad'); setEditorMode('2d'); setToast('包装结构画布已创建') }} />}{exportOpen && <ExportDialog onClose={() => setExportOpen(false)} onToast={setToast} />}{toast && <div className="toast success"><Check size={16} />{toast}</div>}{error && <div className="toast error"><X size={16} />{error}<button onClick={() => setError('')}>关闭</button></div>}<div className="narrow-warning">Anpack 需要至少 1180px 的桌面空间以获得完整编辑体验。</div>
  </div>
}
