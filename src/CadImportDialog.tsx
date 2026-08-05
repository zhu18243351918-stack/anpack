import { AlertTriangle, CheckCircle2, FileUp, Layers3, Ruler, X } from 'lucide-react'
import { useState } from 'react'
import { CAD_UNIT_OPTIONS, parseCadDxf } from './cadImport'
import type { CadDielineConfig } from './types'

export default function CadImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (config: CadDielineConfig) => void }) {
  const [source, setSource] = useState(''); const [fileName, setFileName] = useState(''); const [preview, setPreview] = useState<CadDielineConfig | null>(null)
  const [error, setError] = useState(''); const [reading, setReading] = useState(false)
  const choose = async (file?: File) => {
    if (!file) return
    if (!/\.dxf$/i.test(file.name)) return setError('CAD导入当前支持 DXF 文件，请从 AutoCAD、ArtiosCAD 或 Illustrator 导出 ASCII DXF')
    if (file.size > 25 * 1024 * 1024) return setError('DXF超过25MB，请删除无关标注、填充或重复路径后重试')
    setReading(true); setError('')
    try {
      const text = await file.text(); if (text.includes('\u0000')) throw new Error('暂不支持二进制DXF，请另存为ASCII DXF R12/R2000')
      const result = parseCadDxf(text, file.name); setSource(text); setFileName(file.name); setPreview(result)
    } catch (reason) { setPreview(null); setError(reason instanceof Error ? reason.message : 'DXF读取失败') }
    finally { setReading(false) }
  }
  const changeUnit = (unit: CadDielineConfig['unit']) => {
    if (!source) return
    try { setPreview(parseCadDxf(source, fileName, unit)); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '单位转换失败') }
  }
  return <div className="modal-backdrop"><section className="cad-import-modal" role="dialog" aria-modal="true" aria-label="导入CAD盒型结构">
    <header><div><span className="cad-modal-icon"><FileUp size={20} /></span><div><b>导入 CAD 盒型结构</b><small>上传个性化刀模 · 全程本地解析</small></div></div><button className="icon-button" onClick={onClose} aria-label="关闭CAD导入"><X size={18} /></button></header>
    <div className="cad-import-body"><label className={`cad-dropzone ${preview ? 'has-file' : ''}`}><FileUp size={28} /><b>{reading ? '正在解析DXF…' : preview ? preview.name : '选择或拖入 DXF 文件'}</b><span>{preview ? `${preview.paths.length.toLocaleString()} 条二维路径 · ${preview.layers.length} 个图层` : '支持 AutoCAD ASCII DXF R12 / R2000 · 最大25MB'}</span><input hidden type="file" accept=".dxf,application/dxf,image/vnd.dxf" onChange={event => void choose(event.target.files?.[0])} /></label>
      {error && <div className="import-error"><AlertTriangle size={15} />{error}</div>}
      {preview && <><div className="cad-import-summary"><span><Ruler size={16} /><div><b>{Number(preview.widthMm.toFixed(2))} × {Number(preview.heightMm.toFixed(2))} mm</b><small>刀模外接尺寸</small></div></span><span><Layers3 size={16} /><div><b>{preview.layers.length} 个图层</b><small>{preview.paths.length.toLocaleString()} 条有效路径</small></div></span><span><CheckCircle2 size={16} /><div><b>二维线稿可用</b><small>裁切线与折叠线可调整</small></div></span></div><label className="cad-unit-select"><span>CAD 文件单位</span><select value={preview.unit} onChange={event => changeUnit(event.target.value as CadDielineConfig['unit'])}>{CAD_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="cad-layer-preview"><b>图层识别</b><div>{preview.layers.slice(0, 10).map(layer => <span key={layer.name}><i className={`role-${layer.role}`} />{layer.name}<small>{layer.entityCount} 条</small></span>)}</div>{preview.layers.length > 10 && <em>另有 {preview.layers.length - 10} 个图层，导入后可逐层设置</em>}</div>{preview.warnings.length > 0 && <div className="cad-warning-list">{preview.warnings.map(message => <span key={message}><AlertTriangle size={13} />{message}</span>)}</div>}<div className="cad-import-note"><b>当前导入范围</b><span>DXF会作为可编辑的2D盒型刀模导入，可重新指定裁切线、折叠线、出血线并铺设完整包装图案。通用CAD无法可靠自动判断每个折叠面，3D折叠需要后续进行面板映射。</span></div></>}
    </div><footer><button className="ghost" onClick={onClose}>取消</button><button className="primary" disabled={!preview || reading} onClick={() => preview && onImported(preview)}>导入并打开刀模</button></footer>
  </section></div>
}

