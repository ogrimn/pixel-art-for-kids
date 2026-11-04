import { useState, useEffect } from 'react'
import EntryPage from './pages/EntryPage'
import SetupPage from './pages/SetupPage'
import EditorPage from './pages/EditorPage'

export default function App() {
  const [page, setPage] = useState('entry')
  const [userName, setUserName] = useState('')
  const [canvasConfig, setCanvasConfig] = useState({ cols: 16, rows: 16 })
  const [resumeArtwork, setResumeArtwork] = useState(null)
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

  const navigate = (newPage) => setPage(newPage)

  const resetToEntry = () => {
    setUserName('')
    setCanvasConfig({ cols: 16, rows: 16 })
    setResumeArtwork(null)
    navigate('entry')
  }

  return (
    <div className="h-svh w-screen overflow-hidden">
      {page === 'entry' && (
        <EntryPage
          onNext={(name) => {
            setUserName(name)
            navigate('setup')
          }}
        />
      )}
      {page === 'setup' && (
        <SetupPage
          onNext={(cfg) => {
            setCanvasConfig(cfg)
            setResumeArtwork(null)
            setEditorKey(k => k + 1)
            navigate('editor')
          }}
          onImport={(artwork) => {
            // 파일에서 불러온 그림은 그 칸 수 그대로 캔버스를 열고, 스케치북에는 새 작품으로 쌓인다
            setCanvasConfig({ cols: artwork.cols, rows: artwork.rows })
            setResumeArtwork({ ...artwork, id: Date.now(), imported: true })
            setEditorKey(k => k + 1)
            navigate('editor')
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
          resumeArtwork={resumeArtwork}
          onGoToSetup={() => navigate('setup')}
          onEditArtwork={(artwork) => {
            setCanvasConfig({ cols: artwork.cols, rows: artwork.rows })
            setResumeArtwork(artwork)
            setEditorKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}
