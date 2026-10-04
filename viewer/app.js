// ─────────────────────────────────────────────
//  과거 대화 뷰어 — 읽기 전용
//
//  의존성 0개 · 빌드 0개입니다. supabase-js를 쓰지 않고
//  PostgREST REST를 fetch로 직접 부릅니다. 왜냐하면 빌드가 없으면
//  "npm ci가 깨졌다"는 종류의 사고가 이 화면에 원래 존재할 필요가 없기 때문입니다.
//
//  ★ 읽기 전용이 보장되는 곳은 여기 코드가 아니라 DB입니다 ★
//  이 파일에는 쓰기 요청이 아예 없습니다. 그런데 파일을 통째로 지워도
//  안전합니다 — supabase/viewer-read-only.sql 에 SELECT 정책 두 개만 있고,
//  RLS는 정책이 하나도 없으면 전부 거부하므로 policy 를 지우면 닫힙니다.
// ─────────────────────────────────────────────

import { SUPABASE_URL, ANON_KEY } from './config.js'

const $ = (id) => document.getElementById(id)

const state = {
  kind: 'chat',
  search: '',
  conversations: [],
  selectedId: null,
}

// 목록은 500개까지. 더 쌓이면 limit 을 올리면 되는데,
// 뷰어의 목적이 "지난 대화 다시 보기"라 이쯤이면 충분합니다.
const CONVERSATION_LIMIT = 500

// ── Supabase REST ────────────────────────────

async function rest(path, params = {}) {
  const url = new URL(`/rest/v1/${path}`, SUPABASE_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Accept: 'application/json',
    },
  })

  const raw = await res.text()
  let body = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    // PostgREST는 실패 시 { code, message, hint, details } 를 줍니다.
    // message 만 화면에 냅니다 (원본 응답을 그대로 흘리지 않는 규칙).
    const message = (body && (body.message || body.hint)) || `HTTP ${res.status}`
    throw new Error(message)
  }
  return body
}

async function loadConversations() {
  return rest('conversations', {
    select: 'id,title,kind,provider,model,created_at,updated_at',
    order: 'updated_at.desc',
    limit: String(CONVERSATION_LIMIT),
  })
}

async function loadMessages(conversationId) {
  /*
    created_at 순서로 정렬합니다.
    ★ 동시각이면 순서가 보장되지 않습니다 ★
    Postgres의 now() 는 트랜잭션 시각이라 한 트랜잭션에서 넣은 행은
    시간이 같습니다. 일반 채팅은 메시지가 따로 저장되니 문제가 없지만,
    한 번에 여러 메시지를 넣으면(keepalive 프로브가 그렇습니다) 순서가
    섞일 수 있습니다. 순서를 확실히 하려면 messages 에 증가하는 순서 열이 있어야 합니다.
    지금 앱도 같은 이유로 같은 제약을 안고 있습니다 — 뷰어만의 문제가 아닙니다.
  */
  return rest('messages', {
    select: 'role,content,created_at,meta',
    conversation_id: `eq.${conversationId}`,
    order: 'created_at.asc',
  })
}

// ── 화면 ─────────────────────────────────────

function showFatal(html) {
  const box = $('fatal')
  box.innerHTML = html
  box.hidden = false
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function metaLineOf(conv) {
  const parts = []
  if (conv.provider) parts.push(conv.provider)
  if (conv.model) parts.push(conv.model)
  const when = formatDate(conv.updated_at)
  if (when) parts.push(when)
  return parts.join('  ·  ')
}

function visibleConversations() {
  const term = state.search.trim().toLowerCase()
  return state.conversations.filter((c) => {
    if (c.kind !== state.kind) return false
    if (!term) return true
    return (c.title || '').toLowerCase().includes(term)
  })
}

function renderList() {
  const box = $('list')
  box.replaceChildren()

  const rows = visibleConversations()

  if (!rows.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = state.conversations.length
      ? '조건에 맞는 대화가 없습니다.'
      : '저장된 대화가 없습니다. 채팅을 한 번 이상 해야 채워집니다.'
    box.append(p)
    return
  }

  for (const conv of rows) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'row'
    if (conv.id === state.selectedId) button.classList.add('is-active')

    const title = document.createElement('div')
    title.className = 'row-title'
    title.textContent = conv.title || '제목 없음'

    const meta = document.createElement('div')
    meta.className = 'row-meta'
    meta.textContent = metaLineOf(conv)

    button.append(title, meta)
    button.addEventListener('click', () => {
      openConversation(conv)
    })
    box.append(button)
  }
}

async function openConversation(conv) {
  state.selectedId = conv.id
  renderList()

  const head = $('head')
  head.replaceChildren()
  const h = document.createElement('h2')
  h.textContent = conv.title || '제목 없음'
  const meta = document.createElement('div')
  meta.className = 'row-meta'
  meta.textContent = metaLineOf(conv)
  head.append(h, meta)

  const thread = $('thread')
  thread.replaceChildren()
  thread.append(loadingRow())

  let messages
  try {
    messages = await loadMessages(conv.id)
  } catch (err) {
    thread.replaceChildren(errorRow(`메시지를 못 읽었습니다: ${err.message}`))
    return
  }

  thread.replaceChildren()
  if (!messages.length) {
    thread.append(emptyRow('이 대화에는 메시지가 없습니다.'))
    return
  }
  for (const m of messages) {
    thread.append(bubbleOf(m))
  }
  thread.scrollTop = thread.scrollHeight
}

function bubbleOf(message) {
  const isMe = message.role === 'user'
  const wrap = document.createElement('div')
  wrap.className = isMe ? 'bubble is-me' : 'bubble'

  const label = document.createElement('div')
  label.className = 'bubble-label'
  // meta 에 provider·model 이 들어오는 메시지가 있습니다 (keepalive 프로브).
  const who = document.createElement('span')
  who.textContent = isMe ? '나' : 'AI'
  const when = document.createElement('span')
  when.textContent = formatDate(message.created_at)
  label.append(who, when)

  const fromMeta = message.meta && (message.meta.provider || message.meta.model)
  if (!isMe && fromMeta) {
    const tag = document.createElement('span')
    tag.textContent = String(fromMeta)
    label.append(tag)
  }

  const content = document.createElement('div')
  content.className = 'bubble-content'
  // ★ textContent 로 넣습니다 ★
  // 이 뷰어는 마크다운을 렌더링하지 않습니다. 원본 provider 응답처럼 보이는
  // 문제가 앱에서 있었던 것처럼, HTML을 해석해 넣는 경로는 만들지 않습니다.
  content.textContent = message.content || ''

  wrap.append(label, content)
  return wrap
}

function loadingRow() {
  const p = document.createElement('p')
  p.className = 'empty'
  p.textContent = '읽는 중…'
  return p
}

function emptyRow(text) {
  const p = document.createElement('p')
  p.className = 'empty'
  p.textContent = text
  return p
}

function errorRow(text) {
  const p = document.createElement('p')
  p.className = 'empty'
  p.style.color = 'var(--danger)'
  p.textContent = text
  return p
}

// ── 시작 ─────────────────────────────────────

function setupThemeButton() {
  const button = $('theme')
  button.addEventListener('click', () => {
    const root = document.documentElement
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      // 사생활 모드 등. 화면은 이미 바뀌었으므로 조용히 넘어갑니다.
    }
  })
}

async function refresh() {
  const list = $('list')
  list.replaceChildren(loadingRow())
  try {
    state.conversations = (await loadConversations()) || []
  } catch (err) {
    list.replaceChildren(errorRow(`대화 목록을 못 읽었습니다: ${err.message}`))
    return
  }

  renderList()

  const first = visibleConversations()[0]
  if (first) {
    await openConversation(first)
  } else {
    $('thread').replaceChildren()
  }
}

function setupTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) {
        other.classList.toggle('is-active', other === tab)
      }
      state.kind = tab.dataset.kind
      state.selectedId = null
      renderList()
    })
  }
}

function setupSearch() {
  $('search').addEventListener('input', (event) => {
    state.search = event.target.value
    renderList()
  })
}

function main() {
  setupThemeButton()
  setupTabs()
  setupSearch()
  $('refresh').addEventListener('click', refresh)

  if (!SUPABASE_URL || !ANON_KEY) {
    showFatal(
      '설정이 아직 없습니다. <code>viewer/config.js</code>를 열어 ' +
        '<code>SUPABASE_URL</code>과 <code>ANON_KEY</code>를 채우고 다시 빌드하세요.' +
        '<br />anon 키만 넣으세요. service_role 키를 넣으면 대화가 통째로 노출됩니다.'
    )
    $('list').replaceChildren()
    return
  }

  refresh()
}

main()