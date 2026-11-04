// 스포이드 확대 돋보기(데스크탑 네이티브 EyeDropper의 확대 미리보기 흉내) 렌더링 공용 로직.
// 캔버스(PixelCanvas)와 밑그림 원본 미리보기 썸네일(EditorPage) 양쪽에서 재사용한다 —
// 그리기 방식(9x9 격자 + 가운데 칸 강조)은 같고, "칸 하나가 가리키는 실제 좌표를 어떻게
// 샘플링하는지"만 사용처마다 다르므로 그 부분은 sampleColorAt 콜백으로 분리했다.
export const LOUPE_SIZE = 108
export const LOUPE_GRID = 9

// canvas: 그려 넣을 작은 정사각형 <canvas> 엘리먼트
// sampleColorAt(dx, dy): 가운데 칸 기준 격자 오프셋(-half..+half)을 받아 hex 색상을 반환
export function drawLoupe(canvas, sampleColorAt) {
  const dpr = window.devicePixelRatio || 1
  const wantPx = Math.round(LOUPE_SIZE * dpr)
  if (canvas.width !== wantPx) {
    canvas.width = wantPx
    canvas.height = wantPx
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cellPx = LOUPE_SIZE / LOUPE_GRID
  const half = Math.floor(LOUPE_GRID / 2)
  for (let gy = 0; gy < LOUPE_GRID; gy++) {
    for (let gx = 0; gx < LOUPE_GRID; gx++) {
      ctx.fillStyle = sampleColorAt(gx - half, gy - half) || '#ffffff'
      ctx.fillRect(gx * cellPx, gy * cellPx, cellPx, cellPx)
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'
  ctx.lineWidth = 1
  for (let i = 1; i < LOUPE_GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellPx, 0); ctx.lineTo(i * cellPx, LOUPE_SIZE); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * cellPx); ctx.lineTo(LOUPE_SIZE, i * cellPx); ctx.stroke()
  }
  // 가운데 칸(= 실제로 추출될 색) 강조
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  ctx.strokeRect(half * cellPx + 1, half * cellPx + 1, cellPx - 2, cellPx - 2)
}
