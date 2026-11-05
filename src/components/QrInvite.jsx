import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ACCENT_YELLOW = '#f7d070'
const PANEL_BG = '#111214'

// 첫 화면의 "QR로 학생 초대" — 선생님이 교실 화면에 크게 띄우면 학생이 휴대폰·디벗으로 찍어 들어온다.
// QR은 브라우저 안에서 직접 만든다(외부 QR 서비스로 주소를 보내지 않음). 지금 접속한 주소로
// 만들기 때문에 나중에 도메인이 바뀌어도 다시 만들 필요가 없다.
export default function QrInvite() {
  const [open, setOpen] = useState(false)
  const [qrSrc, setQrSrc] = useState(null)
  const triggerRef = useRef(null)
  const closeRef = useRef(null)
  const url = `${window.location.origin}/`

  useEffect(() => {
    if (!open || qrSrc) return
    // QR 라이브러리는 버튼을 눌렀을 때만 받아 와 첫 화면 로딩을 가볍게 유지한다
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: 'M' }))
      .then(setQrSrc)
      .catch(() => setQrSrc(null))
  }, [open, qrSrc, url])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // QR 창이 떠 있는 동안 뒤쪽 앱 화면(#root)은 키보드·클릭 모두 막는다 — Tab으로 가려진
    // 이름 입력칸이나 ENTER에 닿지 않도록. 포커스는 창 안의 닫기 버튼으로, 닫으면 원래 버튼으로.
    const root = document.getElementById('root')
    if (root) root.inert = true
    closeRef.current?.focus()
    const trigger = triggerRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      if (root) root.inert = false
      trigger?.focus()
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="font-code absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-all hover:brightness-125 active:scale-[0.97]"
        style={{ background: PANEL_BG, color: ACCENT_YELLOW, border: `1px solid ${ACCENT_YELLOW}` }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
        </svg>
        QR로 학생 초대
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex overflow-y-auto p-4"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          {/* m-auto: 화면보다 길어져도 위쪽이 잘리지 않고 스크롤되도록(가운데 정렬은 여백으로) */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-invite-title"
            className="m-auto flex w-full max-w-xl flex-col items-center gap-5 rounded-2xl px-6 py-7"
            style={{ background: PANEL_BG }}
          >
            <p id="qr-invite-title" className="font-code text-center text-2xl text-white sm:text-3xl">휴대폰 카메라로 찍어서 들어와요!</p>
            <div className="w-full rounded-2xl bg-white p-3" style={{ maxWidth: 'min(60vh, 520px)' }}>
              {qrSrc ? (
                <img src={qrSrc} alt={`${url} 접속 QR 코드`} className="block aspect-square w-full" style={{ imageRendering: 'pixelated' }} />
              ) : (
                <div className="aspect-square w-full animate-pulse rounded-xl bg-gray-100" />
              )}
            </div>
            <p className="font-code break-all text-center text-lg text-gray-300 sm:text-xl">{url}</p>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="font-code rounded-full px-10 py-3 text-base text-black transition-all hover:brightness-105 active:scale-[0.97]"
              style={{ background: ACCENT_YELLOW }}
            >
              닫기
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
