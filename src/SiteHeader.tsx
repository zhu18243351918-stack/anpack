import { Box, Download, LogIn } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth'

export default function SiteHeader() {
  const auth = useAuth(); const signedIn = auth.status === 'authenticated' || auth.status === 'offline'
  return <header className="site-header"><Link className="site-brand" to="/"><span><Box size={18} /></span><b>Anpack</b><i>PACKAGING STUDIO</i></Link><nav><a href="#workflow">工作流</a><a href="#features">功能</a><a href="#desktop">桌面版</a><a href="#faq">FAQ</a></nav><div><a className="site-download-link" href="#desktop"><Download size={15} />Windows</a><Link className="site-primary" to={signedIn ? '/app' : '/login'}><LogIn size={15} />{signedIn ? '进入工作台' : '登录使用'}</Link></div></header>
}
