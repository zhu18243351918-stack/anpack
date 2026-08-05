import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import App from './App'
import { AuthProvider, useAuth } from './auth'
import MarketingPage from './MarketingPage'
import AuthPage from './AuthPage'
import LegalPage from './LegalPage'
import { isDesktopRuntime } from './runtime'
import { platform } from './platform'
import { useEffect, useState } from 'react'

function ProtectedEditor() {
  const auth = useAuth(); const location = useLocation()
  if (auth.status === 'loading') return <div className="auth-loading"><span className="brand-orbit" /><b>正在验证 Anpack 账号</b><small>项目文件始终保留在本机</small></div>
  if (auth.status !== 'authenticated' && auth.status !== 'offline') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <div className="editor-host"><App /></div>
}

function DesktopStart() {
  const auth = useAuth()
  return <Navigate to={auth.status === 'authenticated' || auth.status === 'offline' ? '/app' : '/login'} replace />
}

function DesktopUpdateNotice() {
  const [update, setUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (isDesktopRuntime) void platform.checkForUpdates().then(setUpdate).catch(() => null) }, [])
  if (!update) return null
  return <div className="desktop-update"><span>发现 Anpack {update.version}</span><button disabled={busy} onClick={() => { setBusy(true); void update.install().finally(() => setBusy(false)) }}>{busy ? '正在安装…' : '下载并安装'}</button><button aria-label="关闭更新提示" onClick={() => setUpdate(null)}>×</button></div>
}

export default function AppRoot() {
  return <AuthProvider><HashRouter><DesktopUpdateNotice /><Routes>
    <Route path="/" element={isDesktopRuntime ? <DesktopStart /> : <MarketingPage />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/reset-password" element={<AuthPage mode="reset" />} />
    <Route path="/app" element={<ProtectedEditor />} />
    <Route path="/privacy" element={<LegalPage kind="privacy" />} />
    <Route path="/licenses" element={<LegalPage kind="licenses" />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></HashRouter></AuthProvider>
}
