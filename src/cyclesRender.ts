import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { appCacheDir, join } from '@tauri-apps/api/path'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { save } from '@tauri-apps/plugin-dialog'
import { useStudio } from './store'
import type { CyclesRenderJob, RenderJobState } from './types'

declare global { interface Window { __packshotExportProductGlb?: () => Promise<ArrayBuffer> } }

interface CyclesProgress { jobId: string; stage: RenderJobState['stage']; progress: number; message: string; device?: string; fallback?: string }

export async function cancelCyclesRender(jobId: string) { await invoke('cancel_cycles_render', { jobId }) }

export async function runCyclesRender(args: { width: number; height: number; outputPath?: string; onProgress: (state: Partial<RenderJobState>) => void; signal?: AbortSignal }) {
  if (!window.__packshotExportProductGlb) throw new Error('当前产品模型尚未准备完成')
  const snapshot = useStudio.getState().snapshot; const id = crypto.randomUUID(); const cache = await join(await appCacheDir(), 'render-jobs', id); await mkdir(cache, { recursive: true })
  const glbPath = await join(cache, 'scene.glb'); const jobPath = await join(cache, 'job.json'); const extension = snapshot.export.format === 'png' ? 'png' : 'jpg'
  const outputPath = args.outputPath ?? await save({ defaultPath: `anpack-${args.width}x${args.height}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] })
  if (!outputPath) throw new DOMException('用户取消导出', 'AbortError')
  args.onProgress({ stage: 'preparing', progress: 3, message: '正在生成 GLB 场景' })
  await writeFile(glbPath, new Uint8Array(await window.__packshotExportProductGlb()))
  const quality = snapshot.export.renderQuality === 'draft' ? { samples: 64, bounces: 3 } : snapshot.export.renderQuality === 'ultra' ? { samples: 512, bounces: 10 } : { samples: 256, bounces: 6 }
  const job: CyclesRenderJob = { id, glbPath, outputPath, width: args.width, height: args.height, format: snapshot.export.format === 'png' ? 'PNG' : 'JPEG', quality: snapshot.export.quality, transparent: snapshot.export.transparent && snapshot.export.format === 'png', samples: quality.samples, bounces: quality.bounces, denoise: snapshot.export.denoise, adaptiveSampling: snapshot.cycles.adaptiveSampling, device: snapshot.cycles.device, camera: snapshot.camera, lighting: snapshot.lighting, scene: snapshot.scene }
  await writeFile(jobPath, new TextEncoder().encode(JSON.stringify(job)))
  let unlisten: UnlistenFn | null = null
  const aborted = () => void cancelCyclesRender(id)
  try {
    unlisten = await listen<CyclesProgress>('cycles-progress', event => { if (event.payload.jobId === id) args.onProgress({ stage: event.payload.stage, progress: event.payload.progress, message: event.payload.message, fallback: event.payload.fallback ?? null }) })
    args.signal?.addEventListener('abort', aborted, { once: true })
    try { return await invoke<{ outputPath: string; device: string; fallback?: string }>('start_cycles_render', { jobPath }) }
    catch (reason) { if (args.signal?.aborted) throw new DOMException('渲染已取消', 'AbortError'); throw reason }
  } finally { args.signal?.removeEventListener('abort', aborted); unlisten?.() }
}
