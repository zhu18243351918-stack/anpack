import { Box, FileUp, PackageOpen, Wrench, X } from 'lucide-react'

export default function ModelingStartDialog({ currentName, busy, onClose, onConvert, onCreate, onImport }: {
  currentName: string
  busy: boolean
  onClose: () => void
  onConvert: () => void
  onCreate: () => void
  onImport: () => void
}) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="modeling-start-modal" role="dialog" aria-modal="true" aria-labelledby="modeling-start-title">
      <header><div><span className="modal-icon"><Wrench size={18} /></span><div><b id="modeling-start-title">进入建模编辑</b><small>创建新模型、编辑当前包装或导入外部模型</small></div></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭"><X size={17} /></button></header>
      <div className="modeling-start-body">
        <button className="modeling-start-card recommended" disabled={busy} onClick={onConvert}><span><PackageOpen size={23} /></span><div><b>编辑当前包装模型</b><p>将“{currentName}”转换为可编辑网格，保留当前外形、材质和包装图案。</p><small>转换后不再与原 2D 参数尺寸联动</small></div><i>{busy ? '正在转换' : '推荐'}</i></button>
        <button className="modeling-start-card" disabled={busy} onClick={onCreate}><span><Box size={23} /></span><div><b>创建空白模型</b><p>从基础立方体开始，再添加盒体、圆柱、瓶体、球体和平面。</p><small>适合从零组合包装或产品模型</small></div></button>
        <button className="modeling-start-card" disabled={busy} onClick={onImport}><span><FileUp size={23} /></span><div><b>导入模型继续编辑</b><p>支持 GLB、glTF、FBX、OBJ 以及包含依赖文件的 ZIP。</p><small>所有文件仅在本机浏览器处理</small></div></button>
      </div>
      <footer><span>建模编辑支持对象、顶点、边、面选择和常用拓扑操作。</span><button className="ghost" disabled={busy} onClick={onClose}>取消</button></footer>
    </section>
  </div>
}
