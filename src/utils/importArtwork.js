import { ALL_GRIDS } from './gridPresets'
import { PRESET_COLORS } from './palette'

// 이 앱이 저장한 PNG를 다시 칸 데이터로 되돌린다. 패들렛 등을 거치면 크기가 줄고
// 형식(webp 등)이 바뀌어 한 칸이 정수 픽셀이 아니게 되므로, 칸 경계가 아닌
// "칸 안쪽 가운데 영역"의 색만 읽어 경계에 생긴 번짐을 피한다.

const SAMPLES_PER_SIDE = 5   // 칸 하나당 가로·세로로 읽는 점 개수 (가운데 50% 영역 안)
const MIXED_STD = 10         // 칸 안쪽 색 편차가 이보다 크면 두 칸 이상에 걸친 칸으로 본다
const CLEAN_RATIO = 0.003    // 걸친 칸 비율이 이 이하인 격자는 "딱 맞는" 격자로 본다
const ASPECT_TOL = 0.03      // 이미지 가로세로 비율과 격자 비율의 허용 오차
const MIN_CELL_PX = 4        // 한 칸이 이보다 작으면 너무 줄어든 이미지라 읽지 않는다
const MERGE_TOL = 12         // 압축으로 미세하게 달라진 색을 같은 색으로 합치는 기준(채널별 최대 차이)
const SNAP_TOL = 16          // 기본 팔레트 색과 이만큼 가까우면 팔레트 색으로 정확히 맞춘다
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 24_000_000
export const MAX_IMAGE_SIDE = 8192

export class ImageValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImageValidationError'
  }
}

async function validateImageFile(file) {
  if (!file || typeof file.slice !== 'function') {
    throw new ImageValidationError('PNG, JPG 또는 WebP 파일만 불러올 수 있어요.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('이미지 파일은 10MB 이하만 불러올 수 있어요.')
  }

  // 드래그하거나 메신저에서 내려받은 파일은 브라우저가 type을 비워 두거나
  // application/octet-stream으로 주기도 한다. MIME 표기를 신뢰하는 대신 실제 파일
  // 시그니처를 읽어 PNG/JPEG/WebP만 통과시키고, 이후 Data URL에도 정확한 MIME을 쓴다.
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const isPng = bytes.length >= 8
    && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((byte, i) => bytes[i] === byte)
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  const isWebp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  const detectedType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : null
  if (!detectedType) {
    throw new ImageValidationError('PNG, JPG 또는 WebP 파일만 불러올 수 있어요.')
  }
  return detectedType
}

const withDetectedType = (file, detectedType) => (
  file.type === detectedType ? file : file.slice(0, file.size, detectedType)
)

function validateImageDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new ImageValidationError('이미지 크기를 확인할 수 없어요.')
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError('이미지가 너무 커요. 한 변 8192px, 전체 2,400만 픽셀 이하의 이미지를 골라 주세요.')
  }
}

// 파일을 디코딩해 픽셀 데이터로 — 투명한 부분은 저장할 때처럼 흰 배경 위에 합성한다.
export async function loadImageFile(file) {
  const detectedType = await validateImageFile(file)
  const normalizedFile = withDetectedType(file, detectedType)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(normalizedFile)
    const img = new Image()
    img.onload = () => {
      try {
        validateImageDimensions(img.naturalWidth, img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('canvas_unavailable')
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지를 열 수 없어요'))
    }
    img.src = url
  })
}

// 밑그림은 Data URL로 상태와 되돌리기 기록에 보관한다. 파일을 메모리에 올리기 전에
// 형식·용량을 검사하고, 디코딩 직후에도 해상도를 제한해 압축률이 높은 거대 이미지로
// 탭이 멈추는 일을 줄인다.
export async function loadImageDataUrl(file) {
  const detectedType = await validateImageFile(file)
  const normalizedFile = withDetectedType(file, detectedType)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(normalizedFile)
    const img = new Image()
    img.onload = () => {
      try {
        validateImageDimensions(img.naturalWidth, img.naturalHeight)
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
        return
      }
      URL.revokeObjectURL(url)
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new ImageValidationError('이미지 파일을 읽을 수 없어요.'))
      reader.readAsDataURL(normalizedFile)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageValidationError('이미지 파일을 열 수 없어요.'))
    }
    img.src = url
  })
}

// 주어진 격자로 이미지를 나눴을 때 각 칸의 대표 색과, 두 칸에 걸친(=격자가 안 맞는) 칸의 개수
function measureGrid({ data, width, height }, cols, rows) {
  const cw = width / cols
  const ch = height / rows
  const colors = new Array(cols * rows)
  let mixed = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0, n = 0
      for (let j = 0; j < SAMPLES_PER_SIDE; j++) {
        const y = Math.min(height - 1, Math.floor((r + 0.25 + 0.5 * (j + 0.5) / SAMPLES_PER_SIDE) * ch))
        for (let i = 0; i < SAMPLES_PER_SIDE; i++) {
          const x = Math.min(width - 1, Math.floor((c + 0.25 + 0.5 * (i + 0.5) / SAMPLES_PER_SIDE) * cw))
          const k = (y * width + x) * 4
          const R = data[k], G = data[k + 1], B = data[k + 2]
          sr += R; sg += G; sb += B
          qr += R * R; qg += G * G; qb += B * B
          n++
        }
      }
      const mr = sr / n, mg = sg / n, mb = sb / n
      const std = (
        Math.sqrt(Math.max(0, qr / n - mr * mr))
        + Math.sqrt(Math.max(0, qg / n - mg * mg))
        + Math.sqrt(Math.max(0, qb / n - mb * mb))
      ) / 3
      if (std > MIXED_STD) mixed++
      colors[r * cols + c] = [mr, mg, mb]
    }
  }
  return { cols, rows, mixed, colors }
}

const toHex = (rgb) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
const hexToRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
const PRESET_RGB = PRESET_COLORS.map(hex => ({ hex, rgb: hexToRgb(hex) }))

// 칸별 대표 색을 비슷한 색끼리 묶어 원래 쓰인 색으로 되돌린 뒤 2차원 칸 배열로 만든다.
// 흰색은 빈칸(null)으로 — 편집기에서 빈칸이 흰색으로 그려지고 채우기에서도 같은 색으로 취급된다.
function buildArtwork({ cols, rows, colors }) {
  const clusters = []
  const labels = colors.map(rgb => {
    let idx = clusters.findIndex(cl => maxDiff(cl.seed, rgb) <= MERGE_TOL)
    if (idx < 0) {
      clusters.push({ seed: rgb, sum: [0, 0, 0], count: 0 })
      idx = clusters.length - 1
    }
    const cl = clusters[idx]
    cl.sum[0] += rgb[0]; cl.sum[1] += rgb[1]; cl.sum[2] += rgb[2]; cl.count++
    return idx
  })
  const clusterColors = clusters.map(cl => {
    const mean = cl.sum.map(v => v / cl.count)
    const preset = PRESET_RGB.find(p => maxDiff(p.rgb, mean) <= SNAP_TOL)
    const hex = preset ? preset.hex : toHex(mean)
    return hex === '#FFFFFF' ? null : hex
  })
  const pixels = []
  for (let r = 0; r < rows; r++) {
    pixels.push(labels.slice(r * cols, (r + 1) * cols).map(l => clusterColors[l]))
  }
  return { cols, rows, pixels }
}

// 칸 수를 이미 알고 있을 때(드라이브에 칸 수를 함께 저장해 둔 그림) — 추정 없이 바로 복원
export function decodeArtwork(image, cols, rows) {
  return buildArtwork(measureGrid(image, cols, rows))
}

// 결과:
//  { status: 'ok', artwork }            — 격자를 확실히 찾음
//  { status: 'ambiguous', options }     — 후보가 애매해서 사용자가 미리보기를 보고 골라야 함
//  { status: 'unsupported' }            — 이 앱의 캔버스 비율과 맞지 않는 이미지
export function detectArtwork(image) {
  const aspect = image.width / image.height
  const fits = ALL_GRIDS.filter(g =>
    Math.abs(g.cols / g.rows - aspect) / aspect <= ASPECT_TOL
    && image.width / g.cols >= MIN_CELL_PX
    && image.height / g.rows >= MIN_CELL_PX)
  if (!fits.length) return { status: 'unsupported' }

  const measured = fits.map(g => ({
    ...measureGrid(image, g.cols, g.rows),
    legacy: g.legacy,
  }))
  // 비율이 아니라 "걸친 칸 개수"로 비교한다 — 배경이 대부분인 그림은 틀린 격자로 나눠도
  // 걸친 칸이 한두 개뿐이라, 비율로 보면 틀린 격자도 맞는 것처럼 보이기 때문.
  const best = Math.min(...measured.map(m => m.mixed))
  // 32칸 그림은 64칸 격자로 나눠도 칸이 딱 맞는다(한 칸이 정확히 네 칸으로 쪼개질 뿐).
  // 그래서 똑같이 잘 맞는 격자가 여럿이면 가장 큰 칸(=칸 수가 가장 적은) 격자가 원래 크기다.
  const clean = measured
    .filter(m => m.mixed === best && m.mixed <= m.cols * m.rows * CLEAN_RATIO)
    .sort((a, b) => a.cols * a.rows - b.cols * b.rows)
  const currentClean = clean.filter(m => !m.legacy)
  const legacyClean = clean.filter(m => m.legacy)
  // 현재 규격과 예전 규격이 모두 정확히 맞는 단순한 그림은 어느 쪽도 자동 우선하지
  // 않는다. 미리보기를 보여 주고 사용자가 원래 칸 수를 선택하게 해야 세부 묘사를 잃지 않는다.
  if (currentClean.length && legacyClean.length) {
    return {
      status: 'ambiguous',
      options: [currentClean[0], legacyClean[0]].map(buildArtwork),
    }
  }
  if (clean.length) return { status: 'ok', artwork: buildArtwork(clean[0]) }

  const ranked = [...measured]
    .sort((a, b) =>
      a.mixed / (a.cols * a.rows) - b.mixed / (b.cols * b.rows)
      || Number(a.legacy) - Number(b.legacy))
    .slice(0, 3)
  return { status: 'ambiguous', options: ranked.map(buildArtwork) }
}
