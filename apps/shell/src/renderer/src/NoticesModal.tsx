/**
 * 帮助 > 第三方软件声明:独立弹窗呈现随包分派的 THIRD-PARTY-NOTICES.txt。
 * 不进设置弹窗(它是阅读器不是配置项),也不走系统查看器(resfile 在应用沙箱里
 * 打不开,拷去公共目录又会给用户的 Documents 留文件)。全文约 1.5MB,一次进
 * <pre> 的布局会卡死渲染进程,按行分页,单页 DOM 恒定约千余行。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from './locale'

/** 单页行数:千余行的文本节点布局毫秒级;页数同时给读者一个全卷的量感 */
const NOTICES_PAGE_LINES = 1200

export function NoticesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [text, setText] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const paneRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    void window.aiOffice.getThirdPartyNotices?.().then(
      (full) => {
        if (alive) setText(full)
      },
      () => {
        // 通道失败(版本偏斜/IPC 拒绝)与文件缺失同样按「声明不可用」呈现
        if (alive) setText('')
      },
    )
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const lines = useMemo(() => (text ? text.split('\n') : []), [text])
  const pageCount = Math.max(1, Math.ceil(lines.length / NOTICES_PAGE_LINES))
  const safePage = Math.min(page, pageCount - 1)
  const pageText = lines
    .slice(safePage * NOTICES_PAGE_LINES, (safePage + 1) * NOTICES_PAGE_LINES)
    .join('\n')
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0
  }, [safePage])

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="set-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('thirdPartyNotices')}
      >
        <div className="set-header">
          <h2 className="set-title">{t('thirdPartyNotices')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {text === null ? null : text === '' ? (
          <div className="set-pane">
            <div className="set-field-desc">{t('setNoticesUnavailable')}</div>
          </div>
        ) : (
          <>
            <div className="set-pane" ref={paneRef}>
              <pre
                style={{
                  margin: 0,
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  userSelect: 'text',
                }}
              >
                {pageText}
              </pre>
            </div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 28px 18px' }}
            >
              <button
                className="set-btn"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                {t('setPrevPage')}
              </button>
              <span className="set-field-desc">
                {t('setNoticesPageOf', { n: safePage + 1, total: pageCount })}
              </span>
              <button
                className="set-btn"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                {t('setNextPage')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
