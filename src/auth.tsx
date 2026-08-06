/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import { isDesktopRuntime } from './runtime'
import type { OfflineReceipt } from './desktopAuth'

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous' | 'offline' | 'error'
  user: User | null
  session: Session | null
  configured: boolean
  offlineUntil: string | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGitHub: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function issueOfflineReceipt(accessToken: string): Promise<OfflineReceipt | null> {
  if (!isDesktopRuntime || !supabase) return null
  const { data, error } = await supabase.functions.invoke('issue-offline-receipt', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (error || !data?.payload || !data?.signature) return null
  return data as OfflineReceipt
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, session: null, configured: supabaseConfigured, offlineUntil: null, error: null })
  const persistedAccessToken = useRef<string | null>(null)
  const acceptSession = useCallback((session: Session | null) => {
    if (!session) { setState(current => ({ ...current, status: 'anonymous', user: null, session: null, offlineUntil: null })); return }
    setState({ status: 'authenticated', user: session.user, session, configured: supabaseConfigured, offlineUntil: null, error: null })
    if (!isDesktopRuntime || persistedAccessToken.current === session.access_token) return
    persistedAccessToken.current = session.access_token
    void (async () => {
      try {
        const offlineReceipt = await issueOfflineReceipt(session.access_token)
        const { saveDesktopSession } = await import('./desktopAuth')
        await saveDesktopSession(session, offlineReceipt)
        if (offlineReceipt) setState(current => current.session?.access_token === session.access_token ? { ...current, offlineUntil: offlineReceipt.payload.expiresAt } : current)
      } catch (reason) {
        console.warn('Unable to persist the desktop session', reason)
        persistedAccessToken.current = null
      }
    })()
  }, [])
  useEffect(() => {
    let active = true; let unlistenDesktop: (() => void) | undefined
    const boot = async () => {
      if (!supabase) { if (active) setState(current => ({ ...current, status: 'anonymous' })); return }
      try {
        const desktop = isDesktopRuntime ? await import('./desktopAuth') : null
        if (desktop) unlistenDesktop = await desktop.initializeDesktopOAuth()
        const { data } = await supabase.auth.getSession()
        if (data.session) { if (active) acceptSession(data.session); return }
        if (isDesktopRuntime) {
          const stored = await desktop!.loadDesktopSession()
          if (stored?.session?.refresh_token) {
            const { data: refreshed } = await supabase.auth.setSession({ access_token: stored.session.access_token, refresh_token: stored.session.refresh_token })
            if (refreshed.session) { if (active) acceptSession(refreshed.session); return }
          }
          if (stored?.receipt && await desktop!.verifyOfflineReceipt(stored.receipt) && new Date(stored.receipt.payload.expiresAt).getTime() > Date.now()) {
            if (active) setState({ status: 'offline', user: stored.session?.user ?? null, session: stored.session, configured: true, offlineUntil: stored.receipt.payload.expiresAt, error: null })
            return
          }
        }
        if (active) setState(current => ({ ...current, status: 'anonymous' }))
      } catch (reason) {
        const desktop = isDesktopRuntime ? await import('./desktopAuth') : null; const stored = desktop ? await desktop.loadDesktopSession().catch(() => null) : null
        if (stored?.receipt && desktop && await desktop.verifyOfflineReceipt(stored.receipt) && new Date(stored.receipt.payload.expiresAt).getTime() > Date.now()) setState({ status: 'offline', user: stored.session?.user ?? null, session: stored.session, configured: true, offlineUntil: stored.receipt.payload.expiresAt, error: null })
        else setState(current => ({ ...current, status: 'error', error: reason instanceof Error ? reason.message : '无法验证登录状态' }))
      }
    }
    void boot()
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { if (active) acceptSession(session) }, 0)
    }).data.subscription
    return () => { active = false; subscription?.unsubscribe(); unlistenDesktop?.() }
  }, [acceptSession])
  const run = async <T extends { data: unknown; error: Error | null }>(task: () => Promise<T>): Promise<T['data']> => {
    setState(current => ({ ...current, status: 'loading', error: null }))
    let timeoutId = 0
    try {
      const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error('连接账号服务超时，请检查网络后重试')), 30_000) })
      const result = await Promise.race([task(), timeout])
      if (result.error) throw result.error
      return result.data
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error('账号服务暂时不可用')
      setState(current => ({ ...current, status: 'anonymous', error: error.message }))
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }
  }
  const value = useMemo<AuthContextValue>(() => ({ ...state,
    signIn: async (email, password) => { const client = supabase; if (!client) throw new Error('尚未配置 Supabase'); const data = await run(() => client.auth.signInWithPassword({ email, password })); if (!data.session) throw new Error('登录成功但未收到有效会话，请重试'); acceptSession(data.session) },
    signUp: async (email, password) => { const client = supabase; if (!client) throw new Error('尚未配置 Supabase'); await run(() => client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}#/login` } })) },
    signInWithGitHub: async () => { if (!supabase) throw new Error('尚未配置 Supabase'); if (isDesktopRuntime) { const { openDesktopOAuth } = await import('./desktopAuth'); await openDesktopOAuth(); return } const { error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${window.location.origin}${window.location.pathname}#/app` } }); if (error) throw error },
    resetPassword: async email => { if (!supabase) throw new Error('尚未配置 Supabase'); const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}#/login` }); if (error) throw error },
    signOut: async () => { await supabase?.auth.signOut(); if (isDesktopRuntime) { const { clearDesktopSession } = await import('./desktopAuth'); await clearDesktopSession() } setState(current => ({ ...current, status: 'anonymous', user: null, session: null, offlineUntil: null })) },
  }), [acceptSession, state])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value }
