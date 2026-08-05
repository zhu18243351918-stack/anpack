export type RuntimeTarget = 'web' | 'desktop'

export const runtimeTarget: RuntimeTarget = import.meta.env.VITE_TARGET === 'desktop' || '__TAURI_INTERNALS__' in window ? 'desktop' : 'web'
export const isDesktopRuntime = runtimeTarget === 'desktop'
export const appVersion = import.meta.env.VITE_APP_VERSION || '0.1.0'
export const repositoryUrl = import.meta.env.VITE_REPOSITORY_URL || 'https://github.com/your-account/anpack'
export const pagesBaseUrl = import.meta.env.VITE_PUBLIC_URL || window.location.origin + window.location.pathname
