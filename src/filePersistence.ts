import { get, set } from 'idb-keyval'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { getModelAsset, putModelAsset } from './modelAssets'
import type { ProjectSnapshot } from './types'
import { isDesktopRuntime } from './runtime'
import { migrateSnapshot } from './store'
import type { ModelAssetRecord } from './types'

interface WritableLike { write: (data: Blob | BufferSource | string) => Promise<void>; close: () => Promise<void> }
export interface FileHandleLike {
  name: string
  path?: string
  createWritable: () => Promise<WritableLike>
  queryPermission?: (options?: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options?: { mode: 'readwrite' }) => Promise<PermissionState>
}
interface SavePickerOptions { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[]; excludeAcceptAllOption?: boolean }

const HANDLE_KEY = 'anpack-project-file-handle'
let activeProjectHandle: FileHandleLike | null = null
let activeDesktopProjectPath: string | null = null

function picker() { return (window as Window & { showSaveFilePicker?: (options: SavePickerOptions) => Promise<FileHandleLike> }).showSaveFilePicker }
function safeName(value: string) { return (value.trim() || 'anpack-project').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) }

async function projectBlob(snapshot: ProjectSnapshot) {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(snapshot)) }
  if (snapshot.model.type === 'custom') { const asset = await getModelAsset(snapshot.model.assetId); if (asset) { files['assets/model.glb'] = new Uint8Array(asset.glb); files['assets/model-meta.json'] = strToU8(JSON.stringify({ id: asset.id, name: asset.name, sourceFormat: asset.sourceFormat, bounds: asset.bounds, materials: asset.materials, warnings: asset.warnings })) } }
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'anpack-project', version: 4, internalModelFormat: 'glb', createdAt: new Date().toISOString(), projectName: snapshot.projectName, hasCustomModel: snapshot.model.type === 'custom' }))
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}

async function writeDesktopFile(path: string, blob: Blob) { const { writeFile } = await import('@tauri-apps/plugin-fs'); await writeFile(path, new Uint8Array(await blob.arrayBuffer())) }
async function chooseDesktopPath(defaultPath: string, filters: { name: string; extensions: string[] }[]) { const { save } = await import('@tauri-apps/plugin-dialog'); return await save({ defaultPath, filters }) }
function desktopHandle(path: string): FileHandleLike { return { name: path.split(/[\\/]/).at(-1) ?? path, path, createWritable: async () => ({ write: async data => { const blob = data instanceof Blob ? data : new Blob([data]); await writeDesktopFile(path, blob) }, close: async () => undefined }) } }

function downloadFallback(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500) }

async function writableHandle(handle: FileHandleLike) {
  const permission = await handle.queryPermission?.({ mode: 'readwrite' })
  if (permission === 'granted' || permission === undefined) return true
  return await handle.requestPermission?.({ mode: 'readwrite' }) === 'granted'
}

export async function saveProjectFile(snapshot: ProjectSnapshot, saveAs = false) {
  const suggestedName = `${safeName(snapshot.projectName)}.anpack`; const choose = picker()
  const blob = await projectBlob(snapshot)
  if (isDesktopRuntime) {
    let path = saveAs ? null : activeDesktopProjectPath
    if (!path) path = await chooseDesktopPath(suggestedName, [{ name: 'Anpack 项目', extensions: ['anpack', 'packshot'] }])
    if (!path) throw new DOMException('用户取消储存', 'AbortError')
    await writeDesktopFile(path, blob); activeDesktopProjectPath = path
    return { name: path.split(/[\\/]/).at(-1) ?? path, fallback: false }
  }
  if (!saveAs && !activeProjectHandle) activeProjectHandle = await get<FileHandleLike>(HANDLE_KEY) ?? null
  let handle = saveAs ? null : activeProjectHandle
  if (handle && !(await writableHandle(handle))) handle = null
  if (!handle && choose) handle = await choose({ suggestedName, excludeAcceptAllOption: false, types: [{ description: 'Anpack 项目', accept: { 'application/zip': ['.anpack', '.packshot'] } }] })
  if (!handle) { downloadFallback(blob, suggestedName); return { name: suggestedName, fallback: true } }
  const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); activeProjectHandle = handle
  try { await set(HANDLE_KEY, handle) } catch { /* some private browser modes cannot persist handles */ }
  return { name: handle.name, fallback: false }
}

export async function chooseOutputFile(suggestedName: string, mime: string, extension: string, description: string) {
  if (isDesktopRuntime) { const path = await chooseDesktopPath(suggestedName, [{ name: description, extensions: [extension.replace('.', '')] }]); return path ? desktopHandle(path) : null }
  const choose = picker(); if (!choose) return null
  return choose({ suggestedName, excludeAcceptAllOption: false, types: [{ description, accept: { [mime]: [extension] } }] })
}

async function browserProjectFile() { return new Promise<File | null>(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.anpack,.packshot'; input.onchange = () => resolve(input.files?.[0] ?? null); input.click() }) }
export async function openProjectFile() {
  let bytes: Uint8Array; let name: string
  if (isDesktopRuntime) {
    const { open } = await import('@tauri-apps/plugin-dialog'); const { readFile } = await import('@tauri-apps/plugin-fs'); const selected = await open({ multiple: false, filters: [{ name: 'Anpack 项目', extensions: ['anpack', 'packshot'] }] })
    if (typeof selected !== 'string') throw new DOMException('用户取消打开', 'AbortError'); bytes = await readFile(selected); name = selected.split(/[\\/]/).at(-1) ?? selected; activeDesktopProjectPath = selected
  } else { const file = await browserProjectFile(); if (!file) throw new DOMException('用户取消打开', 'AbortError'); bytes = new Uint8Array(await file.arrayBuffer()); name = file.name }
  const files = unzipSync(bytes); const projectBytes = files['project.json']; if (!projectBytes) throw new Error('项目包中缺少 project.json')
  const snapshot = migrateSnapshot(JSON.parse(new TextDecoder().decode(projectBytes))); if (!snapshot) throw new Error('项目版本不受支持或文件已损坏')
  const glb = files['assets/model.glb']; const metaBytes = files['assets/model-meta.json']
  if (glb && snapshot.model.type === 'custom') {
    const meta = metaBytes ? JSON.parse(new TextDecoder().decode(metaBytes)) as Partial<ModelAssetRecord> : {}
    const now = Date.now(); await putModelAsset({ schemaVersion: 1, id: snapshot.model.assetId, name: meta.name ?? snapshot.model.name, sourceFormat: meta.sourceFormat ?? snapshot.model.sourceFormat, createdAt: now, updatedAt: now, glb: glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), preview: null, bounds: meta.bounds ?? snapshot.model.bounds, triangleCount: snapshot.model.triangleCount, meshCount: snapshot.model.meshCount, materialCount: snapshot.model.materialCount, dependencies: meta.dependencies ?? [], materials: meta.materials ?? [], warnings: meta.warnings ?? [] })
  }
  return { snapshot, name }
}

export async function writeOutputFile(handle: FileHandleLike, blob: Blob) { const writable = await handle.createWritable(); await writable.write(blob); await writable.close() }
export function saveBlobToDownloads(blob: Blob, name: string) { downloadFallback(blob, name) }
export function supportsFileLocations() { return isDesktopRuntime || Boolean(picker()) }
