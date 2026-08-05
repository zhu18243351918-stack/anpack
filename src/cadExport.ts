import type { CadDielineConfig, CadLineRole, CadPathEntity } from './types'

export type CadExportFormat = 'dxf' | 'svg' | 'pdf' | 'png' | 'json'

const colors: Record<CadLineRole, string> = { cut: '#e24d43', fold: '#2d72b8', bleed: '#24a36c', annotation: '#747c87' }
const rgb: Record<CadLineRole, [number, number, number]> = { cut: [.886, .302, .263], fold: [.176, .447, .722], bleed: [.141, .639, .424], annotation: [.455, .486, .522] }

function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

function roleMaps(config: CadDielineConfig) { return { roles: new Map(config.layers.map(layer => [layer.name, layer.role])), visible: new Map(config.layers.map(layer => [layer.name, layer.visible])) } }

function svgPath(path: CadPathEntity, config: CadDielineConfig) { const flipY = (value: number) => config.bounds.minY + config.bounds.maxY - value; return `${path.points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(3)} ${flipY(point.y).toFixed(3)}`).join(' ')}${path.closed ? ' Z' : ''}` }

function svgSource(config: CadDielineConfig) {
  const { roles, visible } = roleMaps(config); const artwork = config.artwork.url ? `<image href="${config.artwork.url}" x="${config.bounds.minX}" y="${config.bounds.minY}" width="${config.widthMm}" height="${config.heightMm}" preserveAspectRatio="xMidYMid slice" opacity="0.76"/>` : ''
  const paths = config.paths.filter(path => visible.get(path.layer) !== false).map(path => { const role = roles.get(path.layer) ?? path.role; const dash = role === 'fold' ? ' stroke-dasharray="4 3"' : role === 'bleed' ? ' stroke-dasharray="2 2"' : ''; return `<path d="${svgPath(path, config)}" fill="none" stroke="${colors[role]}" stroke-width="0.35" vector-effect="non-scaling-stroke"${dash}/>` }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.widthMm}mm" height="${config.heightMm}mm" viewBox="${config.bounds.minX} ${config.bounds.minY} ${config.widthMm} ${config.heightMm}"><rect x="${config.bounds.minX}" y="${config.bounds.minY}" width="${config.widthMm}" height="${config.heightMm}" fill="white"/>${artwork}${paths}</svg>`
}

function dxfSource(config: CadDielineConfig) {
  const { roles, visible } = roleMaps(config); const layerName: Record<CadLineRole, string> = { cut: 'CUT', fold: 'FOLD', bleed: 'BLEED', annotation: 'ANNOTATION' }
  const entities = config.paths.filter(path => visible.get(path.layer) !== false).map(path => { const role = roles.get(path.layer) ?? path.role; const vertices = path.points.map(point => `10\n${point.x}\n20\n${point.y}`).join('\n'); return `0\nLWPOLYLINE\n8\n${layerName[role]}\n90\n${path.points.length}\n70\n${path.closed ? 1 : 0}\n${vertices}` }).join('\n')
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n4\n0\nLAYER\n2\nCUT\n70\n0\n62\n1\n6\nCONTINUOUS\n0\nLAYER\n2\nFOLD\n70\n0\n62\n5\n6\nDASHED\n0\nLAYER\n2\nBLEED\n70\n0\n62\n3\n6\nDASHED\n0\nLAYER\n2\nANNOTATION\n70\n0\n62\n8\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`
}

function pdfSource(config: CadDielineConfig) {
  const mmToPt = 72 / 25.4; const width = config.widthMm * mmToPt; const height = config.heightMm * mmToPt; const { roles, visible } = roleMaps(config)
  const commands = config.paths.filter(path => visible.get(path.layer) !== false).map(path => { const role = roles.get(path.layer) ?? path.role; const [r, g, b] = rgb[role]; const dash = role === 'fold' ? '[4 3] 0 d' : role === 'bleed' ? '[2 2] 0 d' : '[] 0 d'; const points = path.points.map((point, index) => `${((point.x - config.bounds.minX) * mmToPt).toFixed(3)} ${((point.y - config.bounds.minY) * mmToPt).toFixed(3)} ${index ? 'l' : 'm'}`).join('\n'); return `${r} ${g} ${b} RG\n0.7 w\n${dash}\n${points}\n${path.closed ? 'h\n' : ''}S` }).join('\n')
  const stream = `q\n${commands}\nQ`; const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(3)} ${height.toFixed(3)}] /Contents 4 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let output = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(output).length); output += `${index + 1} 0 obj\n${object}\nendobj\n` }); const xref = new TextEncoder().encode(output).length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return output
}

async function exportPng(config: CadDielineConfig) {
  const source = svgSource(config); const svgUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' })); const image = new Image(); const longest = 2400; const scale = longest / Math.max(config.widthMm, config.heightMm); const width = Math.max(1, Math.round(config.widthMm * scale)); const height = Math.max(1, Math.round(config.heightMm * scale))
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG编码失败')); image.src = svgUrl }); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, width, height); URL.revokeObjectURL(svgUrl)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG编码失败')), 'image/png')); download(blob, `${config.name}-刀模.png`)
}

export async function exportCad(config: CadDielineConfig, format: CadExportFormat) {
  if (format === 'svg') return download(new Blob([svgSource(config)], { type: 'image/svg+xml' }), `${config.name}-刀模.svg`)
  if (format === 'dxf') return download(new Blob([dxfSource(config)], { type: 'application/dxf' }), `${config.name}-刀模.dxf`)
  if (format === 'pdf') return download(new Blob([pdfSource(config)], { type: 'application/pdf' }), `${config.name}-刀模.pdf`)
  if (format === 'json') return download(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), `${config.name}-可编辑结构.json`)
  return exportPng(config)
}
