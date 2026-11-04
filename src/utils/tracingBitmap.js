// 밑그림(tracing image)의 실제 픽셀 색을 스포이드로 읽기 위한 공용 헬퍼.
// <img>는 DOM에 CSS로만 배치되고 캔버스에는 그려지지 않으므로, 원본 픽셀을 읽으려면
// 오프스크린 캔버스에 한 번 디코딩해둔 뒤 getImageData로 읽어야 한다.
// PixelCanvas(그리기 캔버스 위 밑그림)와 EditorPage(사이드바 원본 미리보기 썸네일)가
// 이 로직을 공유한다 — 픽셀을 담는 방식(object-fit:contain)은 같고, 좌표 변환(캔버스 쪽은
// 드래그 이동/확대 transform까지 역산)만 사용처마다 다르다.

// data: URL(항상 same-origin 취급되어 taint 걱정 없음)을 오프스크린 캔버스에 디코딩한다.
// 성공 시 onReady({ canvas, width, height })를 호출. 언마운트/변경 시 cancel용 함수를 반환.
export function decodeTracingBitmap(dataUrl, onReady) {
  let cancelled = false
  const img = new Image()
  img.onload = () => {
    if (cancelled) return
    const off = document.createElement('canvas')
    off.width = img.naturalWidth
    off.height = img.naturalHeight
    off.getContext('2d').drawImage(img, 0, 0)
    onReady({ canvas: off, width: img.naturalWidth, height: img.naturalHeight })
  }
  img.src = dataUrl
  return () => { cancelled = true }
}

// box(boxW x boxH) 안에 object-fit:contain으로 배치된 비트맵에서, box 기준 로컬 좌표
// (localX, localY)에 대응하는 원본 픽셀 색을 읽는다. 레터박스(여백) 영역이면 null.
export function sampleContainColor(bitmap, localX, localY, boxW, boxH) {
  if (!bitmap || boxW <= 0 || boxH <= 0) return null
  const fitScale = Math.min(boxW / bitmap.width, boxH / bitmap.height)
  const padX = (boxW - bitmap.width * fitScale) / 2
  const padY = (boxH - bitmap.height * fitScale) / 2
  const imgX = Math.floor((localX - padX) / fitScale)
  const imgY = Math.floor((localY - padY) / fitScale)
  if (imgX < 0 || imgY < 0 || imgX >= bitmap.width || imgY >= bitmap.height) return null
  try {
    const [r, g, b] = bitmap.canvas.getContext('2d').getImageData(imgX, imgY, 1, 1).data
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
