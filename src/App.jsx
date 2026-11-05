import { useState, useEffect, useRef } from 'react'
import EntryPage from './pages/EntryPage'
import SetupPage from './pages/SetupPage'
import EditorPage, { SKETCHBOOK_KEY } from './pages/EditorPage'
import { signOut } from './utils/googleDrive'

const HISTORY_PAGE_KEY = 'pixelArtPage'
const APP_PAGES = new Set(['entry', 'setup', 'editor'])

export default function App() {
  const [page, setPage] = useState('entry')
  const [userName, setUserName] = useState('')
  const [canvasConfig, setCanvasConfig] = useState({ cols: 16, rows: 16 })
  const [resumeArtwork, setResumeArtwork] = useState(null)
  const [editorProjectId, setEditorProjectId] = useState(null)
  // 아직 수정하지 않은 파일 불러오기 작품은 localStorage에 없을 수 있으므로, 현재 탭의
  // 뒤로/앞으로 이동 동안에는 최초 작품 데이터도 프로젝트 ID별로 보관한다.
  const editorInitialArtworkRef = useRef(new Map())
  // 새로 시작하거나 스케치북에서 다른 작품을 불러올 때마다 값을 바꿔 EditorPage를 완전히 새로 마운트시킨다
  const [editorKey, setEditorKey] = useState(0)

  // viewport meta의 maximum-scale=1 / user-scalable=no만으로는 핀치 줌을 못 막는 브라우저가
  // 있다(특히 iOS Safari는 접근성을 이유로 이 설정을 무시하고 확대를 계속 허용함) — 확대된
  // 채로 화면이 밀리면 되돌릴 방법이 없어 아이들이 갇히므로, 제스처 자체를 코드로도 막는다.
  useEffect(() => {
    const preventGesture = (e) => e.preventDefault() // Safari 전용 pinch 제스처 이벤트
    const preventPinchTouch = (e) => { if (e.touches.length > 1) e.preventDefault() } // 그 외 브라우저의 2손가락 터치
    document.addEventListener('gesturestart', preventGesture)
    document.addEventListener('gesturechange', preventGesture)
    document.addEventListener('touchmove', preventPinchTouch, { passive: false })
    return () => {
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
      document.removeEventListener('touchmove', preventPinchTouch)
    }
  }, [])

  // 각 앱 화면을 브라우저 기록에 남겨 휴대폰·브라우저 뒤로 가기가 앱 안에서 먼저
  // 동작하게 한다. 새로고침했을 때 편집 상태가 일부만 복원되는 것을 막기 위해 현재
  // 문서의 첫 기록은 항상 시작 화면으로 초기화한다.
  useEffect(() => {
    // 새로고침은 진행 중 화면을 복원하지 않고 첫 화면으로 초기화한다. 이때도 공용 기기의
    // 사용자 전환 경계로 취급해, 모듈 초기화가 sessionStorage에서 복원한 Drive 세션과
    // 아직 끝나지 않은 사용자 조회를 즉시 무효화한다.
    signOut()
    window.history.replaceState(
      { ...(window.history.state || {}), userName: '', [HISTORY_PAGE_KEY]: 'entry' },
      '',
      window.location.href,
    )
    const handlePopState = (event) => {
      const historyPage = event.state?.[HISTORY_PAGE_KEY]
      if (!APP_PAGES.has(historyPage)) return
      // 브라우저 뒤로 가기로 첫 화면에 도달하는 경우도 공용 기기의 사용자 전환으로
      // 취급한다. 홈 버튼과 동일하게 진행 중 로그인까지 무효화하고 Drive 세션을 끊는다.
      if (historyPage === 'entry') signOut()
      if (typeof event.state?.userName === 'string') setUserName(event.state.userName)
      if (historyPage === 'editor') {
        const projectId = event.state?.editorProjectId
        const cols = Number(event.state?.editorCols)
        const rows = Number(event.state?.editorRows)
        let savedArtwork = null
        try {
          const saved = JSON.parse(localStorage.getItem(SKETCHBOOK_KEY) || '[]')
          savedArtwork = saved.find(item => item.id === projectId) || null
        } catch { /* 저장소를 읽지 못하면 탭 안의 최초 데이터로 복원 */ }
        const artwork = savedArtwork || editorInitialArtworkRef.current.get(projectId) || null
        if (Number.isFinite(cols) && Number.isFinite(rows)) setCanvasConfig({ cols, rows })
        setEditorProjectId(projectId ?? null)
        setResumeArtwork(artwork)
        setEditorKey(key => key + 1)
      }
      setPage(historyPage)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (newPage, { replace = false, historyState = {} } = {}) => {
    if (!APP_PAGES.has(newPage)) return
    const nextState = {
      ...(window.history.state || {}),
      ...historyState,
      [HISTORY_PAGE_KEY]: newPage,
    }
    window.history[replace ? 'replaceState' : 'pushState'](nextState, '', window.location.href)
    setPage(newPage)
  }

  const resetToEntry = () => {
    // 공용 기기에서 다음 사용자가 이전 사용자의 Drive 파일을 보지 못하도록, 완전히
    // 처음 화면으로 나갈 때는 Google 토큰도 함께 폐기한다.
    signOut()
    setUserName('')
    setCanvasConfig({ cols: 16, rows: 16 })
    setResumeArtwork(null)
    setEditorProjectId(null)
    navigate('entry', { historyState: { userName: '' } })
  }

  // 편집기 안에서 전체 지우기로 새 슬롯을 만들거나 PNG를 다른 이름으로 저장하면
  // EditorPage의 현재 프로젝트 ID가 바뀐다. 현재 브라우저 기록도 즉시 같은 ID로
  // 맞춰야 뒤로 갔다 앞으로 왔을 때 방금 만든 슬롯을 정확히 복원할 수 있다.
  const syncEditorHistory = ({ projectId, cols, rows, artwork = null }) => {
    setEditorProjectId(projectId)
    setResumeArtwork(artwork)
    if (artwork) editorInitialArtworkRef.current.set(projectId, artwork)
    else editorInitialArtworkRef.current.delete(projectId)
    window.history.replaceState({
      ...(window.history.state || {}),
      userName,
      editorProjectId: projectId,
      editorCols: cols,
      editorRows: rows,
      [HISTORY_PAGE_KEY]: 'editor',
    }, '', window.location.href)
  }

  return (
    <div className="h-svh w-screen overflow-hidden">
      {page === 'entry' && (
        <EntryPage
          onNext={(name) => {
            setUserName(name)
            navigate('setup', { historyState: { userName: name } })
          }}
        />
      )}
      {page === 'setup' && (
        <SetupPage
          onNext={(cfg) => {
            const projectId = Date.now()
            setCanvasConfig(cfg)
            setResumeArtwork(null)
            setEditorProjectId(projectId)
            editorInitialArtworkRef.current.delete(projectId)
            setEditorKey(k => k + 1)
            navigate('editor', {
              historyState: {
                editorProjectId: projectId,
                editorCols: cfg.cols,
                editorRows: cfg.rows,
                userName,
              },
            })
          }}
          onImport={(artwork) => {
            // 파일에서 불러온 그림은 그 칸 수 그대로 캔버스를 열고, 스케치북에는 새 작품으로 쌓인다
            const projectId = artwork.id ?? Date.now()
            const initialArtwork = { ...artwork, id: projectId, imported: true }
            setCanvasConfig({ cols: artwork.cols, rows: artwork.rows })
            setResumeArtwork(initialArtwork)
            setEditorProjectId(projectId)
            editorInitialArtworkRef.current.set(projectId, initialArtwork)
            setEditorKey(k => k + 1)
            navigate('editor', {
              historyState: {
                editorProjectId: projectId,
                editorCols: artwork.cols,
                editorRows: artwork.rows,
                userName,
              },
            })
          }}
          onGoHome={resetToEntry}
        />
      )}
      {page === 'editor' && (
        <EditorPage
          key={editorKey}
          userName={userName}
          gridCols={canvasConfig.cols}
          gridRows={canvasConfig.rows}
          projectId={editorProjectId}
          resumeArtwork={resumeArtwork}
          onGoToSetup={() => navigate('setup')}
          onProjectChange={syncEditorHistory}
          onEditArtwork={(artwork) => {
            const projectId = artwork.id ?? Date.now()
            const nextArtwork = { ...artwork, id: projectId }
            setCanvasConfig({ cols: nextArtwork.cols, rows: nextArtwork.rows })
            syncEditorHistory({
              projectId,
              cols: nextArtwork.cols,
              rows: nextArtwork.rows,
              artwork: nextArtwork,
            })
            setEditorKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}
