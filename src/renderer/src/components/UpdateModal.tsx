import { Download, ExternalLink, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { UpdateInfo } from '../../../shared/types'

interface Props {
  info: UpdateInfo
  onClose(): void
}

/** 发现新版本弹窗（用户与参考主题一致——标题/描述、中间 git 更新内容
 *  （Release 正文 markdown 滚动区）、下方官网下载页链接、底部「稍后再说/前往下载」按钮）。
 *  没有 Developer ID 签名，做不了静默安装：这里只负责把 dmg 下到「下载」目录，用户手动拖进应用程序覆盖。 */
export function UpdateModal({ info, onClose }: Props): React.JSX.Element {
  const url = info.htmlUrl ?? 'https://github.com/JoshuaMi449/Reopen/releases/latest'
  const [downloading, setDownloading] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = (): void => {
    void window.api.openExternal(url)
  }

  const download = async (): Promise<void> => {
    if (!info.dmgUrl || !info.latestVersion) return
    setDownloading(true)
    setError(null)
    try {
      const dest = await window.api.downloadUpdate(info.dmgUrl, info.latestVersion)
      setSavedPath(dest)
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败')
    } finally {
      setDownloading(false)
    }
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
          v{info.latestVersion} 已发布
          {savedPath ? '，安装包已下载到「下载」文件夹。' : '，请下载后覆盖安装。'}
        </p>

        {/* git 更新内容（Release 正文；空正文给斜体占位，与参考主题一致） */}
        <div className="update-body">
          {/* 顶部标题与 GitHub 下载页一致：Reopen vX.X.X 更新 */}
          <div className="update-body-title">Reopen v{info.latestVersion} 更新</div>
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

        {savedPath ? (
          <p className="update-fallback">
            安装包在：<code>{savedPath}</code>
            <br />
            打开它，把 Reopen 拖进「应用程序」覆盖即可。当前版本会在下次启动时换成新版。
          </p>
        ) : (
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
        )}
        {error && <p className="update-fallback">下载失败：{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            稍后再说
          </button>
          {savedPath ? (
            <button
              className="btn-primary"
              onClick={() => void window.api.revealInFolder(savedPath)}
            >
              <FolderOpen size={14} /> 打开下载文件夹
            </button>
          ) : info.dmgUrl ? (
            <button className="btn-primary" onClick={() => void download()} disabled={downloading}>
              <Download size={14} /> {downloading ? '下载中…' : '下载安装包'}
            </button>
          ) : (
            <button className="btn-primary" onClick={go}>
              <ExternalLink size={14} /> 前往下载
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
