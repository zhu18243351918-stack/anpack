/* eslint-disable react-refresh/only-export-components */
import { ImagePlus } from 'lucide-react'
import { useMemo } from 'react'
import { useStudio } from './store'
import { artworkPreviewStyle } from './artworkTransform'
import type { ArtworkSurface, BoxFace, FaceArtwork, PackagingTemplate } from './types'

export const FACE_LABELS: Record<BoxFace, string> = { front: '正面', back: '背面', left: '左侧面', right: '右侧面', top: '顶面', bottom: '底面', topFront: '正面上盖', topBack: '背面上盖', topLeft: '左上插舌', topRight: '右上插舌', bottomFront: '正面下盖', bottomBack: '背面下盖', bottomLeft: '左下插舌', bottomRight: '右下插舌', glue: '粘合舌' }
export const TEMPLATE_META: Record<PackagingTemplate, { name: string; category: string; faces: BoxFace[] }> = {
  carton: { name: '飞机式插锁盒', category: '纸盒', faces: ['front', 'back', 'left', 'right', 'topFront', 'topBack', 'topLeft', 'topRight', 'bottomFront', 'bottomBack', 'bottomLeft', 'bottomRight', 'glue'] },
  mailer: { name: '飞机盒', category: '礼盒', faces: ['front', 'back', 'left', 'right', 'top', 'bottom'] },
  gift: { name: '天地盖礼盒', category: '礼盒', faces: ['front', 'back', 'left', 'right', 'top', 'bottom'] },
  shoppingBag: { name: '手提购物袋', category: '纸袋', faces: ['front', 'back', 'left', 'right', 'bottom'] },
  pouch: { name: '自立软袋', category: '软包装', faces: ['front', 'back', 'bottom'] },
  bottleLabel: { name: '瓶身环绕标签', category: '瓶子', faces: ['front'] },
  canLabel: { name: '罐身环绕标签', category: '罐装', faces: ['front', 'top'] },
  custom: { name: '自定义3D模型', category: '无参数展开图', faces: [] },
}

interface LayoutItem { face: BoxFace; x: number; y: number; width: number; height: number; shape?: string }

function FacePanel({ item, selected, artwork, onSelect }: { item: LayoutItem; selected: boolean; artwork: FaceArtwork; onSelect: (face: BoxFace) => void }) {
  const imageStyle = artworkPreviewStyle(artwork)
  return <button className={`dieline-face ${item.shape ?? ''} ${selected ? 'selected' : ''} ${artwork.url ? 'filled' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height }} onClick={() => onSelect(item.face)}><span className="face-art" style={imageStyle} /><span className="bleed-boundary" /><span className="safe-boundary" /><span className="face-label">{FACE_LABELS[item.face]}</span>{!artwork.url && <span className="face-empty"><ImagePlus size={15} />添加图案</span>}</button>
}

function makeLayout(template: PackagingTemplate, W: number, H: number, D: number): { items: LayoutItem[]; width: number; height: number; extras: { x: number; y: number; width: number; height: number; kind?: string }[] } {
  if (template === 'bottleLabel' || template === 'canLabel') {
    const wrapW = Math.max(W * 2.9, 420), labelH = Math.max(H * .58, 230); const items: LayoutItem[] = [{ face: 'front', x: 0, y: 0, width: wrapW, height: labelH }]
    if (template === 'canLabel') items.push({ face: 'top', x: wrapW + 34, y: labelH * .18, width: labelH * .64, height: labelH * .64 })
    return { items, width: wrapW + (template === 'canLabel' ? labelH * .64 + 34 : 0), height: labelH, extras: [{ x: 0, y: 34, width: wrapW, height: 1, kind: 'fold' }, { x: 0, y: labelH - 34, width: wrapW, height: 1, kind: 'fold' }] }
  }
  if (template === 'pouch') {
    return { items: [{ face: 'front', x: 0, y: 0, width: W, height: H }, { face: 'back', x: W + 14, y: 0, width: W, height: H }, { face: 'bottom', x: 0, y: H + 14, width: W, height: Math.max(D, 55) }], width: W * 2 + 14, height: H + Math.max(D, 55) + 14, extras: [{ x: 0, y: 28, width: W * 2 + 14, height: 1, kind: 'fold' }] }
  }
  if (template === 'shoppingBag') {
    const topFold = Math.max(D * .55, 45)
    return { items: [{ face: 'back', x: 0, y: topFold, width: W, height: H }, { face: 'left', x: W, y: topFold, width: D, height: H }, { face: 'front', x: W + D, y: topFold, width: W, height: H }, { face: 'right', x: W * 2 + D, y: topFold, width: D, height: H }, { face: 'bottom', x: W + D, y: topFold + H, width: W, height: D }], width: W * 2 + D * 2, height: topFold + H + D, extras: [{ x: 0, y: 0, width: W * 2 + D * 2, height: topFold, kind: 'fold' }] }
  }
  if (template === 'mailer') {
    const lidH = H * .82
    return { items: [{ face: 'top', x: D, y: 0, width: W, height: lidH }, { face: 'back', x: D, y: lidH, width: W, height: H }, { face: 'front', x: D, y: lidH + H, width: W, height: H * .46 }, { face: 'left', x: 0, y: lidH, width: D, height: H }, { face: 'right', x: D + W, y: lidH, width: D, height: H }, { face: 'bottom', x: D, y: lidH + H + H * .46, width: W, height: D }], width: W + D * 2, height: lidH + H * 1.46 + D, extras: [] }
  }
  if (template === 'gift') {
    return { items: [{ face: 'front', x: D, y: D, width: W, height: H }, { face: 'back', x: D + W + D, y: D, width: W, height: H }, { face: 'left', x: 0, y: D, width: D, height: H }, { face: 'right', x: D + W, y: D, width: D, height: H }, { face: 'top', x: D, y: 0, width: W, height: D }, { face: 'bottom', x: D, y: D + H, width: W, height: D }], width: W * 2 + D * 2, height: H + D * 2, extras: [] }
  }
  const glue = Math.max(18, D * .38), xBack = glue, xLeft = xBack + W, xFront = xLeft + D, xRight = xFront + W, yMid = D
  const lockLip = Math.max(10, D * .12)
  const lockOverhang = Math.max(4, W * .018)
  return { items: [
    { face: 'glue', x: 0, y: yMid + H * .05, width: glue, height: H * .9, shape: 'glue-panel' },
    { face: 'front', x: xBack, y: yMid, width: W, height: H }, { face: 'left', x: xLeft, y: yMid, width: D, height: H }, { face: 'back', x: xFront, y: yMid, width: W, height: H }, { face: 'right', x: xRight, y: yMid, width: D, height: H },
    { face: 'topFront', x: xBack - lockOverhang, y: 0, width: W + lockOverhang * 2, height: D, shape: 'lock-flap flap-top' }, { face: 'topLeft', x: xLeft, y: D * .18, width: D, height: D * .82, shape: 'dust-flap flap-top dust-left' }, { face: 'topBack', x: xFront, y: yMid, width: W, height: lockLip, shape: 'lock-strip inset-strip' }, { face: 'topRight', x: xRight, y: D * .18, width: D, height: D * .82, shape: 'dust-flap flap-top dust-right' },
    { face: 'bottomFront', x: xBack - lockOverhang, y: yMid + H, width: W + lockOverhang * 2, height: D, shape: 'lock-flap flap-bottom' }, { face: 'bottomLeft', x: xLeft, y: yMid + H, width: D, height: D * .82, shape: 'dust-flap flap-bottom dust-left' }, { face: 'bottomBack', x: xFront, y: yMid + H - lockLip, width: W, height: lockLip, shape: 'lock-strip inset-strip' }, { face: 'bottomRight', x: xRight, y: yMid + H, width: D, height: D * .82, shape: 'dust-flap flap-bottom dust-right' },
  ], width: glue + W * 2 + D * 2, height: H + D * 2, extras: [] }
}

export default function DielineEditor({ selectedFace, surface, onSelectFace }: { selectedFace: BoxFace; surface: ArtworkSurface; onSelectFace: (face: BoxFace) => void }) {
  const snapshot = useStudio(s => s.snapshot); const sourceFaces = surface === 'outer' ? snapshot.artwork.faces : snapshot.artwork.innerFaces
  const layout = useMemo(() => {
    const model = snapshot.model; let rawW: number, rawH: number, rawD: number
    if (model.type === 'box') [rawW, rawH, rawD] = [model.width, model.height, model.depth]
    else if (model.type === 'pouch') [rawW, rawH, rawD] = [model.width, model.height, model.depth]
    else if (model.type === 'bottle') [rawW, rawH, rawD] = [model.diameter * Math.PI, model.height, model.diameter]
    else if (model.type === 'can') [rawW, rawH, rawD] = [model.diameter * Math.PI, model.height, model.diameter]
    else [rawW, rawH, rawD] = model.bounds
    const rough = makeLayout(snapshot.template, rawW, rawH, rawD); const scale = Math.min(980 / rough.width, 700 / rough.height, 3.75)
    return { ...makeLayout(snapshot.template, rawW * scale, rawH * scale, rawD * scale), scale, rawW, rawH, rawD }
  }, [snapshot.model, snapshot.template])
  if (snapshot.model.type === 'custom' || snapshot.template === 'custom') return <div className="dieline-stage"><div className="dieline-unavailable"><b>包装结构库已保留</b><span>请从左侧选择一个包装结构生成参数化展开图，或进入当前自定义模型的 UV 工作区。</span></div></div>
  return <div className={`dieline-stage surface-${surface}`}><div className="dieline-guide"><span><i className="cut-line" />裁切线</span><span><i className="fold-line" />折叠线</span><span><i className="bleed-line" />3mm 出血线</span><span>{TEMPLATE_META[snapshot.template].name} · {surface === 'outer' ? '外侧印刷面' : '内侧印刷面'}</span></div><div className="dieline-board" style={{ width: layout.width, height: layout.height }}>{layout.extras.map((extra, index) => extra.kind === 'glue' ? <div key={index} className="glue-flap" style={extra}><span>粘口</span></div> : <div key={index} className={`flap outline ${extra.kind ?? ''}`} style={extra} />)}{layout.items.map(item => <FacePanel key={item.face} item={item} selected={selectedFace === item.face} artwork={sourceFaces[item.face]} onSelect={onSelectFace} />)}</div><div className="dieline-meta"><span>{surface === 'outer' ? '外侧' : '内侧'} · {TEMPLATE_META[snapshot.template].category}</span><span>成品 {Math.round(layout.rawW)} × {Math.round(layout.rawH)} × {Math.round(layout.rawD)} mm</span></div></div>
}
