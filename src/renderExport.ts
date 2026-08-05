import * as THREE from 'three'
import { DenoiseMaterial, PhysicalCamera, WebGLPathTracer } from 'three-gpu-pathtracer'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { CameraConfig, PackshotExportRequest, PackshotExportResult } from './types'

type Progress = NonNullable<PackshotExportRequest['onProgress']>

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('渲染已取消', 'AbortError')
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图像编码失败')), mime, quality))
}

function cloneScene(source: THREE.Scene, transparent: boolean) {
  const scene = source.clone(true)
  const previewOnly = scene.getObjectByName('preview-only')
  previewOnly?.removeFromParent()
  scene.traverse(object => {
    object.visible = object.visible && object.name !== 'preview-only'
    if (object instanceof THREE.Mesh && !(object.material instanceof THREE.MeshStandardMaterial)) {
      object.visible = false
    }
  })
  scene.background = transparent ? null : source.background
  scene.environment = source.environment
  scene.environmentIntensity = source.environmentIntensity
  scene.environmentRotation.copy(source.environmentRotation)
  scene.backgroundIntensity = source.backgroundIntensity
  scene.backgroundRotation.copy(source.backgroundRotation)
  scene.updateMatrixWorld(true)
  return scene
}

function cloneCamera(source: THREE.Camera, width: number, height: number, config: CameraConfig) {
  if (source instanceof THREE.PerspectiveCamera && config.depthOfField) {
    const camera = new PhysicalCamera()
    camera.copy(source)
    camera.aspect = width / height
    camera.focusDistance = config.focusDistance
    camera.fStop = config.fStop
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    return camera
  }
  const camera = source.clone()
  if (camera instanceof THREE.PerspectiveCamera) camera.aspect = width / height
  if (camera instanceof THREE.OrthographicCamera) {
    const vertical = camera.top - camera.bottom
    const center = (camera.left + camera.right) / 2
    const half = vertical * width / height / 2
    camera.left = center - half; camera.right = center + half
  }
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function fitCameraToProduct(camera: THREE.Camera, scene: THREE.Scene, width: number, height: number) {
  const product = scene.getObjectByName('product-root')
  if (!product) return
  const box = new THREE.Box3().setFromObject(product)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()); const aspect = width / height
  const direction = camera.position.clone().sub(center).normalize()
  if (camera instanceof THREE.PerspectiveCamera) {
    const frameSize = Math.max(size.y, size.x / aspect) * 1.04
    const distance = frameSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * .72)
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  } else if (camera instanceof THREE.OrthographicCamera) {
    const frameSize = Math.max(size.y, size.x / aspect) * 1.12
    const baseHeight = camera.top - camera.bottom
    camera.zoom = baseHeight / frameSize
    camera.position.copy(center).addScaledVector(direction, Math.max(5, size.length() * 2))
    camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  }
}

function makeRenderer(canvas: HTMLCanvasElement, width: number, height: number, antialias: boolean, exposure: number) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', premultipliedAlpha: false })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = exposure
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  return renderer
}

async function renderRaster(scene: THREE.Scene, camera: THREE.Camera, request: PackshotExportRequest, cameraConfig: CameraConfig, exposure: number, fallbackReason?: string): Promise<PackshotExportResult> {
  const progress: Progress = request.onProgress ?? (() => undefined)
  assertNotAborted(request.signal)
  progress({ stage: 'preparing', progress: 12, message: fallbackReason ? '切换到增强 WebGL 渲染' : '准备增强 WebGL 渲染' })
  const canvas = document.createElement('canvas')
  const renderer = makeRenderer(canvas, request.width, request.height, true, exposure)
  try {
    const exportScene = cloneScene(scene, request.transparent)
    const exportCamera = cloneCamera(camera, request.width, request.height, cameraConfig)
    fitCameraToProduct(exportCamera, exportScene, request.width, request.height)
    progress({ stage: 'sampling', progress: 72, message: '计算高质量阴影与环境反射' })
    renderer.render(exportScene, exportCamera)
    await nextFrame(); assertNotAborted(request.signal)
    progress({ stage: 'encoding', progress: 96, message: '编码高清图像' })
    const blob = await canvasToBlob(canvas, request.mime, request.quality)
    return { blob, renderer: 'realtime', fallbackReason }
  } finally {
    renderer.dispose(); renderer.forceContextLoss()
  }
}

async function renderPathTraced(scene: THREE.Scene, camera: THREE.Camera, request: PackshotExportRequest, cameraConfig: CameraConfig, exposure: number): Promise<PackshotExportResult> {
  const progress: Progress = request.onProgress ?? (() => undefined)
  const canvas = document.createElement('canvas')
  const renderer = makeRenderer(canvas, request.width, request.height, false, exposure)
  const gl = renderer.getContext()
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if (!renderer.capabilities.isWebGL2) throw new Error('当前设备不支持 WebGL2 路径追踪')
  if (Math.max(request.width, request.height) > maxTextureSize) throw new Error(`设备最大纹理尺寸为 ${maxTextureSize}px`)

  const exportScene = cloneScene(scene, request.transparent)
  const exportCamera = cloneCamera(camera, request.width, request.height, cameraConfig)
  fitCameraToProduct(exportCamera, exportScene, request.width, request.height)
  const tracer = new WebGLPathTracer(renderer)
  tracer.renderDelay = 0
  tracer.minSamples = 0
  tracer.fadeDuration = 0
  tracer.renderToCanvas = false
  tracer.rasterizeScene = false
  tracer.dynamicLowRes = false
  tracer.multipleImportanceSampling = true
  tracer.bounces = request.bounces
  tracer.transmissiveBounces = Math.min(4, request.bounces)
  tracer.filterGlossyFactor = .7
  tracer.textureSize.set(Math.min(2048, maxTextureSize), Math.min(2048, maxTextureSize))
  const tileCount = request.width >= 3500 ? 3 : request.width >= 1800 ? 2 : 1
  tracer.tiles.set(tileCount, tileCount)

  try {
    assertNotAborted(request.signal)
    progress({ stage: 'building', progress: 8, message: '构建光线追踪场景与材质' })
    await nextFrame()
    tracer.setScene(exportScene, exportCamera)
    progress({ stage: 'building', progress: 22, message: '光线追踪场景构建完成' })
    assertNotAborted(request.signal)
    progress({ stage: 'sampling', progress: 22, message: `开始累积 ${request.samples} 个光线样本` })
    let turns = 0
    const compileDeadline = Date.now() + 45_000
    while (tracer.samples < request.samples) {
      tracer.renderSample(); turns += 1
      if (tracer.samples === 0 && Date.now() > compileDeadline) throw new Error('路径追踪着色器编译超时')
      if (tracer.samples === 0 || turns % 2 === 0) {
        const ratio = Math.min(1, tracer.samples / request.samples)
        progress({ stage: 'sampling', progress: 22 + ratio * 68, message: tracer.samples === 0 ? '编译路径追踪着色器' : `路径追踪 ${Math.min(request.samples, Math.floor(tracer.samples))} / ${request.samples} 样本` })
        await nextFrame(); assertNotAborted(request.signal)
      }
    }

    progress({ stage: 'denoising', progress: 93, message: request.denoise ? '执行边缘保持降噪' : '整理光线追踪结果' })
    const denoise = new DenoiseMaterial({
      map: tracer.target.texture,
      sigma: request.denoise ? (request.samples <= 32 ? 5 : request.samples <= 128 ? 4 : 2.8) : 1,
      kSigma: request.denoise ? (request.samples <= 32 ? 1.5 : request.samples <= 128 ? 1.2 : 1) : 0,
      threshold: request.denoise ? (request.samples <= 32 ? .45 : request.samples <= 128 ? .3 : .12) : .001,
    })
    const quad = new FullScreenQuad(denoise)
    renderer.setRenderTarget(null)
    renderer.setClearColor(0x000000, request.transparent ? 0 : 1)
    renderer.clear(true, true, true)
    quad.render(renderer)
    await nextFrame(); assertNotAborted(request.signal)
    progress({ stage: 'encoding', progress: 98, message: '编码高清图像' })
    const blob = await canvasToBlob(canvas, request.mime, request.quality)
    quad.dispose(); denoise.dispose()
    return { blob, renderer: 'pathtraced' }
  } finally {
    tracer.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}

export async function renderPackshot(scene: THREE.Scene, camera: THREE.Camera, request: PackshotExportRequest, cameraConfig: CameraConfig, exposure: number): Promise<PackshotExportResult> {
  if (request.renderer === 'realtime') return renderRaster(scene, camera, request, cameraConfig, exposure)
  try {
    return await renderPathTraced(scene, camera, request, cameraConfig, exposure)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const reason = error instanceof Error ? error.message : '路径追踪不可用'
    request.onProgress?.({ stage: 'preparing', progress: 10, message: `${reason}，自动切换增强 WebGL` })
    return renderRaster(scene, camera, request, cameraConfig, exposure, reason)
  }
}
