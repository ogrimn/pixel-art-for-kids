import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDrive, signIn, signOut } from '../utils/googleDrive'

const ACCENT_YELLOW = '#f7d070'
const PANEL_BG = '#111214'

const CLOUD_PATH = 'M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z'

function CloudIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d={CLOUD_PATH} />
    </svg>
  )
}

// 로그인 실패 사유를 학생도 이해할 수 있는 말로 — 사용자가 팝업을 그냥 닫은 경우는 조용히 넘어간다
function signInErrorMessage(e) {
  const code = e?.message || ''
  if (code === 'popup_closed' || code === 'access_denied') return null
  if (code === 'popup_failed_to_open') return '로그인 창이 막혔어요. 팝업 차단을 풀고 다시 눌러 주세요.'
  if (code === 'gis_not_ready') return '구글 로그인을 준비하고 있어요. 잠시 후 다시 눌러 주세요.'
  if (code === 'drive_scope_denied') return '드라이브 저장에 체크해야 그림을 저장할 수 있어요.'
  return '구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.'
}

function Modal({ children, onClose }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-2xl px-8 pt-6 pb-8 flex flex-col items-center gap-6 mx-4"
        style={{ maxWidth: 400, width: '100%', background: PANEL_BG }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

// 편집 화면 헤더의 구글 드라이브 버튼 — 로그인 전: 연결 안내, 로그인 후: 계정 확인·로그아웃,
// 로그인이 만료되면: 다시 연결. 클라이언트 ID가 설정되지 않은 배포에서는 아예 보이지 않는다.
export default function DriveButton({ onError }) {
  const drive = useDrive()
  const [showConnect, setShowConnect] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [tooltipPos, setTooltipPos] = useState(null)
  const buttonRef = useRef(null)

  if (drive.status === 'disabled') return null

  const handleSignIn = () => {
    setTooltipPos(null)
    setShowConnect(false)
    signIn().catch(e => {
      const msg = signInErrorMessage(e)
      if (msg) onError?.(msg)
    })
  }

  const roundBtn = 'font-pixel w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors hover:brightness-125'
  const tooltipText = drive.status === 'signedIn'
    ? '구글 드라이브 연결됨'
    : drive.status === 'expired'
      ? '구글 드라이브 다시 연결'
      : '구글 로그인'
  const showTooltip = () => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setTooltipPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 })
  }
  const hideTooltip = () => setTooltipPos(null)

  return (
    <>
      {drive.status === 'signedIn' ? (
        <button
          ref={buttonRef}
          onClick={() => { hideTooltip(); setShowAccount(true) }}
          aria-label="구글 드라이브 연결됨"
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          className={`${roundBtn} overflow-hidden`}
          style={{ background: PANEL_BG, border: '2px solid #86efac' }}
        >
          {drive.user?.photoLink ? (
            <img src={drive.user.photoLink} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-sm">{(drive.user?.displayName || '?').slice(0, 1)}</span>
          )}
        </button>
      ) : drive.status === 'expired' ? (
        <button
          ref={buttonRef}
          onClick={handleSignIn}
          disabled={drive.gisLoading || drive.status === 'connecting'}
          aria-label="구글 드라이브 다시 연결"
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          className="font-pixel flex items-center gap-2 h-10 px-4 rounded-full text-sm shrink-0 whitespace-nowrap hover:brightness-125 disabled:cursor-wait disabled:opacity-50"
          style={{ background: PANEL_BG, color: ACCENT_YELLOW, border: `1px solid ${ACCENT_YELLOW}` }}
        >
          <CloudIcon className="w-5 h-5" />
          드라이브 다시 연결
        </button>
      ) : (
        <button
          ref={buttonRef}
          onClick={() => { hideTooltip(); setShowConnect(true) }}
          disabled={drive.status === 'connecting'}
          aria-label="구글 로그인"
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          className={`${roundBtn} text-white disabled:opacity-40`}
          style={{ background: PANEL_BG }}
        >
          <CloudIcon className={`w-5 h-5 ${drive.status === 'connecting' ? 'animate-pulse' : ''}`} />
        </button>
      )}

      {tooltipPos && createPortal(
        <span
          className="font-pixel-kr pointer-events-none fixed z-[999] -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] text-white"
          style={{ top: tooltipPos.top, left: tooltipPos.left, background: '#000000' }}
        >
          {tooltipText}
        </span>,
        document.body
      )}

      {showConnect && (
        <Modal onClose={() => setShowConnect(false)}>
          <div className="text-center flex flex-col gap-3">
            <CloudIcon className="w-10 h-10 mx-auto text-white" />
            <p className="font-pixel font-bold text-base text-white">구글 드라이브에 저장할까요?</p>
            <p className="font-code text-[14px] text-gray-400 leading-relaxed break-keep">
              로그인하면 저장 버튼을 눌렀을 때<br />
              내 구글 드라이브의 <span className="text-white">'픽셀아트'</span> 폴더에 저장돼요.<br />
              다른 기기 스케치북에서 이어 그릴 수 있어요.
            </p>
            <p className="font-code text-[13px] leading-relaxed break-keep" style={{ color: ACCENT_YELLOW }}>
              이 앱은 자기가 만든 그림 파일만 볼 수 있고,<br />
              드라이브의 다른 파일은 볼 수 없어요.
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setShowConnect(false)}
              className="font-pixel font-bold flex-1 py-3 rounded-full text-sm transition-colors active:scale-[0.97]"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}
            >
              취소
            </button>
            <button
              onClick={handleSignIn}
              disabled={drive.gisLoading || drive.status === 'connecting'}
              className="font-pixel font-bold flex-1 py-3 rounded-full text-sm transition-colors active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
              style={{ background: ACCENT_YELLOW, color: '#000000' }}
            >
              {drive.gisLoading ? '로그인 준비 중...' : !drive.gisReady ? '로그인 다시 준비' : drive.status === 'connecting' ? '연결 중...' : '구글로 로그인'}
            </button>
          </div>
        </Modal>
      )}

      {showAccount && (
        <Modal onClose={() => setShowAccount(false)}>
          <div className="text-center flex flex-col gap-2">
            <p className="font-pixel font-bold text-base text-white">구글 드라이브에 연결됨</p>
            <p className="font-code text-[14px] text-gray-300">{drive.user?.displayName}</p>
            <p className="font-code text-[13px] text-gray-500">{drive.user?.emailAddress}</p>
            <p className="font-code text-[13px] text-gray-400 leading-relaxed break-keep mt-2">
              저장 버튼을 누르면 드라이브의 '픽셀아트' 폴더에 저장돼요.<br />
              다른 사람과 같이 쓰는 기기라면 다 쓴 뒤 꼭 로그아웃하고,<br />
              구글 계정에서도 로그아웃해 주세요.
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => { signOut(); setShowAccount(false) }}
              className="font-pixel font-bold flex-1 py-3 rounded-full text-sm transition-colors active:scale-[0.97]"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}
            >
              로그아웃
            </button>
            <button
              onClick={() => setShowAccount(false)}
              className="font-pixel font-bold flex-1 py-3 rounded-full text-sm transition-colors active:scale-[0.97]"
              style={{ background: ACCENT_YELLOW, color: '#000000' }}
            >
              확인
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
