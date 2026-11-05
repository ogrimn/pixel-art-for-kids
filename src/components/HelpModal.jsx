import { useState } from 'react'
import copyIcon from '../assets/copy-icon.png'

const ACCENT_YELLOW = '#f7d070'
const PAGE_BG = '#1a1c1e'
const PANEL_BG = '#111214'

function Row({ icon, wide, children }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl py-3 px-5 ${wide ? 'col-span-2' : ''}`}
      style={{ background: PANEL_BG }}
    >
      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
        {icon}
      </div>
      <p className="font-code text-[16.94px] text-gray-300 leading-snug">{children}</p>
    </div>
  )
}

// 밑그림 가이드처럼 세부 기능이 여러 개로 늘어난 카드만 접기/펼치기로 처리 — 평소엔 한 줄
// 요약만 보여줘서 화면이 복잡해 보이지 않고, 궁금하면 눌러서 나머지 기능을 볼 수 있게 한다.
function ExpandableRow({ icon, summary, details }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl col-span-2 overflow-hidden" style={{ background: PANEL_BG }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 py-3 px-5 text-left"
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {icon}
        </div>
        <p className="flex-1 font-code text-[16.94px] text-gray-300 leading-snug">{summary}</p>
        <span className="text-gray-500 text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pb-3 px-5 pl-[3.75rem]">
          {details.map((d, i) => (
            <p key={i} className="font-code text-[15.73px] text-gray-400 leading-snug">· {d}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function Icon({ src, alt }) {
  return <img src={src} alt={alt} className="w-6 h-6 invert flex-shrink-0" />
}

// Lucide "Plus" 아이콘(https://lucide.dev/icons/plus)을 그대로 재현한 인라인 SVG —
// 사이드바 밑그림 업로드 박스(EditorPage.jsx)의 + 아이콘과 동일한 모양으로 통일한다.
function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 flex-shrink-0"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export default function HelpModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-2xl w-full max-w-6xl max-h-[85vh] flex flex-col"
        style={{ background: PAGE_BG, border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-end px-6 pt-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            style={{ background: PANEL_BG }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pt-0 pb-5 flex flex-col gap-4">

          <div className="flex flex-col gap-2">
            <p className="font-pixel text-lg font-bold tracking-tight" style={{ color: ACCENT_YELLOW }}>
              그리기 기능
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Row
                wide
                icon={<span className="text-lg font-bold" style={{ color: '#86efac' }}>✓</span>}
              >
                작업 중인 그림이{' '}
                <span className="font-bold" style={{ color: '#86efac' }}>나의 스케치북</span>
                에 실시간으로 자동 저장되어, 언제든 이어서 그릴 수 있어요!
              </Row>

              <ExpandableRow
                icon={<PlusIcon />}
                summary="캔버스 배경에 참고할 사진을 불러오고 위치나 크기를 조절해요."
                details={[
                  '사이드바 박스를 클릭하거나 이미지를 드래그해서 밑그림을 불러와요.',
                  '사이드바에서 크기를 조절할 수 있어요.',
                  <>
                    눈 버튼(
                    <img src="/images/eye.png" alt="보이기" className="inline-block w-4 h-4 mx-0.5 invert align-text-bottom" />
                    : 보이기), (
                    <img src="/images/hide.png" alt="숨기기" className="inline-block w-4 h-4 mx-0.5 invert align-text-bottom" />
                    : 숨기기)으로 밑그림을 보이거나 숨길 수 있어요.
                  </>,
                  '미리보기 우측 하단의 이동 버튼(✜)을 누르고 캔버스를 드래그하여 밑그림 위치를 옮겨요.',
                ]}
              />

              <Row icon={<Icon src="/images/photo.png" alt="나의 스케치북" />}>
                내가 그린 작품들을 임시 보관함에 저장하고 다시 불러와요.
              </Row>

              <Row icon={<Icon src="/images/doan.png" alt="도안 만들기" />}>
                내가 그린 도트를 컬러링 도안으로 만들어 인쇄해요.
              </Row>

              <Row icon={<Icon src={copyIcon} alt="그림 복사하기" />}>
                그림을 복사해서 우리 반 게시판에 바로 붙여넣기 해요.
              </Row>

              <Row icon={<Icon src="/images/downloads.png" alt="그림 저장(PNG)" />}>
                완성한 도트 그림을 이미지 파일(PNG)로 저장해요. 구글 드라이브에 로그인했다면 내 드라이브에 저장돼요.
              </Row>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-pixel text-lg font-bold tracking-tight" style={{ color: ACCENT_YELLOW }}>
              나가기 기능
            </p>

            <Row icon={<Icon src="/images/home.png" alt="처음 화면으로" />}>
              캔버스 설정을 변경할 수 있도록 이전 화면으로 돌아가요.
            </Row>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={onClose}
            className="font-pixel w-full py-4 rounded-full text-xl text-black font-bold transition-all hover:brightness-105 active:scale-[0.98]"
            style={{ background: ACCENT_YELLOW }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
