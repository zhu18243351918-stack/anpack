import { ArrowLeft, Box } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function LegalPage({ kind }: { kind: 'privacy' | 'licenses' }) {
  return <main className="legal-page"><header><Link className="site-brand" to="/"><span><Box size={18}/></span><b>Anpack</b></Link><Link to="/"><ArrowLeft size={15}/>返回官网</Link></header><article>{kind==='privacy'?<><small>PRIVACY / LOCAL-FIRST</small><h1>隐私说明</h1><p>Anpack 的包装项目、模型、贴图和渲染结果默认只保存在你的浏览器或电脑中，不上传至 Supabase。</p><h2>账号数据</h2><p>登录服务仅处理邮箱、GitHub公开身份、会话令牌和必要的安全日志。桌面离线凭证有效期为30天。</p><h2>本地文件</h2><p>只有在你主动选择导入、储存或导出时，Anpack 才会访问对应文件。浏览器版受浏览器权限机制限制，桌面版通过系统文件选择器授权。</p><h2>第三方服务</h2><p>账号由 Supabase 托管，代码和安装包由 GitHub 发布。请同时查看这些服务各自的隐私政策。</p></>:<><small>LICENSES / REDISTRIBUTION</small><h1>软件与第三方许可</h1><p>Anpack 源码公开可查看，但保留全部权利。未经书面授权，不得复制、修改、再发布或用于衍生商业产品。</p><h2>Blender</h2><p>桌面安装包包含未经修改的官方 Blender 4.5 LTS 便携运行时。Blender 依据 GNU GPL 发布，并与 Anpack 通过独立进程及 GLB/JSON 文件通信。</p><h2>开源组件</h2><p>React、Three.js、Tauri、Zustand、Supabase SDK 等组件保留其各自许可。发布构建会生成完整第三方许可清单。</p><h2>来源与校验</h2><p>请仅从 Anpack 官网或官方 GitHub Releases 获取安装程序，并使用发布页面提供的 SHA-256 校验文件完整性。</p></>}</article></main>
}
