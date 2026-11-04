import { useSyncExternalStore } from 'react'

// 구글 로그인 + 드라이브 저장. 서버 없이 브라우저가 구글 드라이브 API를 직접 부른다.
// 권한은 drive.file — 이 앱이 만든 파일에만 접근할 수 있어 사용자의 다른 드라이브 파일은 볼 수 없다.
// 클라이언트 ID는 비밀값이 아니다(브라우저에 그대로 노출되는 공개 식별자). 환경변수로 바꿔 끼울 수 있고,
// 빈 문자열이면 드라이브 기능을 숨긴다.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
  ?? '216081087813-v7vrf4tsqkfgolmanmvsihgdo23hajfj.apps.googleusercontent.com'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_NAME = '픽셀아트'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
// 액세스 토큰은 1시간짜리라, 새로고침해도 다시 로그인 창이 뜨지 않도록 탭이 살아있는 동안만 보관한다
const TOKEN_KEY = 'pixel_art_drive_token'

// ── 로그인 상태 저장소 (여러 컴포넌트가 useDrive()로 구독) ─────────────────────
// status: 'disabled'(클라이언트 ID 없음) | 'signedOut' | 'connecting' | 'signedIn' | 'expired'
let state = { status: GOOGLE_CLIENT_ID ? 'signedOut' : 'disabled', user: null }
const listeners = new Set()
const setState = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export function useDrive() {
  return useSyncExternalStore(subscribe, () => state)
}

let token = null // { value, expiresAt }
let folderIdPromise = null

function readStoredToken() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')
    if (saved && saved.expiresAt > Date.now() + 60_000) return saved
  } catch { /* 저장소를 못 쓰는 환경이면 매번 로그인 */ }
  return null
}

function storeToken(t) {
  token = t
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch { /* 무시 */ }
}

let gisPromise = null
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GIS_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => { gisPromise = null; reject(new Error('구글 로그인 스크립트를 불러오지 못했어요')) }
      document.head.appendChild(s)
    })
  }
  return gisPromise
}

// 로그인 팝업은 브라우저가 막지 않도록 반드시 버튼 클릭 같은 사용자 동작 안에서 호출해야 한다.
export async function signIn() {
  if (!GOOGLE_CLIENT_ID) return
  const prev = state.status
  setState({ status: 'connecting' })
  try {
    await loadGis()
    const resp = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: (r) => (r.error ? reject(new Error(r.error)) : resolve(r)),
        error_callback: (e) => reject(new Error(e?.type || 'popup_closed')),
      })
      // 한 번 동의한 계정이면 동의 화면 없이 바로 토큰이 발급된다
      client.requestAccessToken(prev === 'expired' ? { prompt: '' } : {})
    })
    if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      throw new Error('drive_scope_denied')
    }
    storeToken({ value: resp.access_token, expiresAt: Date.now() + resp.expires_in * 1000 })
    await loadUser()
  } catch (e) {
    setState({ status: prev === 'expired' ? 'expired' : 'signedOut' })
    throw e
  }
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token.value, () => {})
  }
  storeToken(null)
  folderIdPromise = null
  setState({ status: GOOGLE_CLIENT_ID ? 'signedOut' : 'disabled', user: null })
}

async function loadUser() {
  const about = await driveJson(`${API}/about?fields=user(displayName,emailAddress,photoLink)`)
  setState({ status: 'signedIn', user: about.user })
}

// 새로고침 직후: 아직 유효한 토큰이 남아 있으면 팝업 없이 로그인 상태를 복원한다
if (GOOGLE_CLIENT_ID) {
  const saved = readStoredToken()
  if (saved) {
    token = saved
    setState({ status: 'connecting' })
    loadUser().catch(() => {
      storeToken(null)
      setState({ status: 'signedOut', user: null })
    })
  }
}

export class DriveAuthError extends Error {}

async function driveFetch(url, opts = {}) {
  if (!token || token.expiresAt <= Date.now()) {
    if (token) { storeToken(null); setState({ status: 'expired' }) }
    throw new DriveAuthError('로그인이 필요해요')
  }
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.value}` },
  })
  if (res.status === 401) {
    storeToken(null)
    setState({ status: 'expired' })
    throw new DriveAuthError('로그인이 만료됐어요')
  }
  if (!res.ok) throw new Error(`드라이브 요청 실패 (${res.status})`)
  return res
}

const driveJson = (url, opts) => driveFetch(url, opts).then(r => r.json())

// 드라이브의 '픽셀아트' 폴더 — drive.file 권한에서는 이 앱이 만든 폴더만 검색되므로
// 사용자가 같은 이름의 폴더를 따로 갖고 있어도 섞이지 않는다.
function getFolderId() {
  if (!folderIdPromise) {
    folderIdPromise = (async () => {
      const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`)
      const found = await driveJson(`${API}/files?q=${q}&fields=files(id)&spaces=drive`)
      if (found.files?.length) return found.files[0].id
      const created = await driveJson(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      })
      return created.id
    })().catch(e => { folderIdPromise = null; throw e })
  }
  return folderIdPromise
}

function multipartBody(metadata, blob) {
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob)
  return form
}

// 작품 하나 = 드라이브의 PNG 파일 하나. 교사가 드라이브에서 그대로 패들렛에 올릴 수 있고,
// 칸 수는 appProperties에 적어 두어 다시 불러올 때 칸 수를 추정할 필요가 없다.
export async function saveArtworkToDrive({ driveId, fileName, blob, cols, rows }) {
  const metadata = {
    name: `${fileName}.png`,
    mimeType: 'image/png',
    appProperties: { pixelArt: '1', cols: String(cols), rows: String(rows) },
  }
  if (driveId) {
    try {
      const updated = await driveJson(`${UPLOAD_API}/files/${driveId}?uploadType=multipart&fields=id`, {
        method: 'PATCH',
        body: multipartBody(metadata, blob),
      })
      return updated.id
    } catch (e) {
      // 드라이브에서 파일을 지웠다면 새로 만든다
      if (e instanceof DriveAuthError) throw e
    }
  }
  const parent = await getFolderId()
  const created = await driveJson(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    body: multipartBody({ ...metadata, parents: [parent] }, blob),
  })
  return created.id
}

export async function listDriveArtworks() {
  const parent = await getFolderId()
  const q = encodeURIComponent(
    `'${parent}' in parents and trashed=false and appProperties has { key='pixelArt' and value='1' }`)
  const res = await driveJson(
    `${API}/files?q=${q}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime,appProperties)`)
  return (res.files || []).map(f => ({
    driveId: f.id,
    fileName: f.name.replace(/\.png$/i, ''),
    updatedAt: f.modifiedTime,
    cols: Number(f.appProperties?.cols),
    rows: Number(f.appProperties?.rows),
  }))
}

export async function downloadDriveArtwork(driveId) {
  const res = await driveFetch(`${API}/files/${driveId}?alt=media`)
  return res.blob()
}

// 영구 삭제 대신 드라이브 휴지통으로 — 실수로 지워도 드라이브에서 되살릴 수 있게
export async function trashDriveArtwork(driveId) {
  await driveJson(`${API}/files/${driveId}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}
