import { useState } from 'react'
import QrInvite from '../components/QrInvite'

const ACCENT_YELLOW = '#f7d070'
const TITLE_BLUE = '#dceeff'
const PAGE_BG = '#1a1c1e'
const PANEL_BG = '#111214'

// 둥근 모서리의 하얀색 픽셀 브라우저 창
function PixelBoardPreview() {
  return (
    <div
      className="pixel-board-preview relative mx-auto w-full max-w-[15rem] rounded-2xl bg-white p-3"
      style={{ boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
      aria-hidden="true"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#ff5f57' }} />
        <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#febc2e' }} />
        <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#28c840' }} />
        <div className="ml-auto h-3 w-16 rounded-full bg-gray-100" />
      </div>
      <img
        src="/images/entry-pixel-preview.webp"
        alt=""
        width={640}
        height={616}
        loading="eager"
        decoding="async"
        className="block aspect-square w-full rounded-xl object-cover"
      />
    </div>
  )
}

export default function EntryPage({ onNext }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e?.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('이름을 입력해주세요!'); return }
    onNext(trimmed)
  }

  return (
    <div className="entry-page relative h-svh w-screen overflow-y-auto" style={{ background: PAGE_BG }}>
      <QrInvite />

      {/* 오늘의 그림과 어울리는 은은한 청회색 광원 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          style={{
            width: 'min(70vw, 900px)',
            height: 'min(70vw, 900px)',
            background: 'radial-gradient(circle, rgba(43,142,255,0.18) 0%, rgba(89,139,183,0.08) 45%, transparent 72%)',
            filter: 'blur(10px)',
          }}
        />
      </div>

      <main className="entry-shell relative flex min-h-svh w-full items-center justify-center">
        <div className="entry-content flex w-full flex-col items-center text-center">

          <h1
            className="entry-title font-pixel-en flex justify-center whitespace-nowrap leading-[1.4] select-none"
            style={{
              color: TITLE_BLUE,
              textShadow: `
                1px 1px 0 #a8d2f5,
                2px 2px 0 #83bbe9,
                3px 3px 0 #5e9fd8,
                4px 4px 0 #3b82bd,
                5px 6px 8px rgba(0,0,0,0.4),
                0 0 25px rgba(43,142,255,0.46),
                0 0 55px rgba(43,142,255,0.24),
                0 0 90px rgba(43,142,255,0.12)
              `,
            }}
          >
            <span>PIXEL</span>
            <span>ART</span>
          </h1>

          <PixelBoardPreview />

          <p className="entry-description text-gray-300">
            나만의 픽셀 아트를 그려봐요.
          </p>

          <form onSubmit={handleSubmit} className="entry-form flex w-full flex-col items-center">
            <div
              className="entry-input-wrap w-full rounded-2xl"
              style={{
                background: PANEL_BG,
                boxShadow: error ? `inset 0 0 0 2px ${ACCENT_YELLOW}` : 'none',
              }}
            >
              <input
                id="entry-name"
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                placeholder={error || '이름을 입력해요...'}
                maxLength={10}
                autoFocus
                aria-invalid={Boolean(error)}
                className={`entry-input w-full bg-transparent text-center text-white outline-none placeholder:text-gray-600 ${error ? 'entry-input-error' : ''}`}
              />
            </div>

            <button
              type="submit"
              className="entry-button font-pixel-en flex w-full items-center justify-center rounded-full transition-all"
              style={{ background: ACCENT_YELLOW }}
            >
              <span className="entry-button-label leading-none">ENTER</span>
            </button>
          </form>

        </div>
      </main>
    </div>
  )
}
