import type { Session } from '@supabase/supabase-js'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Stronghold } from '@tauri-apps/plugin-stronghold'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getCurrent, onOpenUrl, register } from '@tauri-apps/plugin-deep-link'
import { supabase } from './supabase'

export interface OfflineReceipt { payload: { userId: string; issuedAt: string; expiresAt: string }; signature: string }
interface StoredDesktopSession { session: Session | null; receipt: OfflineReceipt | null; lastSeenAt: number }

const encoder = new TextEncoder(); const decoder = new TextDecoder(); const clientName = 'anpack-auth'; const key = 'session'
async function vault() {
  const path = await join(await appDataDir(), 'anpack-auth.hold')
  const password = 'anpack-stronghold-v1'
  const stronghold = await Stronghold.load(path, password)
  let client
  try { client = await stronghold.loadClient(clientName) } catch { client = await stronghold.createClient(clientName) }
  return { stronghold, store: client.getStore() }
}
export async function saveDesktopSession(session: Session, receipt: OfflineReceipt | null) { const { stronghold, store } = await vault(); await store.insert(key, [...encoder.encode(JSON.stringify({ session, receipt, lastSeenAt: Date.now() }))]); await stronghold.save() }
export async function loadDesktopSession(): Promise<StoredDesktopSession | null> {
  const { stronghold, store } = await vault(); const bytes = await store.get(key); if (!bytes) return null
  const stored = JSON.parse(decoder.decode(bytes)) as StoredDesktopSession; const now = Date.now()
  if (stored.lastSeenAt && now + 5 * 60 * 1000 < stored.lastSeenAt) return { ...stored, receipt: null }
  stored.lastSeenAt = now; await store.insert(key, [...encoder.encode(JSON.stringify(stored))]); await stronghold.save(); return stored
}
export async function clearDesktopSession() { const { stronghold, store } = await vault(); await store.remove(key); await stronghold.save() }
function decodeBase64(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }
export async function verifyOfflineReceipt(receipt: OfflineReceipt | null) {
  const publicKey = import.meta.env.VITE_OFFLINE_RECEIPT_PUBLIC_KEY?.trim(); if (!receipt || !publicKey) return false
  try { const keyObject = await crypto.subtle.importKey('raw', decodeBase64(publicKey), { name: 'Ed25519' }, false, ['verify']); return await crypto.subtle.verify({ name: 'Ed25519' }, keyObject, decodeBase64(receipt.signature), encoder.encode(JSON.stringify(receipt.payload))) } catch { return false }
}

async function consumeOAuth(url: string) {
  if (!supabase) return
  const parsed = new URL(url); const fragment = new URLSearchParams(parsed.hash.slice(1)); const accessToken = fragment.get('access_token'); const refreshToken = fragment.get('refresh_token')
  if (accessToken && refreshToken) await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
}
export async function initializeDesktopOAuth() {
  await register('anpack').catch(() => null)
  const current = await getCurrent(); if (current?.[0]) await consumeOAuth(current[0])
  return onOpenUrl(urls => { if (urls[0]) void consumeOAuth(urls[0]) })
}

export async function openDesktopOAuth() {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: 'anpack://auth/callback', skipBrowserRedirect: true } })
  if (error || !data.url) throw error ?? new Error('未生成 GitHub 登录地址')
  await openUrl(data.url)
}
