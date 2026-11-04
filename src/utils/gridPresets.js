// 각 비율의 "기준 방향" 해상도 [쉬움, 보통, 어려움]. 반대 방향은 cols/rows를 서로 바꿔 계산한다.
// 정사각형: 방향 없음(고정) · 태블릿: 기준 = 가로 · A4: 기준 = 세로
export const BASE_GRIDS = {
  square: [{ cols: 24, rows: 24 }, { cols: 32, rows: 32 }, { cols: 64, rows: 64 }],
  tablet: [{ cols: 28, rows: 21 }, { cols: 36, rows: 27 }, { cols: 48, rows: 36 }],
  a4:     [{ cols: 20, rows: 28 }, { cols: 30, rows: 42 }, { cols: 45, rows: 63 }],
}

// 설정 화면에서 고를 수 있는 모든 캔버스 크기(가로/세로 방향 모두, 중복 제거) —
// 불러온 그림이 몇 칸짜리였는지 추정할 때 후보 목록으로 쓴다.
export const ALL_GRIDS = (() => {
  const seen = new Set()
  const list = []
  for (const g of Object.values(BASE_GRIDS).flat()) {
    for (const { cols, rows } of [g, { cols: g.rows, rows: g.cols }]) {
      const key = `${cols}x${rows}`
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ cols, rows })
    }
  }
  return list
})()
