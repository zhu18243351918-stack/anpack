import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { AlertTriangle, Check, FlipHorizontal2, Layers3, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { detectCadPanels } from './cadPanels'
import { useStudio } from './store'
import type { CadDielineConfig, CadFoldEdge, CadFoldMapping, CadPanel } from './types'

const SCALE = .012

function panelGeometry(panel: CadPanel, config: CadDielineConfig) {
  const centerX = (config.bounds.minX + config.bounds.maxX) / 2; const centerY = (config.bounds.minY + config.bounds.maxY) / 2
  const shape = new THREE.Shape(); panel.points.forEach((point, index) => { const x = (point.x - centerX) * SCALE; const y = (point.y - centerY) * SCALE; if (index) shape.lineTo(x, y); else shape.moveTo(x, y) }); shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .018, bevelEnabled: false, curveSegments: 3 }); const position = geometry.getAttribute('position'); const uv = new Float32Array(position.count * 2)
  for (let index = 0; index < position.count; index += 1) { const sourceX = position.getX(index) / SCALE + centerX; const sourceY = position.getY(index) / SCALE + centerY; uv[index * 2] = (sourceX - config.bounds.minX) / Math.max(config.widthMm, .001); uv[index * 2 + 1] = (sourceY - config.bounds.minY) / Math.max(config.heightMm, .001) }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.computeVertexNormals(); return geometry
}

function foldTransforms(config: CadDielineConfig, mapping: CadFoldMapping) {
  const centerX = (config.bounds.minX + config.bounds.maxX) / 2; const centerY = (config.bounds.minY + config.bounds.maxY) / 2
  const result = new Map<string, THREE.Matrix4>(); result.set(mapping.rootPanelId, new THREE.Matrix4())
  const adjacency = new Map<string, { fold: CadFoldEdge; next: string }[]>(); mapping.panels.forEach(panel => adjacency.set(panel.id, [])); mapping.folds.forEach(fold => { adjacency.get(fold.panelA)?.push({ fold, next: fold.panelB }); adjacency.get(fold.panelB)?.push({ fold, next: fold.panelA }) })
  const queue = [mapping.rootPanelId]; const seen = new Set(queue)
  while (queue.length) {
    const parentId = queue.shift()!; const parentMatrix = result.get(parentId)!
    for (const link of adjacency.get(parentId) ?? []) {
      if (seen.has(link.next)) continue; seen.add(link.next); queue.push(link.next)
      const start = new THREE.Vector3((link.fold.start.x - centerX) * SCALE, (link.fold.start.y - centerY) * SCALE, 0); const end = new THREE.Vector3((link.fold.end.x - centerX) * SCALE, (link.fold.end.y - centerY) * SCALE, 0); const axis = end.clone().sub(start).normalize()
      const traversal = link.fold.panelA === parentId ? 1 : -1; const angle = THREE.MathUtils.degToRad(link.fold.angle * mapping.progress * link.fold.direction * traversal)
      const rotation = new THREE.Matrix4().makeRotationAxis(axis, angle); const local = new THREE.Matrix4().makeTranslation(start.x, start.y, start.z).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-start.x, -start.y, -start.z))
      result.set(link.next, parentMatrix.clone().multiply(local))
    }
  }
  mapping.panels.forEach(panel => { if (!result.has(panel.id)) result.set(panel.id, new THREE.Matrix4()) }); return result
}

function FoldScene({ config, mapping, selectedPanel, onSelect }: { config: CadDielineConfig; mapping: CadFoldMapping; selectedPanel: string; onSelect: (id: string) => void }) {
  const transforms = useMemo(() => foldTransforms(config, mapping), [config, mapping]); const geometries = useMemo(() => new Map(mapping.panels.map(panel => [panel.id, panelGeometry(panel, config)])), [mapping.panels, config]); const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let active = true
    if (!config.artwork.url) return undefined
    new THREE.TextureLoader().load(config.artwork.url, loaded => { if (!active) return loaded.dispose(); loaded.colorSpace = THREE.SRGBColorSpace; loaded.wrapS = loaded.wrapT = config.artwork.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; loaded.center.set(.5, .5); loaded.repeat.setScalar(1 / Math.max(config.artwork.scale, .01)); loaded.rotation = THREE.MathUtils.degToRad(config.artwork.rotation); loaded.offset.set(config.artwork.offsetX, config.artwork.offsetY); loaded.anisotropy = 8; loaded.needsUpdate = true; setTexture(loaded) })
    return () => { active = false }
  }, [config.artwork])
  useEffect(() => () => { geometries.forEach(geometry => geometry.dispose()); texture?.dispose() }, [geometries, texture])
  return <><color attach="background" args={['#20232a']} /><ambientLight intensity={1.1} /><directionalLight castShadow position={[4, 7, 6]} intensity={3.2} shadow-mapSize={[2048, 2048]} /><directionalLight position={[-4, 2, 3]} intensity={1.1} color="#a9c9ff" />{mapping.panels.map(panel => <mesh key={panel.id} geometry={geometries.get(panel.id)} matrix={transforms.get(panel.id)} matrixAutoUpdate={false} castShadow receiveShadow onPointerDown={event => { event.stopPropagation(); onSelect(panel.id) }}><meshPhysicalMaterial map={texture} color={texture ? '#ffffff' : panel.id === mapping.rootPanelId ? '#f1dcc0' : '#e7e0d5'} roughness={.72} clearcoat={.06} emissive={panel.id === selectedPanel ? '#4b2410' : '#000000'} emissiveIntensity={panel.id === selectedPanel ? .22 : 0} side={THREE.DoubleSide} /></mesh>)}<Grid infiniteGrid fadeDistance={30} sectionColor="#66707b" cellColor="#383e47" position={[0, -2.2, -1.2]} rotation={[Math.PI / 2, 0, 0]} /><OrbitControls makeDefault enableDamping dampingFactor={.08} minDistance={2} maxDistance={22} /></>
}

export default function CadFoldWorkspace({ config, onDieline, onError }: { config: CadDielineConfig; onDieline: () => void; onError: (message: string) => void }) {
  const patch = useStudio(s => s.patch); const mapping = config.foldMapping!; const [selectedPanel, setSelectedPanel] = useState(mapping.rootPanelId); const [selectedFold, setSelectedFold] = useState(mapping.folds[0]?.id ?? '')
  const activeFold = mapping.folds.find(fold => fold.id === selectedFold) ?? mapping.folds[0]
  const updateMapping = (value: Partial<CadFoldMapping>) => patch('cadDieline', { ...config, foldMapping: { ...mapping, ...value } })
  const updateFold = (id: string, value: Partial<CadFoldEdge>) => updateMapping({ folds: mapping.folds.map(fold => fold.id === id ? { ...fold, ...value } : fold) })
  const redetect = () => { try { const next = detectCadPanels(config); patch('cadDieline', { ...config, foldMapping: next }); setSelectedPanel(next.rootPanelId); setSelectedFold(next.folds[0]?.id ?? '') } catch (reason) { onError(reason instanceof Error ? reason.message : '面板识别失败') } }
  return <main className="cad-fold-workspace"><aside className="cad-fold-left"><div className="two-d-heading"><b>面板与折叠关系</b><span>{mapping.panels.length} 个面板 · {mapping.folds.length} 条折叠连接</span></div><div className="fold-panel-list">{mapping.panels.map(panel => <button key={panel.id} className={selectedPanel === panel.id ? 'selected' : ''} onClick={() => setSelectedPanel(panel.id)}><span>{panel.id === mapping.rootPanelId ? <Check size={13} /> : panel.name.replace(/[^0-9]/g, '') || '·'}</span><div><b>{panel.name}</b><small>{Number(panel.area.toFixed(1)).toLocaleString()} mm²</small></div>{panel.id === mapping.rootPanelId && <i>基准</i>}</button>)}</div><button className="primary wide set-root" disabled={!selectedPanel || selectedPanel === mapping.rootPanelId} onClick={() => updateMapping({ rootPanelId: selectedPanel })}>设为折叠基准面</button><div className="fold-warning-list">{mapping.warnings.map(warning => <span key={warning}><AlertTriangle size={13} />{warning}</span>)}</div><div className="cad-left-actions"><button className="ghost" onClick={onDieline}><Layers3 size={14} />返回刀模</button><button className="ghost" onClick={redetect}><RefreshCw size={14} />重新识别</button></div></aside><section className="cad-fold-stage"><header><span><i className="live-dot" />辅助3D折叠预览</span><span>拖拽旋转 · 滚轮缩放 · 点击面板选择</span></header><div className="cad-fold-canvas"><Canvas shadows dpr={[1, 2]} camera={{ position: [4.6, 3.6, 7.5], fov: 38 }} gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}><FoldScene key={config.artwork.url ?? 'no-artwork'} config={config} mapping={mapping} selectedPanel={selectedPanel} onSelect={setSelectedPanel} /></Canvas><div className="fold-progress-badge">折叠 {Math.round(mapping.progress * 100)}%</div></div></section><aside className="cad-fold-right"><div className="two-d-tabs"><button className="active">折叠参数</button></div><div className="properties"><div className="fold-summary"><RotateCcw size={18} /><div><b>辅助折叠映射</b><span>以识别出的相邻面板和折叠线建立层级关系</span></div></div><label className="uv-control"><span><b>整体折叠进度</b><em>{Math.round(mapping.progress * 100)}%</em></span><input type="range" min="0" max="1" step=".01" value={mapping.progress} onChange={event => updateMapping({ progress: Number(event.target.value) })} /></label><div className="fold-presets"><button onClick={() => updateMapping({ progress: 0 })}>展开 0°</button><button onClick={() => updateMapping({ progress: .5 })}>半折叠</button><button onClick={() => updateMapping({ progress: 1 })}>完全折叠</button></div><div className="panel-divider" /><label className="select-row"><span>折叠连接</span><select value={activeFold?.id ?? ''} disabled={!mapping.folds.length} onChange={event => setSelectedFold(event.target.value)}>{mapping.folds.map((fold, index) => <option key={fold.id} value={fold.id}>折叠线 {index + 1}</option>)}</select></label>{activeFold ? <><label className="uv-control"><span><b>目标角度</b><em>{activeFold.angle}°</em></span><input type="range" min="0" max="180" step="1" value={activeFold.angle} onChange={event => updateFold(activeFold.id, { angle: Number(event.target.value) })} /></label><label className="switch-row"><span>反转折叠方向</span><button className={`switch ${activeFold.direction < 0 ? 'on' : ''}`} onClick={() => updateFold(activeFold.id, { direction: activeFold.direction === 1 ? -1 : 1 })}><i /></button></label><button className="ghost wide" onClick={() => updateFold(activeFold.id, { direction: activeFold.direction === 1 ? -1 : 1 })}><FlipHorizontal2 size={14} />翻转当前折叠方向</button><div className="fold-edge-meta"><span>连接 {mapping.panels.find(panel => panel.id === activeFold.panelA)?.name}</span><span>与 {mapping.panels.find(panel => panel.id === activeFold.panelB)?.name}</span></div></> : <div className="modeler-empty">没有可调整的折叠连接</div>}<div className="cad-3d-note"><AlertTriangle size={15} /><div><b>辅助识别结果需要校对</b><span>通用DXF通常没有面板语义。请检查基准面、折叠角度与方向，再用于后续3D建模。</span></div></div></div></aside></main>
}
