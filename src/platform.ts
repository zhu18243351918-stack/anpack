import { isDesktopRuntime, runtimeTarget, type RuntimeTarget } from './runtime'

export interface PlatformCapabilities { target: RuntimeTarget; nativeFiles: boolean; cycles: boolean; updater: boolean; offlineAuth: boolean }
export interface PlatformAdapter {
  capabilities: PlatformCapabilities
  chooseOpenProject: () => Promise<string | null>
  checkForUpdates: () => Promise<{ version: string; install: () => Promise<void> } | null>
}

export const platform: PlatformAdapter = {
  capabilities: { target: runtimeTarget, nativeFiles: isDesktopRuntime, cycles: isDesktopRuntime, updater: isDesktopRuntime, offlineAuth: isDesktopRuntime },
  chooseOpenProject: async () => {
    if (!isDesktopRuntime) return null
    const { open } = await import('@tauri-apps/plugin-dialog'); const selected = await open({ multiple: false, filters: [{ name: 'Anpack 项目', extensions: ['anpack', 'packshot'] }] })
    return typeof selected === 'string' ? selected : null
  },
  checkForUpdates: async () => {
    if (!isDesktopRuntime) return null
    const { check } = await import('@tauri-apps/plugin-updater'); const update = await check(); if (!update) return null
    return { version: update.version, install: async () => { await update.downloadAndInstall() } }
  },
}
