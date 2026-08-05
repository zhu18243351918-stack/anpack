import { DraftingCompass, LayoutTemplate, X } from 'lucide-react'
import { useState } from 'react'
import type { CadDielineConfig, CadPathEntity } from './types'

function starterPaths(kind: 'blank' | 'cross', width: number, height: number): CadPathEntity[] {
  if (kind === 'blank') return []
  const panelW = width / 4; const panelH = height / 3
  return [
    { id: crypto.randomUUID(), layer: 'CUT', role: 'cut', closed: true, points: [{ x: panelW, y: panelH }, { x: panelW * 3, y: panelH }, { x: panelW * 3, y: panelH * 2 }, { x: panelW, y: panelH * 2 }] },
    { id: crypto.randomUUID(), layer: 'FOLD', role: 'fold', closed: false, points: [{ x: panelW * 2, y: panelH }, { x: panelW * 2, y: panelH * 2 }] },
    { id: crypto.randomUUID(), layer: 'FOLD', role: 'fold', closed: false, points: [{ x: panelW, y: panelH * 1.5 }, { x: panelW * 3, y: panelH * 1.5 }] },
  ]
}

export default function CadCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (config: CadDielineConfig) => void }) {
  const [name, setName] = useState('自定义包装结构'); const [width, setWidth] = useState(500); const [height, setHeight] = useState(350); const [starter, setStarter] = useState<'blank' | 'cross'>('blank')
  const create = () => {
    const paths = starterPaths(starter, width, height)
    onCreated({ id: crypto.randomUUID(), name: name.trim() || '自定义包装结构', sourceFormat: 'created', importedAt: Date.now(), unit: 'mm', scaleToMm: 1, bounds: { minX: 0, minY: 0, maxX: width, maxY: height }, widthMm: width, heightMm: height, paths, layers: [{ name: 'CUT', role: 'cut', visible: true, entityCount: paths.filter(path => path.layer === 'CUT').length }, { name: 'FOLD', role: 'fold', visible: true, entityCount: paths.filter(path => path.layer === 'FOLD').length }, { name: 'BLEED', role: 'bleed', visible: true, entityCount: 0 }], unsupportedEntities: 0, warnings: [], artwork: { url: null, name: '', scale: 1, rotation: 0, offsetX: 0, offsetY: 0, repeat: false }, foldMapping: null })
  }
  return <div className="modal-backdrop"><section className="cad-create-modal" role="dialog" aria-modal="true" aria-label="创建包装结构"><header><div><span className="cad-modal-icon"><DraftingCompass size={20} /></span><div><b>创建包装结构</b><small>从空白画布绘制裁切线和折叠线</small></div></div><button className="icon-button" onClick={onClose} aria-label="关闭创建结构"><X size={18} /></button></header><div className="cad-create-body"><label><span>结构名称</span><input value={name} onChange={event => setName(event.target.value)} /></label><div className="cad-size-fields"><label><span>画布宽度</span><div><input type="number" min="50" max="3000" value={width} onChange={event => setWidth(Math.max(50, Math.min(3000, Number(event.target.value))))} /><i>mm</i></div></label><label><span>画布高度</span><div><input type="number" min="50" max="3000" value={height} onChange={event => setHeight(Math.max(50, Math.min(3000, Number(event.target.value))))} /><i>mm</i></div></label></div><b className="cad-starter-title">起始画布</b><div className="cad-starter-grid"><button className={starter === 'blank' ? 'selected' : ''} onClick={() => setStarter('blank')}><span className="blank-paper" /><b>空白刀模</b><small>从零开始绘制个性化结构</small></button><button className={starter === 'cross' ? 'selected' : ''} onClick={() => setStarter('cross')}><LayoutTemplate size={28} /><b>十字面板基底</b><small>预置裁切轮廓与两条折叠线</small></button></div><div className="cad-create-tip">创建后可使用直线、矩形、裁切线、折叠线和出血线工具，并导出 DXF、SVG、PDF、PNG 或 JSON。</div></div><footer><button className="ghost" onClick={onClose}>取消</button><button className="primary" onClick={create}>创建结构画布</button></footer></section></div>
}

