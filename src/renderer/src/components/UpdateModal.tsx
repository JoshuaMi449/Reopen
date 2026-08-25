import { ExternalLink, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { UpdateInfo } from '../../../shared/types'

interface Props {
  info: UpdateInfo
  onClose(): void
}

/** 发现新版本弹窗（用户与参考主题一致——标题/描述、中间 git 更新内容
 *  （Release 正文 markdown 滚动区）、下方官网下载页链接、底部「稍后再说/前往下载」按钮） */
export function UpdateModal({ info, onClose }: Props): React.JSX.Element {
  const url = info.htmlUrl ?? 'https://github.com/JoshuaMi449/Reopen/releases/latest'
  const go = (): void => {
    void window.api.openExternal(url)
  }
  return (
    <div className="modal-backdrop">
      <div className="modal modal-update">
        <div className="modal-header">
          <h2>发现新版本</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <p className="update-desc">
          v{info.latestVersion} 已发布，请前往下载页面获取最新版本覆盖安装。
        </p>

        {/* git 更新内容（Release 正文；空正文给斜体占位，与参考主题一致） */}
        <div className="update-body">
          {info.body ? (
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault()
                      if (href && /^https?:/.test(href)) window.api.openExternal(href)
                    }}
                  >
                    {children}
                  </a>
                )
              }}
            >
              {info.body}
            </ReactMarkdown>
          ) : (
            <p className="update-body-empty">暂无发布说明</p>
          )}
        </div>

        <p className="update-fallback">
          如果自动更新失败，请前往{' '}
          <a
            href={url}
            className="update-link"
            onClick={(e) => {
              e.preventDefault()
              go()
            }}
          >
            官网下载页
            <ExternalLink size={12} />
          </a>{' '}
          下载最新版本覆盖安装。
        </p>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            稍后再说
          </button>
          <button className="btn-primary" onClick={go}>
            <ExternalLink size={14} /> 前往下载
          </button>
        </div>
      </div>
    </div>
  )
}
