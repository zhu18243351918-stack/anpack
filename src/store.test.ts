import { describe, expect, it } from 'vitest'
import { initialSnapshot, migrateSnapshot } from './store'

describe('project snapshot migration', () => {
  it('migrates version 3 projects to version 4 without losing model data', () => {
    const legacy = structuredClone(initialSnapshot) as unknown as { version: number; cycles?: unknown }
    legacy.version = 3; delete legacy.cycles
    const result = migrateSnapshot(legacy)
    expect(result?.version).toBe(4)
    expect(result?.model).toEqual(initialSnapshot.model)
    expect(result?.cycles.samples).toBe(256)
    expect(result?.cycles.device).toBe('auto')
  })
  it('rejects unknown snapshot versions', () => { expect(migrateSnapshot({ version: 99 })).toBeNull() })
})
