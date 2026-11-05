import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import PixelCanvas from '../components/PixelCanvas'
import HelpModal from '../components/HelpModal'
import DoanView from '../components/DoanView'
import SketchbookModal from '../components/SketchbookModal'
import DriveButton from '../components/DriveButton'
import copyIcon from '../assets/copy-icon.png'
import { decodeTracingBitmap, sampleContainColor } from '../utils/tracingBitmap'
import { drawLoupe } from '../utils/loupe'
import { PRESET_COLORS } from '../utils/palette'
import { useDrive, saveArtworkToDrive } from '../utils/googleDrive'

const MAX_HISTORY = 20
const SKETCHBOOK_KEY = 'pixel_art_sketchbook'
const ACCENT_YELLOW = '#f7d070'
const DANGER = '#f87171'
const PAGE_BG = '#1a1c1e'
const PANEL_BG = '#111214'
// 저해상도 그리드(예: 28×21, 32×32)를 그대로 저장하면 결과물이 작고 흐릿하게 보인다 —
// 항상 최소 1024px, 칸당 최소 32px로 업스케일한 오프스크린 캔버스에 다시 그려 내보낸다.
const EXPORT_MIN_PX = 1024
const EXPORT_MIN_CELL_PX = 32
// 드라이브 저장은 로컬 자동 저장(0.5초)보다 느긋하게 — 그리는 동안 업로드가 계속 쌓이지 않도록
const DRIVE_SAVE_DELAY = 3000

// 로컬 스케치북 항목에 그 작품이 저장된 드라이브 파일 ID를 함께 기록해 둔다
function readSketchbook() {
  return JSON.parse(localStorage.getItem(SKETCHBOOK_KEY) || '[]')
}
function rememberDriveId(projectId, driveId) {
  const all = readSketchbook()
  const item = all.find(it => it.id === projectId)
  if (!item || item.driveId === driveId) return
  item.driveId = driveId
  localStorage.setItem(SKETCHBOOK_KEY, JSON.stringify(all))
}

const TOOLS = [
  { id: 'pen',        iconSrc: '/images/draw.png',       title: '펜' },
  { id: 'bucket',     iconSrc: '/images/bucket.png',     title: '페인트통' },
  { id: 'eraser',     iconSrc: '/images/eraser.png',     title: '지우개' },
  { id: 'eyedropper', iconSrc: '/images/eyedropper.png', title: '스포이드' },
]

function ToolIcon({ tool, active, className = '' }) {
  if (tool.iconSrc) {
    return <img src={tool.iconSrc} alt={tool.title} className={`${className} ${active ? '' : 'invert'}`} />
  }
  return <span className={className}>{tool.icon}</span>
}

function makeEmpty(rows, cols) {
  return Array(rows).fill(null).map(() => Array(cols).fill(null))
}

function SectionLabel({ children }) {
  return (
    <p className="font-code text-[14px] font-bold text-gray-400 uppercase tracking-wider mb-3">
      {children}
    </p>
  )
}

function HeaderBtn({ onClick, disabled, children, title, variant = 'ghost', iconOnly = true, size = 'md', className = 'inline-flex' }) {
  const base = 'font-pixel flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed select-none whitespace-nowrap shrink-0'
  const iconSizes = { md: 'w-10 h-10 rounded-full text-lg', lg: 'w-11 h-11 rounded-full text-lg' }
  const shape = iconOnly ? iconSizes[size] : 'gap-2 px-5 py-2.5 rounded-full text-sm'
  const styles = {
    ghost:   'bg-[#111214] text-white hover:brightness-125',
    danger:  'bg-[#111214] text-white hover:text-red-400',
    primary: 'bg-[#f7d070] text-black font-bold hover:brightness-105',
  }
  const btnRef = useRef(null)
  const [tooltipPos, setTooltipPos] = useState(null)

  const showTooltip = () => {
    if (!title || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setTooltipPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 })
  }
  const hideTooltip = () => setTooltipPos(null)

  return (
    <div className={className}>
      <button
        ref={btnRef}
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        className={`${base} ${shape} ${styles[variant]}`}
      >
        {children}
      </button>
      {tooltipPos && createPortal(
        <span
          className="font-pixel-kr pointer-events-none fixed z-[999] -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] text-white"
          style={{ top: tooltipPos.top, left: tooltipPos.left, background: '#000000' }}
        >
          {title}
        </span>,
        document.body
      )}
    </div>
  )
}

export default function EditorPage({ userName, gridCols, gridRows, resumeArtwork, onGoToSetup, onEditArtwork }) {
  const [pixels, setPixels] = useState(() => (
    resumeArtwork?.pixels ? resumeArtwork.pixels.map(row => [...row]) : makeEmpty(gridRows, gridCols)
  ))
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0])
  const [recentColors, setRecentColors] = useState([])
  const [tool, setTool] = useState('pen')
  const [zoom, setZoom] = useState(1)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false) // 모바일 폭에서 도구/색상 사이드바를 하단 시트로 접었다 폈다 하는 토글
  const [showSketchbook, setShowSketchbook] = useState(false)
  const [showBackModal, setShowBackModal] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saveFileName, setSaveFileName] = useState('')
  const [doanMode, setDoanMode] = useState(false)
  const [toast, setToast] = useState(null)
  const [tracingImage, setTracingImage] = useState(null)
  const [tracingOpacity, setTracingOpacity] = useState(0.25)
  const [tracingScale, setTracingScale] = useState(1) // 밑그림 크기 조절 슬라이더 — 1 = 100%
  const [tracingVisible, setTracingVisible] = useState(true) // 눈동자 토글 — 잠시 숨기기(불투명도만 0으로, 크기값은 보존)
  const [tracingOffset, setTracingOffset] = useState({ x: 0, y: 0 }) // 밑그림 위치 이동(px, CSS 픽셀 기준)
  const [tracingMoveMode, setTracingMoveMode] = useState(false) // true면 캔버스 드래그가 펜/지우개 대신 밑그림 이동으로 처리됨
  // 펜/지우개/채우기 등으로 실제 캔버스를 한 번이라도 변경했는지 — false인 동안은 아무 작업도
  // 안 한 빈 캔버스이므로 스케치북에 저장하지 않는다(handleCommit에서만 true로 전환).
  const [isDirty, setIsDirty] = useState(false)
  const toastTimer = useRef(null)
  const prevToolRef = useRef('pen')  // eyedrop 취소 시 이전 도구 복원용
  const sidebarTracingInputRef = useRef(null)
  const saveFileInputRef = useRef(null)
  const [isDraggingTracing, setIsDraggingTracing] = useState(false) // 밑그림 박스 위로 파일을 드래그 중인지
  // 사이드바의 밑그림 원본 미리보기 썸네일에서도 스포이드로 색을 뽑을 수 있도록, 캔버스와는
  // 별도로 이 썸네일 전용 오프스크린 비트맵을 디코딩해둔다 (PixelCanvas 내부 상태와 무관).
  const tracingThumbBitmapRef = useRef(null)
  // 캔버스와 같은 스타일의 확대 돋보기를 썸네일에서도 보여주기 위한 ref (썸네일이 작아서
  // 격자 한 칸의 실제 픽셀 간격만 더 좁게 잡는다).
  const thumbLoupeWrapRef = useRef(null)
  const thumbLoupeCanvasRef = useRef(null)
  const THUMB_LOUPE_STEP = 5

  useEffect(() => {
    if (!tracingImage) { tracingThumbBitmapRef.current = null; return }
    tracingThumbBitmapRef.current = null
    return decodeTracingBitmap(tracingImage, bmp => { tracingThumbBitmapRef.current = bmp })
  }, [tracingImage])

  // 스포이드가 아닌 도구로 바뀌면(또는 밑그림이 사라지면) 썸네일 돋보기도 확실히 숨긴다.
  useEffect(() => {
    if (tool !== 'eyedropper' && thumbLoupeWrapRef.current) {
      thumbLoupeWrapRef.current.style.display = 'none'
    }
  }, [tool])

  // 썸네일은 transform(이동/확대) 없이 object-fit:contain으로만 배치되므로, 클릭 지점의
  // box 기준 로컬 좌표를 그대로 sampleContainColor에 넘기면 된다.
  const pickThumbnailColorAt = (e) => {
    const bmp = tracingThumbBitmapRef.current
    if (!bmp) return null
    const rect = e.currentTarget.getBoundingClientRect()
    return sampleContainColor(bmp, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
  }

  const handleThumbnailEyedropMove = (e) => {
    if (tool !== 'eyedropper') return
    const bmp = tracingThumbBitmapRef.current
    const wrap = thumbLoupeWrapRef.current
    const loupeCanvas = thumbLoupeCanvasRef.current
    if (!bmp || !wrap || !loupeCanvas) return
    const rect = e.currentTarget.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top
    const color = sampleContainColor(bmp, localX, localY, rect.width, rect.height)
    if (color) handleColorHover(color)
    drawLoupe(loupeCanvas, (dx, dy) =>
      sampleContainColor(bmp, localX + dx * THUMB_LOUPE_STEP, localY + dy * THUMB_LOUPE_STEP, rect.width, rect.height))
    wrap.style.left = `${e.clientX}px`
    wrap.style.top = `${e.clientY - 14}px`
    wrap.style.display = 'block'
  }

  const handleThumbnailEyedropLeave = () => {
    if (thumbLoupeWrapRef.current) thumbLoupeWrapRef.current.style.display = 'none'
  }

  const handleThumbnailEyedropClick = (e) => {
    if (tool !== 'eyedropper') return
    e.stopPropagation()
    const color = pickThumbnailColorAt(e)
    handleColorPick(color || '#ffffff')
  }

  // 자동 저장이 덮어쓸 스케치북 항목의 고유 ID. 불러온 작품이면 그 ID를 그대로 이어받고,
  // 새로 시작한 캔버스면 이 세션 동안 고정되는 새 ID를 발급해 매번 새 항목이 쌓이지 않게 한다.
  const projectIdRef = useRef(resumeArtwork?.id ?? Date.now())
  const currentFileNameRef = useRef(resumeArtwork?.fileName || null)
  // 마지막으로 저장을 예약한 pixels 참조 — 최초값과 동일하면(StrictMode의 개발 모드 이펙트
  // 이중 실행 포함) 실제 편집이 아니므로 자동 저장을 건너뛴다.
  const lastQueuedPixelsRef = useRef(pixels)
  // 파일에서 불러온 그림은 아직 스케치북에 없으므로, 첫 수정으로 자동 저장되기 전까지 '저장됨'을 띄우지 않는다
  const [saveStatus, setSaveStatus] = useState(resumeArtwork && !resumeArtwork.imported ? 'saved' : 'idle') // 'idle' | 'pending' | 'saved'
  const [isFullscreen, setIsFullscreen] = useState(false)
  const drive = useDrive()
  const driveSignedIn = drive.status === 'signedIn'
  // 지금 작업 중인 작품이 저장될 드라이브 파일 — driveProjectRef는 이 ID가 어느 슬롯(projectId)의 것인지
  const driveIdRef = useRef(resumeArtwork?.driveId || null)
  const driveProjectRef = useRef(projectIdRef.current)
  const driveQueueRef = useRef(Promise.resolve()) // 업로드가 겹치지 않도록 한 줄로 세운다
  const driveTimerRef = useRef(null)
  const lastDriveQueuedRef = useRef(pixels)
  const [driveSaveStatus, setDriveSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'

  // 브라우저 자체 ESC 키 등으로도 전체화면이 풀릴 수 있어, fullscreenchange를 구독해
  // 버튼 아이콘/상태를 실제 전체화면 여부와 항상 동기화한다.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // 파일 입력(클릭)과 드래그 앤 드롭이 같은 검증·로드 로직을 공유하도록 분리
  const processTracingFile = (file) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('PNG, JPG 또는 WebP 파일만 업로드할 수 있어요!')
      return
    }
    // 도안이 깔리기 직전 상태(그림+밑그림)를 강제로 되돌리기 지점에 밀어 넣는다 —
    // 도안이 적용되는 즉시 [되돌리기]가 활성화되고, 누르면 도안이 들어오기 전으로 깨끗이 복원된다.
    const beforePixels = pixels.map(r => [...r])
    const beforeTracingImage = tracingImage
    const reader = new FileReader()
    reader.onload = (ev) => {
      setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), { pixels: beforePixels, tracingImage: beforeTracingImage }])
      setFuture([])
      setTracingImage(ev.target.result)
      setTracingOffset({ x: 0, y: 0 }) // 새로 불러온 밑그림은 이전 이미지의 위치를 물려받지 않고 중앙에서 시작
    }
    reader.readAsDataURL(file)
  }

  const handleTracingUpload = (e) => {
    processTracingFile(e.target.files[0])
    e.target.value = ''
  }

  // 밑그림이 없을 때만 드롭으로 새 이미지를 받는다 — 이미지가 있으면
  // 미리보기 박스가 순수 미리보기 역할이라 드롭을 무시한다.
  const handleTracingDrop = (e) => {
    e.preventDefault()
    setIsDraggingTracing(false)
    if (tracingImage) return
    processTracingFile(e.dataTransfer.files?.[0])
  }

  // 밑그림이 사라지면(전체 지우기·되돌리기·다시하기로 tracingImage → null이 되는 모든 경로 포함)
  // 크기 슬라이더와 보이기/숨기기 상태도 함께 기본값(100%, 보이기)으로 리셋한다.
  useEffect(() => {
    if (!tracingImage) {
      setTracingScale(1)
      setTracingVisible(true)
      setTracingOffset({ x: 0, y: 0 })
      setTracingMoveMode(false)
    }
  }, [tracingImage])

  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

  const addRecentColor = useCallback((color) => {
    setRecentColors(prev => [color, ...prev.filter(c => c !== color)].slice(0, 7))
  }, [])

  const handleColorPick = useCallback((color) => {
    setSelectedColor(color)
    setRecentColors(prev => [color, ...prev.filter(c => c !== color)].slice(0, 7))
    setTool('pen')
    setToast('색상을 추출했어요!')
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }, []) // state setters are stable — no deps needed

  // 스포이드 사용 중 커서만 움직여도(클릭 전) 실시간으로 색상 미리보기만 갱신 — 데스크탑
  // 네이티브 스포이드의 돋보기 미리보기와 비슷한 경험. 최근 색상/토스트/도구 전환 같은
  // "확정" 동작은 하지 않는다(그건 실제 클릭 때 handleColorPick이 담당).
  const handleColorHover = useCallback((color) => {
    if (color) setSelectedColor(color)
  }, [])

  // 도구를 바꿀 때는 항상 "밑그림 이동" 모드를 함께 꺼서, 이동 모드가 캔버스 위 오버레이로
  // 남아 포인터 이벤트를 가로채고(그리기/스포이드가 먹통이 되고 커서도 grab으로 고정되는 원인) 있지 않게 한다.
  const selectTool = (id) => {
    setTracingMoveMode(false)
    setTool(id)
  }

  // EyeDropper API: 화면 어디서든 색상 추출
  const handleEyedrop = async (currentTool) => {
    prevToolRef.current = currentTool  // ESC 취소 시 복원할 도구 저장
    setTracingMoveMode(false)  // 밑그림 이동 모드가 켜져 있으면 스포이드 클릭이 가로막히므로 항상 꺼둔다

    // 터치 기기(크롬북 터치스크린 등)는 window.EyeDropper가 존재해도 그 오버레이가
    // 마우스 이벤트 기준으로 동작해 터치 입력을 인식하지 못하는 경우가 있다 —
    // 터치가 가능한 기기에서는 항상 캔버스 폴백 스포이드(PixelCanvas의 Pointer Events 기반
    // 좌표 계산)로 처리한다.
    // ChromeOS는 트랙패드만 있는 기종이라도(터치 미감지) 기기 관리 정책(화면 캡처 제한 등)
    // 때문에 네이티브 EyeDropper가 조용히 실패하는 경우가 있어, 터치 여부와 무관하게 항상
    // 캔버스 폴백을 사용한다.
    const isTouchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const isChromeOS = navigator.userAgent.includes('CrOS')
    if (!('EyeDropper' in window) || isTouchCapable || isChromeOS) {
      // Safari 등 미지원 브라우저, 터치 기기, 또는 ChromeOS → 캔버스 스포이드 모드로 전환
      setTool('eyedropper')
      showToast('캔버스를 눌러 색상을 추출하세요')
      return
    }

    setTool('eyedropper')  // 버튼 하이라이트 표시
    try {
      const result = await new window.EyeDropper().open()
      handleColorPick(result.sRGBHex)  // 색상 등록 + 최근 색상 추가 + 펜 모드 복귀
    } catch (e) {
      if (e.name === 'AbortError') {
        // ESC 취소 — 조용히 이전 도구로 복원
        setTool(prevToolRef.current)
        return
      }
      // 그 외 예기치 못한 에러(기기 정책 등으로 인한 실패) — 조용히 되돌리지 않고
      // 캔버스 폴백으로 전환해 사용자가 계속 색상을 추출할 수 있게 한다.
      console.warn('EyeDropper error:', e)
      setTool('eyedropper')
      showToast('캔버스를 눌러 색상을 추출하세요')
    }
  }

  const renderExportCanvas = useCallback(() => {
    const scale = Math.max(EXPORT_MIN_CELL_PX, Math.ceil(EXPORT_MIN_PX / Math.min(gridCols, gridRows)))
    const off = document.createElement('canvas')
    off.width = gridCols * scale
    off.height = gridRows * scale
    const ctx = off.getContext('2d')
    ctx.imageSmoothingEnabled = false // 칸을 확대해도 경계가 흐려지지 않고 또렷하게 유지
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, off.width, off.height)
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (pixels[r][c]) {
          ctx.fillStyle = pixels[r][c]
          ctx.fillRect(c * scale, r * scale, scale, scale)
        }
      }
    }
    return off
  }, [pixels, gridCols, gridRows])

  const getDataURL = useCallback(() => (
    renderExportCanvas().toDataURL('image/png')
  ), [renderExportCanvas])

  // 붙여넣기용 PNG Blob — 클립보드 API는 Blob(또는 Blob을 반환하는 Promise)만 받는다.
  const getCanvasBlob = useCallback(() => (
    new Promise(resolve => renderExportCanvas().toBlob(resolve, 'image/png'))
  ), [renderExportCanvas])

  // [그림 복사하기] — Safari 등에서 "사용자 클릭 안에서 동기적으로 호출"해야 하는
  // 제약이 있어, blob을 미리 await하지 않고 Promise 그대로 ClipboardItem에 넘긴다.
  const handleCopyImage = useCallback(async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      showToast('이 브라우저는 이미지 복사를 지원하지 않아요 😢')
      return
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': getCanvasBlob() }),
      ])
      showToast('복사 완료! 원하는 곳에 바로 붙여넣기 하세요')
    } catch (err) {
      console.warn(err)
      showToast('복사에 실패했어요. 다시 시도해주세요!')
    }
  }, [getCanvasBlob])

  // 히스토리/미래 스택의 각 항목은 { pixels, tracingImage } 형태 — 그림뿐 아니라 밑그림
  // 유무도 함께 스냅샷해야, 도안을 불러온 뒤 되돌리기를 눌렀을 때 밑그림까지 깨끗이 사라진다.
  const handleCommit = useCallback((newPixels) => {
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), { pixels: pixels.map(r => [...r]), tracingImage }])
    setFuture([])
    setPixels(newPixels)
    setIsDirty(true) // 펜/지우개/채우기로 실제 캔버스가 바뀐 순간 — 이제부터 저장할 가치가 있다
  }, [pixels, tracingImage])

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (!prev.length) return prev
      const restored = prev[prev.length - 1]
      setFuture(f => [{ pixels: pixels.map(r => [...r]), tracingImage }, ...f])
      setPixels(restored.pixels)
      setTracingImage(restored.tracingImage)
      return prev.slice(0, -1)
    })
  }, [pixels, tracingImage])

  const handleRedo = useCallback(() => {
    setFuture(prev => {
      if (!prev.length) return prev
      const restored = prev[0]
      setHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { pixels: pixels.map(r => [...r]), tracingImage }])
      setPixels(restored.pixels)
      setTracingImage(restored.tracingImage)
      return prev.slice(1)
    })
  }, [pixels, tracingImage])

  // 불러온 작품이 있으면 그 파일명을 기본값으로, 없으면 오늘 날짜 기반 이름을 생성
  const buildDefaultFileName = useCallback(() => {
    if (resumeArtwork?.fileName) return resumeArtwork.fileName
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    return `픽셀아트_${userName}_${y}${m}${d}`
  }, [resumeArtwork, userName])

  const openSaveModal = useCallback(() => {
    setSaveFileName(buildDefaultFileName())
    setIsSaveModalOpen(true)
  }, [buildDefaultFileName])

  // 스케치북 항목 하나의 공통 필드(제목/ID/시각 제외) — 자동 저장과 수동 저장이 함께 사용
  const buildSketchbookEntry = useCallback(() => ({
    userName,
    pixels,
    dataUrl: getDataURL(),
    cols: gridCols,
    rows: gridRows,
  }), [userName, pixels, getDataURL, gridCols, gridRows])

  // '현재 작업 중인 슬롯'(projectIdRef)에 upsert — 자동 저장, 전체 지우기 직전 저장,
  // 도안 만들기 진입 시 저장이 모두 이 헬퍼를 공유한다. fileNameOverride를 주지 않으면
  // 기존에 쓰던 이름(또는 기본 이름)을 그대로 유지한다.
  const persistCurrentSlot = useCallback((fileNameOverride) => {
    // 실제로 그린 적이 없는 빈 캔버스는 저장 자체를 건너뛴다 — 자동 저장, 전체 지우기 직전
    // 저장, 도안 만들기 진입 저장, 뒤로 가기 확정 저장이 모두 이 한 곳에서 함께 보호된다.
    if (!isDirty) return null
    const all = JSON.parse(localStorage.getItem(SKETCHBOOK_KEY) || '[]')
    const idx = all.findIndex(it => it.id === projectIdRef.current)
    const now = new Date().toISOString()
    const entry = {
      id: projectIdRef.current,
      fileName: fileNameOverride || currentFileNameRef.current || buildDefaultFileName(),
      updatedAt: now,
      ...buildSketchbookEntry(),
    }
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...entry }
    } else {
      // 드라이브에서 연 작품은 이 기기 스케치북에 처음 저장될 때 드라이브 파일 ID도 함께 남긴다
      const driveId = driveProjectRef.current === projectIdRef.current ? driveIdRef.current : null
      all.unshift({ createdAt: now, ...entry, ...(driveId ? { driveId } : {}) })
    }
    localStorage.setItem(SKETCHBOOK_KEY, JSON.stringify(all.slice(0, 50)))
    currentFileNameRef.current = entry.fileName
    return entry
  }, [isDirty, buildSketchbookEntry, buildDefaultFileName])
  const persistCurrentSlotRef = useRef(persistCurrentSlot)
  persistCurrentSlotRef.current = persistCurrentSlot

  // 현재 슬롯의 그림을 로그인한 사람의 구글 드라이브에 PNG로 올린다(같은 작품이면 같은 파일을 덮어씀)
  const syncToDrive = useCallback(() => {
    if (!driveSignedIn || !isDirty) return
    const projectId = projectIdRef.current
    const fileName = currentFileNameRef.current || buildDefaultFileName()
    const blobPromise = getCanvasBlob()
    setDriveSaveStatus('saving')
    driveQueueRef.current = driveQueueRef.current.then(async () => {
      const blob = await blobPromise
      if (!blob) return
      if (driveProjectRef.current !== projectId) {
        driveProjectRef.current = projectId
        driveIdRef.current = readSketchbook().find(it => it.id === projectId)?.driveId || null
      }
      const id = await saveArtworkToDrive({ driveId: driveIdRef.current, fileName, blob, cols: gridCols, rows: gridRows })
      if (driveProjectRef.current === projectId) driveIdRef.current = id
      rememberDriveId(projectId, id)
      setDriveSaveStatus('saved')
    }).catch(() => setDriveSaveStatus('error'))
  }, [driveSignedIn, isDirty, buildDefaultFileName, getCanvasBlob, gridCols, gridRows])
  const syncToDriveRef = useRef(syncToDrive); syncToDriveRef.current = syncToDrive

  // 예약된 드라이브 저장이 있으면 기다리지 않고 지금 바로 올린다 — 슬롯이 바뀌거나 화면을 떠나기 직전
  const flushDriveSync = useCallback(() => {
    if (!driveTimerRef.current) return
    clearTimeout(driveTimerRef.current)
    driveTimerRef.current = null
    syncToDriveRef.current()
  }, [])

  // 그림이 바뀔 때마다 3초 디바운스 후 드라이브에 저장. 그리다가 로그인했다면 지금까지 그린 그림도
  // 올라간다(lastDriveQueuedRef는 로그인 상태에서만 갱신되므로 로그인 직후엔 현재 그림과 다르다).
  useEffect(() => {
    if (!driveSignedIn || !isDirty) return
    if (pixels === lastDriveQueuedRef.current) return
    lastDriveQueuedRef.current = pixels
    clearTimeout(driveTimerRef.current)
    driveTimerRef.current = setTimeout(() => {
      driveTimerRef.current = null
      syncToDriveRef.current()
    }, DRIVE_SAVE_DELAY)
  }, [pixels, driveSignedIn, isDirty])

  // 로그인이 만료돼 저장에 실패했다가 다시 연결하면, 그림을 더 고치지 않아도 바로 다시 올린다
  useEffect(() => {
    if (driveSignedIn && driveSaveStatus === 'error') syncToDriveRef.current()
  }, [driveSignedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  // 브라우저 뒤로 가기처럼 편집기 내부 버튼을 거치지 않고 화면이 닫혀도 마지막 변경을
  // 동기적으로 로컬 스케치북에 남긴다. 드라이브의 예약 저장도 함께 즉시 시작한다.
  useEffect(() => () => {
    persistCurrentSlotRef.current()
    flushDriveSync()
  }, [flushDriveSync])

  const handleClearAll = () => {
    // 캔버스를 비우기 직전까지 그린 그림을 디바운스 없이 즉시 저장
    persistCurrentSlot()
    flushDriveSync()
    setSaveStatus('saved')
    // 지금까지의 작업은 안전하게 보존했으니, 이제부터의 자동 저장은 새 캔버스를 대상으로 하도록 새 프로젝트 ID 발급
    projectIdRef.current = Date.now()
    currentFileNameRef.current = null

    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), { pixels: pixels.map(r => [...r]), tracingImage }])
    setFuture([])
    const emptyGrid = makeEmpty(gridRows, gridCols)
    lastQueuedPixelsRef.current = emptyGrid
    setPixels(emptyGrid)
    setTracingImage(null) // 전체 지우기 시 밑그림도 함께 제거 — 위 history에 이미 남겨뒀으니 되돌리기로 복원 가능
    setShowClearModal(false)
  }

  // data: URI를 <a href>로 직접 다운로드하면 크롬(특히 크롬북)이 큰 data URI를
  // "위험할 수 있어 저장되지 않았습니다" 류의 경고로 막는 경우가 있어, 이미 있는
  // getCanvasBlob(Blob 기반)을 ObjectURL로 감싸서 다운로드한다.
  const handleConfirmSavePNG = useCallback(async () => {
    const name = saveFileName.trim() || buildDefaultFileName()
    const blob = await getCanvasBlob()
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.png`
      a.click()
      URL.revokeObjectURL(url)
    }

    // 스케치북 목록에 이름 기준으로 저장 — 같은 이름이면 덮어쓰기(Update), 다르면 새 항목(Save As = 새 슬롯)
    const all = JSON.parse(localStorage.getItem(SKETCHBOOK_KEY) || '[]')
    const existingIdx = all.findIndex(it => it.userName === userName && it.fileName === name)
    const now = new Date().toISOString()
    const entryId = existingIdx >= 0 ? all[existingIdx].id : Date.now()
    const entry = { id: entryId, fileName: name, updatedAt: now, ...buildSketchbookEntry() }
    if (existingIdx >= 0) {
      all[existingIdx] = { ...all[existingIdx], ...entry }
      showToast(`'${name}'에 덮어썼어요!`)
    } else {
      all.unshift({ createdAt: now, ...entry })
      showToast('PNG로 저장했어요!')
    }
    localStorage.setItem(SKETCHBOOK_KEY, JSON.stringify(all.slice(0, 50)))

    // 이후 자동 저장이 지금 저장한 이 항목을 계속 덮어쓰도록 세션의 저장 대상을 갱신
    flushDriveSync()
    projectIdRef.current = entryId
    currentFileNameRef.current = name
    setSaveStatus('saved')
    syncToDrive()

    setIsSaveModalOpen(false)
  }, [saveFileName, buildDefaultFileName, buildSketchbookEntry, getCanvasBlob, userName, flushDriveSync, syncToDrive])

  // 실시간 자동 저장: 그림이 바뀔 때마다 500ms 디바운스 후 localStorage 스케치북을
  // 현재 프로젝트 ID로 덮어쓴다. pixels 참조가 마지막 예약 시점과 같으면(최초 마운트,
  // StrictMode 이중 실행 등) 실제 편집이 아니므로 건너뛴다.
  useEffect(() => {
    if (pixels === lastQueuedPixelsRef.current) return
    lastQueuedPixelsRef.current = pixels
    setSaveStatus('pending')
    const timer = setTimeout(() => {
      persistCurrentSlot()
      setSaveStatus('saved')
    }, 500)
    return () => clearTimeout(timer)
  }, [pixels, persistCurrentSlot])

  // 실시간 자동 저장이 이미 현재 작업을 최신 상태로 반영하고 있으므로
  // 목록을 여는 것 외에 별도로 저장을 유발하지 않는다.
  const handleOpenSketchbook = () => {
    setShowSketchbook(true)
  }

  const handleOpenDoan = () => {
    // 도안 만들기 진입 시 작품 저장 — 자동 저장과 같은 슬롯을 즉시 갱신
    persistCurrentSlot()
    setDoanMode(true)
  }

  // Keyboard shortcuts via stable refs
  const undoRef = useRef(null); undoRef.current = handleUndo
  const redoRef = useRef(null); redoRef.current = handleRedo
  const savePNGRef = useRef(null); savePNGRef.current = openSaveModal

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current() }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redoRef.current() }
      if (e.key === 's') { e.preventDefault(); savePNGRef.current() }
      if (e.key === '=') { e.preventDefault(); setZoom(z => Math.min(2, +(z + 0.25).toFixed(2))) }
      if (e.key === '-') { e.preventDefault(); setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2))) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 이미지 저장 모달: ESC로 닫기 + 열릴 때 입력창 자동 포커스
  useEffect(() => {
    if (!isSaveModalOpen) return
    saveFileInputRef.current?.focus()
    saveFileInputRef.current?.select()
    const onKey = (e) => {
      if (e.key === 'Escape') setIsSaveModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSaveModalOpen])

  const canUndo = history.length > 0
  const canRedo = future.length > 0

  return (
    <div className="flex flex-col h-svh w-screen overflow-hidden" style={{ background: PAGE_BG }}>

      {/* ── Header ─────────────────────────────────── */}
      <header
        className="flex-shrink-0 z-10 h-16 overflow-x-auto header-scrollbar"
        style={{ background: PAGE_BG, borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between gap-3 px-6 h-full min-w-max">

          {/* Brand + 처음 화면으로 */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-pixel font-bold text-2xl tracking-tight whitespace-nowrap inline-block leading-none" style={{ color: ACCENT_YELLOW, transform: 'translateY(0.3em)' }}>PIXEL ART</span>
            <HeaderBtn onClick={() => setShowBackModal(true)} title="처음 화면으로" size="lg">
              <img src="/images/home.png" alt="처음 화면으로" className="w-6 h-6 invert" />
            </HeaderBtn>
          </div>

          {/* 자동 저장 상태 */}
          <div className="flex items-center justify-center shrink-0 px-2">
            <span
              className="text-sm font-medium whitespace-nowrap transition-all duration-300"
              style={{
                color: saveStatus === 'pending' ? '#fde68a' : '#86efac',
                opacity: saveStatus === 'idle' ? 0 : 1,
              }}
            >
              {saveStatus === 'pending' ? '● 저장 중...' : '✓ 스케치북에 자동 저장됨'}
            </span>
            {(driveSignedIn || drive.status === 'expired') && driveSaveStatus !== 'idle' && (
              <span
                className="ml-3 text-sm font-medium whitespace-nowrap"
                style={{ color: driveSaveStatus === 'error' ? DANGER : driveSaveStatus === 'saving' ? '#fde68a' : '#86efac' }}
              >
                {driveSaveStatus === 'saving' ? '● 드라이브에 올리는 중...'
                  : driveSaveStatus === 'error' ? '! 드라이브 저장 안 됨' : '✓ 드라이브에도 저장됨'}
              </span>
            )}
          </div>

          {/* Edit controls */}
          <div className="flex items-center gap-2 shrink-0">
            <HeaderBtn onClick={handleUndo} disabled={!canUndo} title="되돌리기">
              <img src="/images/undo.png" alt="되돌리기" className="w-5 h-5 invert scale-x-[-1]" />
            </HeaderBtn>
            <HeaderBtn onClick={handleRedo} disabled={!canRedo} title="다시하기">
              <img src="/images/undo.png" alt="다시하기" className="w-5 h-5 invert" />
            </HeaderBtn>
            <div className="w-px h-5 mx-1 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <HeaderBtn onClick={() => setShowClearModal(true)} variant="danger" title="전체 지우기">
              <img src="/images/trash.png" alt="전체 지우기" className="w-5 h-5 invert" />
            </HeaderBtn>
          </div>

          {/* Save actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowHelpModal(true)}
              className="font-pixel font-bold flex items-center justify-center gap-2 h-10 px-4 rounded-full text-sm transition-colors hover:brightness-125"
              style={{ background: PANEL_BG, color: ACCENT_YELLOW, border: `1px solid ${ACCENT_YELLOW}` }}
            >
              <span
                aria-hidden="true"
                className="w-4 h-4"
                style={{
                  background: ACCENT_YELLOW,
                  WebkitMaskImage: 'url(/images/question.png)',
                  maskImage: 'url(/images/question.png)',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
              사용법 안내
            </button>
            <div className="w-px h-5 mx-1 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <DriveButton onError={showToast} />
            <HeaderBtn onClick={handleOpenSketchbook} title="나의 스케치북">
              <img src="/images/photo.png" alt="나의 스케치북" className="w-5 h-5 invert" />
            </HeaderBtn>
            <HeaderBtn onClick={handleOpenDoan} title="도안 만들기">
              <img src="/images/doan.png" alt="도안 만들기" className="w-5 h-5 invert" />
            </HeaderBtn>
            <HeaderBtn onClick={handleCopyImage} title="그림 복사하기">
              <img src={copyIcon} alt="그림 복사하기" className="w-5 h-5 invert" />
            </HeaderBtn>
            <HeaderBtn onClick={openSaveModal} title="PNG 저장">
              <img src="/images/downloads.png" alt="PNG 저장" className="w-5 h-5 invert" />
            </HeaderBtn>
            <div className="w-px h-5 mx-1 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <HeaderBtn onClick={handleToggleFullscreen} title={isFullscreen ? '전체화면 종료' : '전체화면'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                {isFullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M20.25 20.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                )}
              </svg>
            </HeaderBtn>
          </div>

        </div>
      </header>

      {/* ── Body ───────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {doanMode ? (
          <DoanView pixels={pixels} gridCols={gridCols} gridRows={gridRows} onClose={() => setDoanMode(false)} />
        ) : (<>

        {/* 모바일 폭(md 미만)에서 사이드바가 하단 시트로 열려 있을 때 배경을 덮어 캔버스 조작을
            막고, 탭하면 닫히게 한다 — 데스크톱에서는 사이드바가 항상 열려 있어 필요 없다. */}
        {mobileToolsOpen && (
          <div
            className="md:hidden fixed inset-0 z-30"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setMobileToolsOpen(false)}
          />
        )}

        {/* ── Left Sidebar ───────────────────────── */}
        {/* 모바일: 화면 하단에서 올라오는 시트로 접혀 있다가 토글 버튼으로 열림(캔버스 공간을
            침범하지 않도록 기본 상태에서는 화면 밖으로 완전히 내려가 있음, fixed라 레이아웃도
            차지하지 않는다). md 이상: 기존처럼 항상 펼쳐진 좌측 고정 폭 사이드바.
            scrollbarGutter: 'stable' — 최근 색상 등 콘텐츠 높이가 늘어 스크롤바가 나타나도
            내부 폭이 줄어들며 도구 모음이 덜컥이지 않도록 스크롤바 공간을 항상 예약해둔다. */}
        <aside
          className={`flex flex-col overflow-y-auto transition-transform duration-300 z-40
            fixed inset-x-0 bottom-0 max-h-[75vh] rounded-t-2xl
            md:static md:inset-auto md:z-auto md:max-h-none md:rounded-none md:w-60 md:flex-shrink-0 md:translate-y-0
            ${mobileToolsOpen ? 'translate-y-0' : 'translate-y-full'}`}
          style={{ background: PAGE_BG, borderRight: '1px solid rgba(255,255,255,0.08)', scrollbarGutter: 'stable' }}
        >
          <div className="flex flex-col gap-4 p-4 flex-1">

            {/* Tools */}
            <div className="rounded-2xl p-3" style={{ background: PANEL_BG }}>
              <SectionLabel>도구</SectionLabel>
              <div className="grid grid-cols-4 gap-1.5">
                {TOOLS.map(t => {
                  const active = tool === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => t.id === 'eyedropper' ? handleEyedrop(tool) : selectTool(t.id)}
                      title={t.title}
                      className="flex items-center justify-center py-2.5 rounded-full text-lg transition-colors duration-200"
                      style={{
                        background: active ? ACCENT_YELLOW : 'transparent',
                      }}
                    >
                      <ToolIcon tool={t} active={active} className="w-6 h-6" />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Color palette */}
            <div className="rounded-2xl p-3" style={{ background: PANEL_BG }}>
              <SectionLabel>색상</SectionLabel>

              {/* Active color preview */}
              <div
                className="w-full h-9 rounded-xl mb-3 border"
                style={{ background: selectedColor, borderColor: 'rgba(255,255,255,0.15)' }}
              />

              {/* Palette grid */}
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    aria-label={`${color} 색상 선택`}
                    className="aspect-square rounded-lg border transition-transform hover:scale-110 active:scale-95"
                    style={{
                      background: color,
                      borderColor: 'rgba(255,255,255,0.15)',
                      outline: selectedColor === color ? `3px solid ${ACCENT_YELLOW}` : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
              </div>

              {/* Recent colors */}
              {recentColors.length > 0 && (
                <div className="mb-3">
                  <p className="font-code text-xs text-gray-500 font-semibold mb-2">최근 사용</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {recentColors.map((color, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedColor(color)}
                        aria-label={`${color} 최근 색상 선택`}
                        className="w-7 h-7 rounded-lg border transition-transform hover:scale-110 active:scale-95"
                        style={{
                          background: color,
                          borderColor: 'rgba(255,255,255,0.15)',
                          outline: selectedColor === color ? `3px solid ${ACCENT_YELLOW}` : 'none',
                          outlineOffset: '2px',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Custom color picker */}
              <div className="relative">
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors duration-200"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  <div
                    className="w-3.5 h-3.5 rounded border border-dashed flex-shrink-0"
                    style={{ background: selectedColor, borderColor: 'rgba(255,255,255,0.3)' }}
                  />
                  <span className="font-code text-sm text-gray-400 font-medium">직접 선택…</span>
                </div>
                <input
                  type="color"
                  value={selectedColor === '#FFFFFF' ? '#FFFFFF' : selectedColor}
                  onChange={e => setSelectedColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
              </div>
            </div>

            {/* 원본 그림 — 캔버스에는 옅게 깔리는 밑그림의 "원본"을 있는 그대로 작게 보여줘서,
                정확한 색상·형태를 직관적으로 참고하며 색칠할 수 있게 한다. 전체 지우기·되돌리기로
                밑그림이 사라지면(tracingImage → null) 이 박스도 자동으로 안내 문구로 돌아간다. */}
            <div className="rounded-2xl p-3" style={{ background: PANEL_BG }}>
              {/* 밑그림 크기 조절 슬라이더 — 아이들이 눈으로 보면서 캔버스 위 밑그림 크기를
                  직접 맞출 수 있게 한다. 기본 100%, 밑그림이 없으면 조작 자체를 막아둔다.
                  옆의 눈동자 버튼으로 잠시 숨기면(불투명도만 0) 슬라이더도 함께 비활성화되지만,
                  크기값 자체는 그대로 남아 있다가 다시 보이기를 누르면 그 크기로 복귀한다. */}
              <div className="flex items-center justify-between mb-3">
                <span className="font-code text-[14px] font-bold text-gray-400">밑그림 크기</span>
                <span className="font-code text-xs font-bold" style={{ color: ACCENT_YELLOW }}>
                  {Math.round(tracingScale * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={50}
                  max={300}
                  step={5}
                  value={Math.round(tracingScale * 100)}
                  onChange={e => setTracingScale(Number(e.target.value) / 100)}
                  disabled={!tracingImage || !tracingVisible}
                  className="flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                  style={{ accentColor: ACCENT_YELLOW }}
                />
                <button
                  onClick={() => setTracingVisible(v => !v)}
                  disabled={!tracingImage}
                  aria-label={tracingVisible ? '밑그림 숨기기' : '밑그림 보이기'}
                  title={tracingVisible ? '밑그림 숨기기' : '밑그림 보이기'}
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: PAGE_BG, border: `1px solid ${tracingVisible ? 'rgba(255,255,255,0.15)' : ACCENT_YELLOW}` }}
                >
                  <img
                    src={tracingVisible ? '/images/eye.png' : '/images/hide.png'}
                    alt={tracingVisible ? '밑그림 숨기기' : '밑그림 보이기'}
                    className="w-5 h-5 invert"
                  />
                </button>
              </div>
              {/* 밑그림이 없을 때는 이 박스 자체가 업로드 드롭존 겸 클릭 버튼 역할을 한다 —
                  헤더의 전용 업로드 버튼을 없앤 대신, 밑그림을 다루는 이 영역 하나로 통합. */}
              <div
                className="relative w-full h-32 rounded-xl overflow-hidden flex items-center justify-center mt-3 transition-colors"
                style={{
                  background: tracingImage ? '#ffffff' : PAGE_BG,
                  border: tracingImage ? 'none' : `1px dashed ${isDraggingTracing ? ACCENT_YELLOW : 'rgba(255,255,255,0.15)'}`,
                  cursor: tracingImage ? 'default' : 'pointer',
                }}
                onClick={() => { if (!tracingImage) sidebarTracingInputRef.current?.click() }}
                onDragOver={e => { e.preventDefault(); if (!tracingImage) setIsDraggingTracing(true) }}
                onDragLeave={() => setIsDraggingTracing(false)}
                onDrop={handleTracingDrop}
              >
                {tracingImage ? (
                  <>
                    {/* 스포이드 도구가 선택돼 있으면 이 원본 미리보기에서도 직접 색을 뽑을 수
                        있다 — 캔버스 위 밑그림은 25% 투명도라 진짜 색을 가늠하기 어려우니,
                        원본 그대로 보이는 이 썸네일이 오히려 색 참고에 더 정확하다. */}
                    <img
                      src={tracingImage}
                      alt="원본 그림"
                      className="w-full h-full object-contain"
                      style={{ cursor: tool === 'eyedropper' ? 'none' : 'default' }}
                      onPointerMove={handleThumbnailEyedropMove}
                      onPointerLeave={handleThumbnailEyedropLeave}
                      onClick={handleThumbnailEyedropClick}
                    />
                    {/* 켜져 있으면 캔버스 위 드래그가 펜/지우개 대신 밑그림 위치 이동으로 처리된다
                        (PixelCanvas의 투명 오버레이가 이 모드일 때만 포인터 이벤트를 가로챈다). */}
                    <button
                      onClick={e => { e.stopPropagation(); setTracingMoveMode(v => !v) }}
                      aria-label={tracingMoveMode ? '밑그림 이동 모드 끄기' : '밑그림 위치 이동'}
                      title={tracingMoveMode ? '밑그림 이동 모드 끄기' : '밑그림 위치 이동'}
                      className="absolute flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-colors"
                      style={{
                        bottom: 8,
                        right: 8,
                        background: tracingMoveMode ? ACCENT_YELLOW : 'rgba(17,18,20,0.85)',
                        border: `1px solid ${tracingMoveMode ? ACCENT_YELLOW : 'rgba(255,255,255,0.2)'}`,
                      }}
                    >
                      <img
                        src="/images/move.png"
                        alt="밑그림 이동"
                        className={`w-3.5 h-3.5 ${tracingMoveMode ? '' : 'invert'}`}
                      />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 px-2 pointer-events-none">
                    <svg
                      viewBox="0 0 24 24" fill="none" strokeWidth={2} className="w-6 h-6"
                      stroke={isDraggingTracing ? ACCENT_YELLOW : '#6b7280'}
                    >
                      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                    </svg>
                    <p className="font-code text-sm text-gray-500 text-center leading-relaxed">
                      밑그림 불러오기<br />(클릭 또는 이미지 드래그)
                    </p>
                  </div>
                )}
              </div>
              <input
                ref={sidebarTracingInputRef}
                type="file"
                accept="image/*, image/webp"
                className="hidden"
                onChange={handleTracingUpload}
              />
            </div>

            {/* Zoom */}
            <div className="rounded-2xl p-3" style={{ background: PANEL_BG }}>
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>확대 / 축소</SectionLabel>
                <span className="font-code text-xs font-bold mb-3" style={{ color: ACCENT_YELLOW }}>
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.25}
                max={2}
                step={0.25}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="w-full cursor-pointer"
                style={{ accentColor: ACCENT_YELLOW }}
              />
              <div className="flex justify-between items-center mt-2">
                <span className="font-code text-xs text-gray-500">25%</span>
                <button
                  onClick={() => setZoom(1)}
                  className="font-code text-xs font-semibold hover:underline transition-colors"
                  style={{ color: '#9ca3af' }}
                >
                  초기화
                </button>
                <span className="font-code text-xs text-gray-500">200%</span>
              </div>
            </div>

          </div>
        </aside>

        {/* ── Canvas area ────────────────────────── */}
        {/* 모바일 패딩을 대폭 줄여(p-3) 캔버스가 화면 대부분을 차지하도록 하고, md 이상에서는
            기존 여백(p-8)을 유지한다. PixelCanvas는 이 컨테이너의 clientWidth/Height를 그대로
            기준 삼아 칸 크기를 계산하므로, 이 패딩을 줄이는 것만으로 캔버스가 실제로 커진다. */}
        <div className="flex flex-1 relative items-center justify-center p-3 md:p-8 overflow-auto">
          <PixelCanvas
            pixels={pixels}
            gridCols={gridCols}
            gridRows={gridRows}
            selectedColor={selectedColor}
            tool={tool}
            brushSize={1}
            zoom={zoom}
            onCommit={handleCommit}
            onColorPick={handleColorPick}
            onColorHover={handleColorHover}
            onPaintComplete={addRecentColor}
            tracingImage={tracingImage}
            tracingOpacity={tracingVisible ? tracingOpacity : 0}
            tracingScale={tracingScale}
            tracingOffset={tracingOffset}
            tracingMoveMode={tracingMoveMode}
            onTracingOffsetChange={setTracingOffset}
          />

          {/* 모바일 전용 도구 패널 토글 — 사이드바가 하단 시트로 접혀 있을 때 이걸로 열고 닫는다 */}
          <button
            onClick={() => setMobileToolsOpen(v => !v)}
            aria-label={mobileToolsOpen ? '도구 패널 닫기' : '도구 패널 열기'}
            title={mobileToolsOpen ? '도구 패널 닫기' : '도구 패널 열기'}
            className="md:hidden fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: ACCENT_YELLOW }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth={2} strokeLinecap="round" className="w-6 h-6">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="1.6" fill="#000000" stroke="none" />
              <circle cx="15" cy="12" r="1.6" fill="#000000" stroke="none" />
              <circle cx="9" cy="18" r="1.6" fill="#000000" stroke="none" />
            </svg>
          </button>
        </div>
        </>)}
      </div>

      {/* 밑그림 원본 미리보기 썸네일용 스포이드 돋보기 — PixelCanvas의 돋보기와 동일한 디자인.
          position:fixed + JS로 직접 표시 위치를 옮기므로 커서 이동마다 리렌더되지 않는다. */}
      <div
        ref={thumbLoupeWrapRef}
        style={{
          display: 'none',
          position: 'fixed',
          transform: 'translate(-50%, -100%)',
          width: 108,
          height: 108,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '3px solid rgba(255,255,255,0.9)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
          zIndex: 9999,
        }}
      >
        <canvas ref={thumbLoupeCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="font-pixel fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs z-50 whitespace-nowrap"
          style={{ background: PANEL_BG, color: ACCENT_YELLOW }}
        >
          {toast}
        </div>
      )}

      {showSketchbook && (
        <SketchbookModal
          userName={userName}
          onClose={() => setShowSketchbook(false)}
          onEdit={(artwork) => {
            setShowSketchbook(false)
            onEditArtwork(artwork)
          }}
        />
      )}

      {showHelpModal && (
        <HelpModal onClose={() => setShowHelpModal(false)} />
      )}

      {/* 전체 지우기 확인 모달 */}
      {showClearModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowClearModal(false)}
        >
          <div
            className="rounded-2xl px-8 py-8 flex flex-col items-center gap-6 mx-4"
            style={{ maxWidth: 360, width: '100%', background: PANEL_BG }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-16 h-16 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: DANGER }}
            >
              <img src="/images/trash.png" alt="전체 지우기" className="w-8 h-8 invert" />
            </div>

            <div className="text-center flex flex-col gap-2">
              <p className="font-pixel text-base text-white">캔버스를 전체 지울까요?</p>
              <p className="text-sm text-gray-400 leading-relaxed">
                지금까지 그린 그림이 모두 사라져요.<br />
                이 작업은 되돌릴 수 있어요.
              </p>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => setShowClearModal(false)}
                className="flex-1 py-3 rounded-full text-sm font-semibold transition-colors active:scale-[0.97]"
                style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}
              >
                취소
              </button>
              <button
                onClick={handleClearAll}
                className="flex-1 py-3 rounded-full text-sm font-semibold transition-colors active:scale-[0.97]"
                style={{ background: DANGER, color: '#000000' }}
              >
                전체 지우기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이전 단계 확인 모달 */}
      {showBackModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="editor-back-modal flex flex-col items-center"
            style={{ background: PANEL_BG }}
          >
            {/* 메시지 */}
            <div className="editor-back-modal-message text-center flex flex-col">
              <div className="editor-back-modal-icon" aria-hidden="true" />
              <p className="editor-back-modal-title font-pixel font-bold text-white">크기 선택 화면으로 돌아갈까요?</p>
              <p className="editor-back-modal-copy font-code text-gray-400 leading-relaxed">
                캔버스 크기 선택 화면으로 돌아갑니다.<br />
                <span className="font-bold" style={{ color: ACCENT_YELLOW }}>지금 그렸던 그림이 저장되지 않을 수 있어요!</span>
              </p>
            </div>

            {/* 버튼 */}
            <div className="editor-back-modal-actions flex w-full">
              <button
                onClick={() => setShowBackModal(false)}
                className="editor-back-modal-button font-pixel font-bold flex-1 rounded-full transition-colors active:scale-[0.97]"
                style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0' }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  // 디바운스된 자동 저장(500ms)이 아직 실행되기 전에 화면을 떠나면 그 타이머가
                  // 언마운트로 취소되어 마지막 몇 초의 그림이 스케치북에 반영되지 않는다.
                  // 나가기 직전 즉시(동기) 한 번 더 저장해 이 경쟁 상태를 없앤다.
                  persistCurrentSlot()
                  setShowBackModal(false)
                  onGoToSetup()
                }}
                className="editor-back-modal-button font-pixel font-bold flex-1 rounded-full transition-colors active:scale-[0.97]"
                style={{ background: ACCENT_YELLOW, color: '#000000' }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 저장 파일명 입력 모달 */}
      {isSaveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setIsSaveModalOpen(false)}
        >
          <div
            className="bg-[#1e1e1e] rounded-2xl px-8 py-8 flex flex-col gap-5 mx-4"
            style={{ maxWidth: 380, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              <p className="font-pixel text-base text-white">이미지로 저장</p>
              <p className="text-sm text-gray-400 leading-relaxed">
                저장할 파일 이름을 입력해주세요.
              </p>
            </div>

            <input
              ref={saveFileInputRef}
              type="text"
              value={saveFileName}
              onChange={e => setSaveFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmSavePNG() }}
              placeholder={buildDefaultFileName()}
              className="w-full px-4 py-3 rounded-xl text-sm text-white bg-[#111214] border border-white/10 outline-none transition-colors focus:border-[#f7d070]"
            />

            <div className="flex gap-3 w-full justify-end">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-400 transition-colors hover:text-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleConfirmSavePNG}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-black transition-colors hover:brightness-105 active:scale-[0.97] bg-[#fdd835]"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
