import { useRef, useEffect, useMemo } from 'react'

const ACCENT_YELLOW = '#f7d070'
const PAGE_BG = '#1a1c1e'
const PANEL_BG = '#111214'

function getTextColor(hex) {
  if (!hex || hex.length < 7) return '#333333'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#333333' : '#ffffff'
}

function buildColorMap(pixels, rows, cols) {
  const seen = new Set(), colors = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = pixels[r]?.[c]
      if (v && !seen.has(v)) { seen.add(v); colors.push(v) }
    }
  return Object.fromEntries(colors.map((c, i) => [c, i + 1]))
}

// 도안 캔버스 자체는 항상 흰 배경 + 진한 글자로 직접 그린다(비트맵) — 화면 테마와
// 무관하게 늘 인쇄하기 좋은 배색을 유지하므로, 다크 테마 적용과 별개로 손댈 필요가 없다.
function drawCells(ctx, pixels, colorMap, cols, rows, cs) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cols * cs, rows * cs)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = pixels[r]?.[c]
      const x = c * cs, y = r * cs
      ctx.fillStyle = color ? '#f8f8f8' : '#ffffff'
      ctx.fillRect(x, y, cs, cs)
      ctx.strokeStyle = color ? '#cccccc' : '#ececec'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x + 0.25, y + 0.25, cs - 0.5, cs - 0.5)
      if (color) {
        const fs = Math.max(5, Math.floor(cs * 0.55))
        ctx.fillStyle = '#444444'
        ctx.font = `bold ${fs}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(colorMap[color]), x + cs / 2, y + cs / 2)
      }
    }
  }
}

export default function DoanView({ pixels, gridCols, gridRows, onClose }) {
  const canvasRef = useRef(null)

  const colorMap = useMemo(
    () => buildColorMap(pixels, gridRows, gridCols),
    [pixels, gridRows, gridCols]
  )
  const entries = useMemo(
    () => Object.entries(colorMap).sort((a, b) => a[1] - b[1]),
    [colorMap]
  )

  // Cell size fitted to ~72% viewport width and ~58% height
  const displayCs = useMemo(() => {
    const maxW = Math.min(window.innerWidth * 0.72 - 48, 720)
    const maxH = window.innerHeight * 0.58
    return Math.max(8, Math.min(
      Math.floor(maxW / gridCols),
      Math.floor(maxH / gridRows),
    ))
  }, [gridCols, gridRows])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = gridCols * displayCs
    canvas.height = gridRows * displayCs
    drawCells(canvas.getContext('2d'), pixels, colorMap, gridCols, gridRows, displayCs)
  }, [pixels, colorMap, displayCs, gridCols, gridRows])

  // PNG로 내보낼 때도 인쇄와 동일하게 항상 흰 배경 + 진한 글자로 고정 — 화면 다크 테마와 무관.
  const handleSavePNG = () => {
    const cs = Math.max(20, Math.ceil(800 / Math.max(gridCols, gridRows)))
    const pad = cs * 2
    const swSize = Math.round(cs * 0.85)
    const gap = 6
    const itemsPerRow = Math.max(1, Math.floor((gridCols * cs) / (swSize + gap + 4)))
    const legendRows = Math.ceil(entries.length / itemsPerRow)
    const legendH = Math.round(cs * 1.5) + (swSize + gap) * legendRows + pad

    const off = document.createElement('canvas')
    off.width = gridCols * cs + pad * 2
    off.height = gridRows * cs + pad + legendH
    const ctx = off.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, off.width, off.height)

    ctx.save()
    ctx.translate(pad, pad)
    drawCells(ctx, pixels, colorMap, gridCols, gridRows, cs)
    ctx.restore()

    // Legend title
    const ly0 = gridRows * cs + pad + Math.round(cs * 0.3)
    ctx.fillStyle = '#888888'
    ctx.font = `bold ${Math.round(cs * 0.48)}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('색상 가이드', pad, ly0)

    // Legend swatches
    entries.forEach(([color, num], i) => {
      const col = i % itemsPerRow
      const row = Math.floor(i / itemsPerRow)
      const lx = pad + col * (swSize + gap + 4)
      const ly = ly0 + Math.round(cs * 0.85) + row * (swSize + gap)
      ctx.fillStyle = color
      ctx.fillRect(lx, ly, swSize, swSize)
      ctx.strokeStyle = '#aaaaaa'
      ctx.lineWidth = 0.5
      ctx.strokeRect(lx + 0.5, ly + 0.5, swSize - 1, swSize - 1)
      const tc = getTextColor(color)
      const fs = Math.max(8, Math.floor(swSize * 0.5))
      ctx.fillStyle = tc
      ctx.font = `bold ${fs}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(num), lx + swSize / 2, ly + swSize / 2)
    })

    const a = document.createElement('a')
    a.download = '픽셀아트_도안.png'
    a.href = off.toDataURL('image/png')
    a.click()
  }

  return (
    <div className="flex flex-col w-full" style={{ height: '100%' }}>

      {/* ── Toolbar (인쇄 시 완전히 숨김 — doan-no-print) ─────────────────── */}
      <div
        className="doan-no-print flex items-center justify-between px-4 py-2.5 flex-shrink-0"
        style={{ background: PAGE_BG, borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <span className="font-pixel text-sm text-white">숫자 색칠 도안</span>
          {entries.length > 0 && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: PANEL_BG, color: '#9ca3af' }}
            >
              {entries.length}가지 색상
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => window.print()}
            className="font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-colors hover:brightness-125"
            style={{ background: PANEL_BG, color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            ⎙ 인쇄하기
          </button>
          <button
            onClick={handleSavePNG}
            disabled={entries.length === 0}
            className="font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-black transition-all hover:brightness-105 disabled:opacity-30"
            style={{ background: ACCENT_YELLOW }}
          >
            ↓ 이미지 저장
          </button>
          <button
            onClick={onClose}
            className="font-pixel flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-colors hover:brightness-125"
            style={{ background: PANEL_BG, color: '#9ca3af', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            ✕ 닫기
          </button>
        </div>
      </div>

      {/* ── Print area ───────────────────────────────────────────────────
          화면에서는 다크 테마(PAGE_BG)로 보이지만, 인쇄할 때는 print:!bg-white가
          어떤 인라인 배경색보다도(!important) 우선해 항상 흰 배경으로 강제 반전된다. */}
      <div
        id="doan-print-area"
        className="flex-1 overflow-y-auto print:!bg-white"
        style={{ background: PAGE_BG, padding: 24 }}
      >
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <p className="font-pixel-kr text-lg sm:text-xl font-bold text-gray-500">캔버스에 그림을 먼저 그려주세요</p>
            <button
              onClick={onClose}
              className="font-pixel-kr text-xs font-semibold hover:underline"
              style={{ color: ACCENT_YELLOW }}
            >
              ← 편집으로 돌아가기
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">

            {/* ── 인쇄 전용 헤더 — 화면에서 숨김, 출력 시에만 표시(원래부터 흰 배경 기준 진한 색) ── */}
            <div className="doan-print-header w-full">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                {/* 로고 */}
                <div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {['#F87171', '#FCD34D', '#4ADE80', '#6366F1'].map((c, i) => (
                      <div key={i} style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                    ))}
                  </div>
                  <h1
                    className="font-pixel"
                    style={{ fontSize: '1.9rem', color: '#1E1B4B', margin: 0, lineHeight: 1.15 }}
                  >
                    PIXEL ART
                  </h1>
                  <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 600 }}>
                    숫자를 보고 같은 번호의 색을 칠해봐요!
                  </p>
                </div>
                {/* 이름 칸 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#4B5563', whiteSpace: 'nowrap' }}>
                    이름
                  </span>
                  <div style={{ width: 160, borderBottom: '2.5px solid #D1D5DB' }} />
                </div>
              </div>
              <div style={{ height: 1.5, background: '#E5E7EB', marginTop: 14 }} />
            </div>

            {/* Diagram canvas — 캔버스 자체는 항상 흰 배경(drawCells)이라 그대로 두고,
                감싸는 카드만 화면에서 다크 톤으로 보이게 한다. 인쇄 시에는 기존 .doan-canvas-wrap
                규칙이 background/box-shadow를 !important로 지워 부모의 흰 배경이 그대로 드러난다. */}
            <div
              className="doan-canvas-wrap rounded-2xl p-4 overflow-auto"
              style={{ background: PANEL_BG, boxShadow: '0 2px 12px rgba(0,0,0,0.35)' }}
            >
              <canvas
                ref={canvasRef}
                style={{ display: 'block', imageRendering: 'pixelated' }}
              />
            </div>

            {/* Color legend */}
            <div
              className="doan-legend-wrap rounded-2xl p-4"
              style={{
                background: PANEL_BG,
                maxWidth: Math.min(gridCols * displayCs + 32, window.innerWidth - 80),
                width: '100%',
                boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-gray-500 print:!text-black">
                색상 가이드
              </p>
              <div className="flex flex-wrap gap-2">
                {entries.map(([color, num]) => (
                  <div
                    key={color}
                    title={`${num}번: ${color}`}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{
                      background: color,
                      color: getTextColor(color),
                      // 중간 톤 회색 테두리 — 화면의 어두운 배경과 인쇄 시 흰 배경 둘 다에서 잘 보인다.
                      boxShadow: '0 0 0 1px rgba(128,128,128,0.6)',
                    }}
                  >
                    {num}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
