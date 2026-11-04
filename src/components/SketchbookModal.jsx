import { useEffect, useRef, useState } from 'react'
import { useDrive, signIn, listDriveArtworks, downloadDriveArtwork, trashDriveArtwork } from '../utils/googleDrive'
import { loadImageFile, decodeArtwork, detectArtwork } from '../utils/importArtwork'

const STORAGE_KEY = 'pixel_art_sketchbook'

// localStorage에서 내 이름과 일치하는 항목만 필터링해서 읽어온다 — 모달을 열 때마다
// 이 함수로 매번 새로 읽어야, 그림을 그리다 방금 나가기 직전 저장한 최신 상태가
// (캐시된 옛 State가 아니라) 확실히 반영된다.
function loadSketchbookItems(userName) {
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  return all.filter(item => item.userName === userName)
}

const formatDate = (iso) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

function downloadUrl(url, fileName) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
}

// 작품 카드 하나 — 이 기기 스케치북과 드라이브 탭이 함께 쓴다
function ArtworkCard({ thumb, title, subtitle, busy, onEdit, onDownload, onDelete }) {
  return (
    <div
      className="rounded-xl overflow-hidden border border-gray-100 hover:border-[#fdd835] transition-all group bg-gray-50 cursor-pointer"
      onClick={onEdit}
    >
      <div className="aspect-square flex items-center justify-center p-2 relative bg-white">
        {thumb ? (
          <img src={thumb} alt="saved" className="max-w-full max-h-full" style={{ imageRendering: 'pixelated' }} />
        ) : (
          <div className="w-full h-full rounded-lg bg-gray-100 animate-pulse" />
        )}
        {busy && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs font-bold text-gray-500">여는 중...</div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gray-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="w-8 h-8 bg-white rounded-xl flex items-center justify-center hover:bg-[#fdd835] transition-colors"
            title="편집하기"
          >
            <img src="/images/draw.png" alt="편집하기" className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload() }}
            className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-gray-700 hover:bg-gray-100 text-sm transition-colors"
            title="다운로드"
          >↓</button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 text-sm transition-colors"
            title="삭제"
          >✕</button>
        </div>
      </div>
      <div className="px-2.5 py-2 bg-gray-50">
        <p className="text-[10px] text-gray-600 font-bold truncate">{title}</p>
        <p className="text-[10px] text-gray-400">{subtitle}</p>
      </div>
    </div>
  )
}

// 빈 상태 문구 — 헤더 아래 콘텐츠 영역만 기준으로 중앙 정렬하면 헤더 높이만큼 아래로
// 치우쳐 보여서, 모달 전체(inset-0)를 기준으로 절대 위치시켜 창 정중앙에 오도록 한다.
// pointer-events-none이라 뒤에 있는 헤더의 닫기 버튼 클릭은 그대로 통과된다(버튼만 클릭 가능).
function EmptyState({ title, desc, children }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-gray-300 px-8 text-center">
      <p className="font-pixel-kr text-lg sm:text-xl font-bold text-gray-400">{title}</p>
      {desc && <p className="font-pixel-kr text-xs text-gray-400 mt-1 break-keep">{desc}</p>}
      {children && <div className="pointer-events-auto mt-4">{children}</div>}
    </div>
  )
}

function DriveTab({ onEdit, onCountChange }) {
  const drive = useDrive()
  const [items, setItems] = useState(null) // null = 불러오는 중
  const [error, setError] = useState(null)
  const [blobs, setBlobs] = useState({}) // driveId → { blob, url }
  const blobsRef = useRef(blobs); blobsRef.current = blobs
  const [openingId, setOpeningId] = useState(null)
  const signedIn = drive.status === 'signedIn'

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    setItems(null)
    setError(null)
    listDriveArtworks()
      .then(list => { if (!cancelled) setItems(list) })
      .catch(() => { if (!cancelled) setError('드라이브에서 그림 목록을 불러오지 못했어요.') })
    return () => { cancelled = true }
  }, [signedIn])

  useEffect(() => { onCountChange(items?.length ?? 0) }, [items, onCountChange])

  // 썸네일: 드라이브의 PNG를 몇 개씩 나눠 받아 화면에 바로 쓴다(같은 파일을 이어 그리기에도 재사용)
  useEffect(() => {
    if (!items?.length) return
    let cancelled = false
    const queue = items.map(it => it.driveId)
    const worker = async () => {
      while (!cancelled && queue.length) {
        const id = queue.shift()
        try {
          const blob = await downloadDriveArtwork(id)
          if (cancelled) return
          setBlobs(prev => ({ ...prev, [id]: { blob, url: URL.createObjectURL(blob) } }))
        } catch { /* 썸네일 하나쯤 실패해도 목록은 계속 */ }
      }
    }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => { cancelled = true }
  }, [items])

  useEffect(() => () => {
    Object.values(blobsRef.current).forEach(b => URL.revokeObjectURL(b.url))
  }, [])

  const getBlob = async (item) => blobs[item.driveId]?.blob || downloadDriveArtwork(item.driveId)

  const handleEdit = async (item) => {
    if (openingId) return
    setOpeningId(item.driveId)
    try {
      const image = await loadImageFile(await getBlob(item))
      const art = item.cols && item.rows
        ? decodeArtwork(image, item.cols, item.rows)
        : (detectArtwork(image).artwork || null)
      if (!art) throw new Error('decode')
      // 이 기기 스케치북에 같은 드라이브 파일이 있으면 그 슬롯을 이어서 쓴다(목록에 같은 그림이 두 번 쌓이지 않게)
      const local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').find(it => it.driveId === item.driveId)
      onEdit({ ...art, id: local?.id ?? Date.now(), fileName: item.fileName, driveId: item.driveId, imported: true })
    } catch {
      setError('그림을 여는 데 실패했어요. 다시 눌러 주세요.')
      setOpeningId(null)
    }
  }

  const handleDownload = async (item) => {
    const url = blobs[item.driveId]?.url || URL.createObjectURL(await getBlob(item))
    downloadUrl(url, `${item.fileName}.png`)
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`'${item.fileName}'을(를) 드라이브 휴지통으로 옮길까요?`)) return
    try {
      await trashDriveArtwork(item.driveId)
      setItems(prev => prev.filter(it => it.driveId !== item.driveId))
    } catch {
      setError('삭제하지 못했어요. 다시 시도해 주세요.')
    }
  }

  if (!signedIn) {
    const expired = drive.status === 'expired'
    return (
      <EmptyState
        title={expired ? '드라이브 연결이 끊어졌어요' : '구글 드라이브에 연결해 보세요'}
        desc="연결하면 다른 기기에서 그린 그림도 여기서 이어 그릴 수 있어요. 학생은 학교에서 허락한 경우에만 로그인해요."
      >
        <button
          onClick={() => signIn().catch(() => {})}
          disabled={drive.status === 'connecting'}
          className="font-pixel rounded-full px-6 py-3 text-sm text-black bg-[#f7d070] hover:brightness-105 disabled:opacity-50"
        >
          {drive.status === 'connecting' ? '연결 중...' : expired ? '다시 연결' : '구글로 로그인'}
        </button>
      </EmptyState>
    )
  }
  if (error && !items?.length) return <EmptyState title={error} />
  if (items === null) return <EmptyState title="드라이브에서 불러오는 중..." />
  if (items.length === 0) {
    return <EmptyState title="드라이브에 저장된 그림이 없어요" desc="로그인한 채로 그림을 그리면 자동으로 저장돼요!" />
  }
  return (
    <>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {items.map(item => (
          <ArtworkCard
            key={item.driveId}
            thumb={blobs[item.driveId]?.url}
            title={item.fileName}
            subtitle={`${formatDate(item.updatedAt)}${item.cols ? ` · ${item.cols}×${item.rows}칸` : ''}`}
            busy={openingId === item.driveId}
            onEdit={() => handleEdit(item)}
            onDownload={() => handleDownload(item)}
            onDelete={() => handleDelete(item)}
          />
        ))}
      </div>
    </>
  )
}

export default function SketchbookModal({ userName, onClose, onEdit }) {
  const drive = useDrive()
  const driveEnabled = drive.status !== 'disabled'
  // 로그인한 상태라면 드라이브 탭부터 — 새 기기에서는 이 기기 스케치북이 비어 있기 마련이라
  const [tab, setTab] = useState(drive.status === 'signedIn' ? 'drive' : 'local')
  const [driveCount, setDriveCount] = useState(0)
  // 초기 렌더부터 곧바로 최신 데이터로 채워, "0개의 작품"이 잠깐이라도 보이는 깜빡임 없이 시작한다.
  const [items, setItems] = useState(() => loadSketchbookItems(userName))

  // 모달은 열릴 때마다 완전히 새로 mount되지만(showSketchbook 조건부 렌더링), 혹시라도
  // userName이 바뀌거나 다시 열리는 타이밍에 대비해 한 번 더 확실하게 최신 상태로 동기화한다.
  useEffect(() => {
    setItems(loadSketchbookItems(userName))
  }, [userName])

  const handleDelete = (id) => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter(i => i.id !== id)))
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const handleEdit = (item) => {
    onEdit({
      id: item.id,
      pixels: item.pixels,
      cols: item.cols,
      rows: item.rows,
      fileName: item.fileName || `픽셀아트_${userName}_${item.id}`,
      driveId: item.driveId,
    })
  }

  const count = tab === 'drive' ? driveCount : items.length

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl min-h-[400px] max-h-[80vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-gray-900">내 스케치북</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {count}개의 작품 · 클릭해서 이어 그리기
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {driveEnabled && (
          <div className="flex gap-2 px-6 pt-4 flex-shrink-0">
            {[{ id: 'local', label: '이 기기' }, { id: 'drive', label: '내 구글 드라이브' }].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="rounded-full px-4 py-1.5 text-xs font-bold transition-colors"
                style={tab === t.id
                  ? { background: '#111214', color: '#f7d070' }
                  : { background: '#f3f4f6', color: '#6b7280' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'local' && items.length === 0 && (
          <EmptyState title="아직 저장된 그림이 없어요" desc="그림을 그리면 자동으로 저장돼요!" />
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {tab === 'drive' ? (
            <DriveTab onEdit={onEdit} onCountChange={setDriveCount} />
          ) : items.length === 0 ? null : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map(item => (
                <ArtworkCard
                  key={item.id}
                  thumb={item.dataUrl}
                  title={item.fileName || `${item.cols}×${item.rows}칸`}
                  subtitle={`${formatDate(item.updatedAt || item.createdAt)} · ${item.cols}×${item.rows}칸`}
                  onEdit={() => handleEdit(item)}
                  onDownload={() => downloadUrl(item.dataUrl, `픽셀아트_${userName}_${item.id}.png`)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
