import type { SceneObjectTransform } from './types'

export type SceneObjectKind = 'product' | 'pedestal' | 'decor'

export interface SceneObjectDescriptor {
  id: string
  label: string
  kind: SceneObjectKind
}

export const DEFAULT_SCENE_OBJECT_TRANSFORM: SceneObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  visible: true,
}

export function sceneObjectAssetKey(templateId: string, objectId: string) {
  return `${templateId}:${objectId}`
}

const templateObjects: Record<string, SceneObjectDescriptor[]> = {
  'commerce-white': [],
  'soft-gradient': [
    { id: 'decor-ring', label: '背景圆环', kind: 'decor' },
    { id: 'decor-sphere', label: '装饰球', kind: 'decor' },
  ],
  'warm-beauty': [
    { id: 'pedestal', label: '圆形展示台', kind: 'pedestal' },
    { id: 'decor-arch', label: '拱形背景板', kind: 'decor' },
    { id: 'decor-sphere', label: '装饰球', kind: 'decor' },
  ],
  'blue-geometric': [
    { id: 'decor-platform-main', label: '蓝色主平台', kind: 'decor' },
    { id: 'decor-platform-back', label: '深蓝后平台', kind: 'decor' },
    { id: 'decor-accent', label: '橙色饰条', kind: 'decor' },
    { id: 'decor-sphere-1', label: '金属球 1', kind: 'decor' },
    { id: 'decor-sphere-2', label: '金属球 2', kind: 'decor' },
    { id: 'decor-sphere-3', label: '金属球 3', kind: 'decor' },
    { id: 'decor-sphere-4', label: '金属球 4', kind: 'decor' },
  ],
  'dark-luxury': [
    { id: 'pedestal', label: '黑色展示台', kind: 'pedestal' },
    { id: 'decor-block', label: '侧边几何台', kind: 'decor' },
    { id: 'decor-ring', label: '金色圆环', kind: 'decor' },
  ],
  'cool-warm': [
    { id: 'pedestal', label: '暖色展示台', kind: 'pedestal' },
    { id: 'decor-platform', label: '青色斜台', kind: 'decor' },
    { id: 'decor-panel', label: '珊瑚背景板', kind: 'decor' },
  ],
  'floating-launch': [
    { id: 'decor-ring', label: '悬浮圆环', kind: 'decor' },
    { id: 'decor-sphere-1', label: '悬浮球 1', kind: 'decor' },
    { id: 'decor-sphere-2', label: '悬浮球 2', kind: 'decor' },
    { id: 'decor-sphere-3', label: '悬浮球 3', kind: 'decor' },
  ],
  'water-clear': [
    { id: 'pedestal', label: '透明水晶台', kind: 'pedestal' },
    { id: 'decor-bubble-1', label: '气泡 1', kind: 'decor' },
    { id: 'decor-bubble-2', label: '气泡 2', kind: 'decor' },
    { id: 'decor-bubble-3', label: '气泡 3', kind: 'decor' },
    { id: 'decor-bubble-4', label: '气泡 4', kind: 'decor' },
  ],
  'botanical-natural': [
    { id: 'pedestal', label: '石质展示台', kind: 'pedestal' },
    { id: 'decor-rock', label: '自然石块', kind: 'decor' },
    { id: 'decor-leaf-1', label: '叶片 1', kind: 'decor' },
    { id: 'decor-leaf-2', label: '叶片 2', kind: 'decor' },
    { id: 'decor-leaf-3', label: '叶片 3', kind: 'decor' },
  ],
  'transparent-cutout': [],
}

export function getSceneObjectDescriptors(templateId: string, productCount: number): SceneObjectDescriptor[] {
  const products = Array.from({ length: productCount }, (_, index) => ({
    id: `product-${index}`,
    label: productCount === 1 ? '主包装' : `包装 ${index + 1}`,
    kind: 'product' as const,
  }))
  return [...products, ...(templateObjects[templateId] ?? [])]
}
