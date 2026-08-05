import { useRef, useState } from 'react'
import { AlertTriangle, Box, Check, FileArchive, LoaderCircle, Upload, X } from 'lucide-react'
import { createModelAsset } from './modelAssets'
import { loadImportedFiles } from './modelImport'
import type { ModelAssetRecord } from './types'

export default function ModelImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (asset: ModelAssetRecord) => void }) {
  const input = useRef<HTMLInputElement>(null); const [files, setFiles] = useState<File[]>([]); const [targetHeight, setTargetHeight] = useState(180)
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const [summary, setSummary] = useState<{ name: string; format: string; dependencyCount: number; warnings: string[] } | null>(null)
  const choose = (selected: FileList | null) => { const next = selected ? Array.from(selected) : []; setFiles(next); setSummary(null); setError('') }
  const importModel = async () => {
    if (!files.length || busy) return
    setBusy(true); setError(''); setProgress(2); setMessage('准备导入')
    try {
      const result = await loadImportedFiles(files, (value, text) => { setProgress(value); setMessage(text) })
      setSummary({ name: result.name, format: result.format.toUpperCase(), dependencyCount: result.dependencies.length, warnings: result.warnings })
      setProgress(82); setMessage('生成内部 GLB 工作模型')
      const asset = await createModelAsset({ root: result.root, name: result.name, sourceFormat: result.format, dependencies: result.dependencies, warnings: result.warnings, targetHeightMm: targetHeight })
      setProgress(100); setMessage('导入完成'); onImported(asset)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '模型导入失败'); setProgress(0) }
    finally { setBusy(false) }
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  return <div className="modal-backdrop"><div className="model-import-modal">
    <header><div><span className="modal-icon"><Box size={19} /></span><div><b>导入自定义3D模型</b><small>文件只在本机浏览器中解析，不会上传</small></div></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>
    <div className="model-import-body">
      <button className={`model-dropzone ${files.length ? 'has-files' : ''}`} onClick={() => input.current?.click()} disabled={busy}>
        {files.length ? <FileArchive size={28} /> : <Upload size={28} />}<b>{files.length ? `已选择 ${files.length} 个文件` : '选择模型及其依赖文件'}</b><span>{files.length ? `${(bytes / 1024 / 1024).toFixed(1)} MB · ${files.map(file => file.name).slice(0, 3).join('、')}` : 'GLB / glTF / FBX / OBJ + MTL + 纹理，或 ZIP 文件包'}</span>
      </button>
      <input ref={input} hidden type="file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.bin,.zip,.png,.jpg,.jpeg,.webp,.ktx2,.basis,.tga,.bmp,.hdr,.exr,.blend,.c4d" onChange={event => choose(event.target.files)} />
      <div className="import-settings"><label><span>导入后的产品高度</span><span><input type="number" min={10} max={3000} value={targetHeight} onChange={event => setTargetHeight(Math.max(10, Number(event.target.value) || 180))} /> mm</span></label><small>模型会自动转换为 Y 轴向上、底部落地并居中；之后仍可在建模模式中缩放。</small></div>
      {summary && <div className="import-summary"><Check size={16} /><div><b>{summary.name}</b><span>{summary.format} · {summary.dependencyCount} 个相关文件</span></div></div>}
      {(summary?.warnings.length ?? 0) > 0 && <div className="import-warnings"><AlertTriangle size={15} /><div>{summary!.warnings.map(warning => <span key={warning}>{warning}</span>)}</div></div>}
      {error && <div className="import-error"><AlertTriangle size={15} />{error}</div>}
      {busy && <div className="import-progress"><div><span>{message}</span><b>{Math.round(progress)}%</b></div><i><span style={{ width: `${progress}%` }} /></i></div>}
      <details className="dcc-guide"><summary>从 Blender / Cinema 4D 导出</summary><div><b>Blender</b><span>文件 → 导出 → glTF 2.0，格式选择 GLB，并勾选材质与纹理。</span><b>Cinema 4D</b><span>文件 → 导出 → glTF/GLB；如果材质兼容性较复杂，也可以导出 FBX 并附带纹理。</span><small>网页端不直接打开 .blend 或 .c4d 原生工程文件。</small></div></details>
    </div>
    <footer><button className="ghost" onClick={onClose} disabled={busy}>取消</button><button className="primary" disabled={!files.length || busy} onClick={importModel}>{busy ? <><LoaderCircle className="spin-icon" size={15} />正在导入</> : <><Upload size={15} />导入并开始建模</>}</button></footer>
  </div></div>
}

