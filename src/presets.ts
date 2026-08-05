import type { CameraConfig, LightingConfig, MaterialConfig, ModelType, PackagingModelConfig, ProceduralModelType, SceneConfig, Vector3Tuple } from './types'

export const modelDefaults: Record<ProceduralModelType, PackagingModelConfig> = {
  box: { type: 'box', width: 120, height: 160, depth: 60, radius: 2, thickness: 0.5 },
  bottle: { type: 'bottle', height: 180, diameter: 62, shoulder: 28, neck: 28, cap: 22 },
  can: { type: 'can', height: 115, diameter: 72, lid: 5, radius: 5 },
  pouch: { type: 'pouch', width: 105, height: 155, depth: 24, seal: 10, gusset: 12 },
}

export const materialPresets: Record<string, Partial<MaterialConfig>> = {
  '哑光纸': { roughness: .76, metalness: 0, opacity: 1, transmission: 0, clearcoat: .04, clearcoatRoughness: .72, normalScale: .16, textureScale: 5, ior: 1.46, thickness: .04, color: '#f2efe7' },
  '亮膜纸': { roughness: .23, metalness: 0, opacity: 1, transmission: 0, clearcoat: .86, clearcoatRoughness: .12, normalScale: .05, textureScale: 7, ior: 1.48, thickness: .035, color: '#ffffff' },
  '牛皮纸': { roughness: .88, metalness: 0, opacity: 1, transmission: 0, clearcoat: 0, clearcoatRoughness: .8, normalScale: .28, textureScale: 4, ior: 1.45, thickness: .06, color: '#b98b56' },
  '磨砂塑料': { roughness: .58, metalness: 0, opacity: .96, transmission: .08, clearcoat: .16, clearcoatRoughness: .5, normalScale: .12, textureScale: 8, ior: 1.47, thickness: .12, color: '#eceef1' },
  '亮面塑料': { roughness: .16, metalness: 0, opacity: 1, transmission: .03, clearcoat: 1, clearcoatRoughness: .06, normalScale: .035, textureScale: 10, ior: 1.47, thickness: .1, color: '#e7eaed' },
  '透明玻璃': { roughness: .04, metalness: 0, opacity: 1, transmission: .96, clearcoat: 1, clearcoatRoughness: .03, normalScale: .015, textureScale: 10, ior: 1.52, thickness: .28, color: '#edf7ff' },
  '磨砂玻璃': { roughness: .42, metalness: 0, opacity: 1, transmission: .78, clearcoat: .35, clearcoatRoughness: .38, normalScale: .2, textureScale: 9, ior: 1.5, thickness: .3, color: '#e8f0f4' },
  '铝罐': { roughness: .26, metalness: .92, opacity: 1, transmission: 0, clearcoat: .3, clearcoatRoughness: .14, normalScale: .07, textureScale: 13, ior: 1.46, thickness: .05, color: '#d8dadd' },
}

export type SceneCategory = '全部' | '电商基础' | '美妆个护' | '食品饮料' | '高端质感' | '创意构图'

export interface SceneProductInstance {
  position: Vector3Tuple
  rotation: Vector3Tuple
  scale: number
}

export interface SceneTemplate {
  id: string
  name: string
  category: Exclude<SceneCategory, '全部'>
  description: string
  tags: string[]
  thumbnail: string
  compatible: ModelType[]
  scene: Partial<SceneConfig>
  lighting: Partial<LightingConfig>
  camera: Partial<CameraConfig>
  products: SceneProductInstance[]
  frameScale: number
  targetOffset: Vector3Tuple
}

const allModels: ModelType[] = ['box', 'bottle', 'can', 'pouch', 'custom']
const one: SceneProductInstance[] = [{ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }]

export const sceneTemplates: SceneTemplate[] = [
  {
    id: 'commerce-white', name: '电商白底', category: '电商基础', description: '干净白底、自然接触阴影，适合主图与详情页。', tags: ['白底', '主图', '通用'], thumbnail: 'thumb-white', compatible: allModels,
    scene: { background: '#e9e9e7', floor: true, pedestal: false, decor: false, transparent: false, cyclorama: true, floorRoughness: .76 },
    lighting: { ambient: .3, key: 3.8, fill: 1.8, point: .45, temperature: 5400, keyPosition: [4.8, 6.5, 4.2], shadowSoftness: 7, exposure: .98, environmentIntensity: 1.05, environmentRotation: -12, keySize: 6.5, fillSize: 7 },
    camera: { projection: 'perspective', fov: 32, position: [5.2, 3.5, 7.4], target: [0, 1.3, 0] }, products: one, frameScale: 1, targetOffset: [0, 0, 0],
  },
  {
    id: 'soft-gradient', name: '柔光渐变', category: '电商基础', description: '低对比米灰渐变与柔光，适合食品、纸盒和日用品。', tags: ['柔光', '米灰', '简约'], thumbnail: 'thumb-gradient', compatible: allModels,
    scene: { background: '#c9c4ba', floor: true, pedestal: false, decor: true, transparent: false, cyclorama: true, floorRoughness: .66 },
    lighting: { ambient: .35, key: 3.1, fill: 1.9, point: .5, temperature: 4900, keyPosition: [-4.5, 6.2, 4.5], shadowSoftness: 9, exposure: .94, environmentIntensity: .92, environmentRotation: 24, keySize: 7.5, fillSize: 7.5 },
    camera: { projection: 'perspective', fov: 36, position: [5.6, 3.7, 7.6], target: [0, 1.25, 0] }, products: one, frameScale: 1.08, targetOffset: [.1, 0, 0],
  },
  {
    id: 'warm-beauty', name: '暖色护肤展台', category: '美妆个护', description: '暖杏色圆台与拱形背景，适合护肤、香氛和礼盒。', tags: ['护肤', '暖色', '展台'], thumbnail: 'thumb-beauty', compatible: allModels,
    scene: { background: '#d79b7c', floor: true, pedestal: true, decor: true, transparent: false, cyclorama: true, floorRoughness: .62 },
    lighting: { ambient: .28, key: 3.5, fill: 1.35, point: 1.1, temperature: 4300, keyPosition: [4.2, 6.4, 3.8], shadowSoftness: 8, exposure: .96, environmentIntensity: .84, environmentRotation: -38, keySize: 6.2, fillSize: 5.8 },
    camera: { projection: 'perspective', fov: 38, position: [5.7, 3.8, 7.2], target: [0, 1.45, 0] }, products: [{ position: [0, .46, 0], rotation: [0, -.12, 0], scale: .94 }], frameScale: 1.15, targetOffset: [0, .18, 0],
  },
  {
    id: 'blue-geometric', name: '蓝色几何电商', category: '创意构图', description: '多包装阵列、斜切平台与金属球，适合新品首发视觉。', tags: ['蓝色', '几何', '多产品'], thumbnail: 'thumb-blue', compatible: allModels,
    scene: { background: '#1599df', floor: true, pedestal: false, decor: true, transparent: false, cyclorama: true, floorRoughness: .48 },
    lighting: { ambient: .2, key: 5.2, fill: 1.25, point: 1.4, temperature: 6100, keyPosition: [-5.5, 8, 4.5], shadowSoftness: 3.5, exposure: 1.04, environmentIntensity: .78, environmentRotation: 42, keySize: 4.2, fillSize: 5.5 },
    camera: { projection: 'perspective', fov: 34, position: [6.8, 7.1, 8.4], target: [0, .8, 0] },
    products: [{ position: [-.85, .35, .35], rotation: [.08, -.3, -.12], scale: .9 }, { position: [1.05, .08, -.55], rotation: [.05, .55, .09], scale: .72 }], frameScale: 1.65, targetOffset: [.05, .25, 0],
  },
  {
    id: 'dark-luxury', name: '暗调奢华', category: '高端质感', description: '黑色层叠展台与金色轮廓光，适合酒类、香水和精品礼盒。', tags: ['暗调', '金色', '奢华'], thumbnail: 'thumb-dark', compatible: allModels,
    scene: { background: '#0c0d11', floor: true, pedestal: true, decor: true, transparent: false, cyclorama: true, floorRoughness: .38 },
    lighting: { ambient: .08, key: 2.7, fill: .42, point: 2.4, temperature: 3300, keyPosition: [4.8, 7.2, 1.4], shadowSoftness: 5, exposure: .86, environmentIntensity: .62, environmentRotation: 76, keySize: 3.2, fillSize: 3.8 },
    camera: { projection: 'perspective', fov: 35, position: [6.1, 3.9, 7.8], target: [0, 1.4, 0] }, products: [{ position: [0, .34, 0], rotation: [0, -.22, 0], scale: .96 }], frameScale: 1.18, targetOffset: [0, .1, 0],
  },
  {
    id: 'cool-warm', name: '冷暖撞色', category: '创意构图', description: '青蓝与珊瑚橙块面交错，适合年轻化食品与个护包装。', tags: ['撞色', '潮流', '年轻'], thumbnail: 'thumb-contrast', compatible: allModels,
    scene: { background: '#244c5e', floor: true, pedestal: true, decor: true, transparent: false, cyclorama: true, floorRoughness: .56 },
    lighting: { ambient: .22, key: 4.1, fill: 1.2, point: 1.3, temperature: 4700, keyPosition: [-4.5, 6.8, 3.4], shadowSoftness: 5.5, exposure: .96, environmentIntensity: .8, environmentRotation: 6, keySize: 5.4, fillSize: 5.5 },
    camera: { projection: 'perspective', fov: 37, position: [6.4, 4.2, 7.6], target: [.15, 1.25, 0] }, products: [{ position: [.3, .44, 0], rotation: [0, -.3, 0], scale: .94 }], frameScale: 1.28, targetOffset: [.05, .1, 0],
  },
  {
    id: 'floating-launch', name: '悬浮新品发布', category: '创意构图', description: '三件包装错落悬浮，适合系列产品、限定款与社媒海报。', tags: ['悬浮', '系列', '海报'], thumbnail: 'thumb-float', compatible: allModels,
    scene: { background: '#735de8', floor: false, pedestal: false, decor: true, transparent: false, cyclorama: false, floorRoughness: .6 },
    lighting: { ambient: .3, key: 4.5, fill: 1.7, point: 1.5, temperature: 5600, keyPosition: [5.5, 7, 4], shadowSoftness: 7, exposure: 1.02, environmentIntensity: .9, environmentRotation: -55, keySize: 5.8, fillSize: 6.5 },
    camera: { projection: 'perspective', fov: 34, position: [7.4, 4.6, 9], target: [0, 1.6, 0] },
    products: [{ position: [-1.25, 1.05, .1], rotation: [.05, -.45, -.15], scale: .72 }, { position: [0, .35, 0], rotation: [0, .08, .08], scale: .92 }, { position: [1.28, 1.35, -.3], rotation: [-.08, .45, .18], scale: .62 }], frameScale: 1.85, targetOffset: [0, .6, 0],
  },
  {
    id: 'water-clear', name: '清透水感', category: '美妆个护', description: '冰蓝透明台、气泡与高光，适合水乳、饮料与透明材质。', tags: ['水感', '透明', '清凉'], thumbnail: 'thumb-water', compatible: allModels,
    scene: { background: '#a9dfe7', floor: true, pedestal: true, decor: true, transparent: false, cyclorama: true, floorRoughness: .3 },
    lighting: { ambient: .34, key: 4.3, fill: 2.1, point: 1.25, temperature: 6800, keyPosition: [-4.8, 7.2, 4.2], shadowSoftness: 8, exposure: 1.04, environmentIntensity: 1.25, environmentRotation: 18, keySize: 7, fillSize: 7 },
    camera: { projection: 'perspective', fov: 36, position: [6.3, 4.2, 7.8], target: [0, 1.35, 0] }, products: [{ position: [0, .38, 0], rotation: [0, -.18, 0], scale: .94 }], frameScale: 1.25, targetOffset: [0, .12, 0],
  },
  {
    id: 'botanical-natural', name: '自然植萃', category: '食品饮料', description: '暖灰石台、叶片与自然侧光，适合茶饮、健康食品和天然护理。', tags: ['自然', '植萃', '健康'], thumbnail: 'thumb-botanical', compatible: allModels,
    scene: { background: '#aab09c', floor: true, pedestal: true, decor: true, transparent: false, cyclorama: true, floorRoughness: .82 },
    lighting: { ambient: .3, key: 3.7, fill: 1, point: .55, temperature: 4700, keyPosition: [-5.8, 7.5, 4.4], shadowSoftness: 8.5, exposure: .92, environmentIntensity: .75, environmentRotation: 58, keySize: 7.2, fillSize: 6 },
    camera: { projection: 'perspective', fov: 38, position: [6.4, 4.1, 7.5], target: [0, 1.2, 0] }, products: [{ position: [0, .25, 0], rotation: [0, .22, 0], scale: .96 }], frameScale: 1.28, targetOffset: [0, .05, 0],
  },
  {
    id: 'transparent-cutout', name: '透明抠图', category: '电商基础', description: '保留 HDR 反射与灯光，只隐藏背景，适合后期合成。', tags: ['透明', 'PNG', '合成'], thumbnail: 'thumb-transparent', compatible: allModels,
    scene: { background: '#d8d8d8', floor: false, pedestal: false, decor: false, transparent: true, cyclorama: false, floorRoughness: .7 },
    lighting: { ambient: .25, key: 3.8, fill: 1.6, point: .65, temperature: 5400, keyPosition: [4.8, 6.5, 4], shadowSoftness: 7, exposure: .98, environmentIntensity: 1, environmentRotation: -16, keySize: 6.5, fillSize: 6.5 },
    camera: { projection: 'perspective', fov: 32, position: [5.2, 3.5, 7.4], target: [0, 1.3, 0] }, products: one, frameScale: 1, targetOffset: [0, 0, 0],
  },
]

export const sceneTemplateMap = Object.fromEntries(sceneTemplates.map(template => [template.id, template])) as Record<string, SceneTemplate>

const legacySceneIds: Record<string, string> = {
  '影棚白': 'commerce-white', '柔和渐变': 'soft-gradient', '暖色展台': 'warm-beauty',
  '暗调聚光': 'dark-luxury', '冷暖对比': 'cool-warm', '透明背景': 'transparent-cutout',
}

export function getSceneTemplate(idOrName: string | undefined) {
  if (!idOrName) return sceneTemplateMap['commerce-white']
  return sceneTemplateMap[idOrName] ?? sceneTemplateMap[legacySceneIds[idOrName]] ?? sceneTemplates.find(template => template.name === idOrName) ?? sceneTemplateMap['commerce-white']
}

export const scenePresets: Record<string, Partial<SceneConfig>> = Object.fromEntries(sceneTemplates.map(template => [template.id, template.scene]))
