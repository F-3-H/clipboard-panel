;(function () {
'use strict'
// 防重复加载：无论脚本被执行多少次，都只初始化一次
if (window.__clipboardPanelBooted) return
window.__clipboardPanelBooted = true

const $ = (sel) => document.querySelector(sel)
const api = window.api

// ---------------------------------------------------------------- 错误可见化
function showError(msg) {
  const bar = $('#errbar')
  if (!bar) return
  bar.textContent = '页面错误：' + msg
  bar.classList.remove('hidden')
  try { api.reportError(String(msg)) } catch {}
}
window.addEventListener('error', (e) => showError(e.message || e.error))
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason && e.reason.stack || e.reason)))

const els = {
  app: $('#app'),
  titlebar: $('#titlebar'),
  collapsedBar: $('#collapsedBar'),
  workspace: $('#workspace'),
  paneClip: $('#pane-clipboard'),
  paneAlbum: $('#pane-album'),
  splitter: $('#splitter'),
  clipList: $('#clipList'),
  albumGrid: $('#albumGrid'),
  search: $('#search'),
  countClip: $('#countClip'),
  countAlbum: $('#countAlbum'),
  clipStatus: $('#clipStatus'),
  albumStatus: $('#albumStatus'),
  folderChips: $('#folderChips'),
  popover: $('#popover'),
  optTop: $('#optTop'),
  btnTop: $('#btnTop'),
  dropHint: $('#dropHint'),
  tagbar: $('#tagbar'),
  albumTagbar: $('#albumTagbar'),
  tagEditor: $('#tagEditor'),
  tagInput: $('#tagInput'),
  tagAdd: $('#tagAdd'),
  tagSuggest: $('#tagSuggest'),
  tagCurrent: $('#tagCurrent'),
  tagDone: $('#tagDone'),
  toast: null
}

let S = { history: [], album: [], settings: {}, albumDir: '' }
let filterTag = null            // 剪贴板当前筛选的标签（null = 全部）
let albumFilterTag = null       // 相册当前筛选的标签
let tagEditType = null          // 编辑目标：'clip' 或 'album'
let tagEditKey = null           // clip=条目id，album=图片路径
let tagEditSet = []             // 编辑中的标签集合

// ---------------------------------------------------------------- helpers
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function fmtTime(ts) {
  const d = new Date(ts), now = new Date()
  const diff = now - d
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前'
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前'
  const pad = (n) => String(n).padStart(2, '0')
  const date = (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-') +
    pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

let toastTimer = null
function toast(msg) {
  if (!els.toast) {
    els.toast = document.createElement('div')
    els.toast.id = 'toast'
    document.body.appendChild(els.toast)
  }
  els.toast.textContent = msg
  els.toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600)
}

// ---------------------------------------------------------------- 布局：方向 / 分隔条 / 重排
let splitRatio = 0.5
let pos = 'row'            // row | row-rev | col | col-rev

function isCol() { return pos === 'col' || pos === 'col-rev' }
function pct(v) { return (Math.round(v * 10000) / 100).toFixed(2) + '%' }

// 用绝对定位百分比矩阵排布两框：支持横向/纵向/互换，且两框始终填满各自区域
function setLayoutFromState() {
  const s = Math.max(0.08, Math.min(0.92, splitRatio))
  const ws = els.workspace
  const horiz = !isCol()
  const clipFirst = (pos === 'row' || pos === 'col')
  const main = clipFirst ? els.paneClip : els.paneAlbum
  const other = clipFirst ? els.paneAlbum : els.paneClip
  if (horiz) {
    main.style.left = '0'; main.style.top = '0'; main.style.width = pct(s); main.style.height = '100%'
    other.style.left = pct(s); other.style.top = '0'; other.style.width = pct(1 - s); other.style.height = '100%'
    els.splitter.style.left = pct(s); els.splitter.style.top = '0'; els.splitter.style.width = '12px'; els.splitter.style.height = '100%'; els.splitter.style.cursor = 'col-resize'
    ws.dataset.orient = 'v'
  } else {
    main.style.left = '0'; main.style.top = '0'; main.style.width = '100%'; main.style.height = pct(s)
    other.style.left = '0'; other.style.top = pct(s); other.style.width = '100%'; other.style.height = pct(1 - s)
    els.splitter.style.left = '0'; els.splitter.style.top = pct(s); els.splitter.style.width = '100%'; els.splitter.style.height = '12px'; els.splitter.style.cursor = 'row-resize'
    ws.dataset.orient = 'h'
  }
  // 关闭的框隐藏，另一个框覆盖全部
  const clipClosed = els.paneClip.classList.contains('closed')
  const albumClosed = els.paneAlbum.classList.contains('closed')
  if (clipClosed) { els.paneClip.style.display = 'none'; setFull(els.paneAlbum) }
  else if (albumClosed) { els.paneAlbum.style.display = 'none'; setFull(els.paneClip) }
  else { els.paneClip.style.display = ''; els.paneAlbum.style.display = '' }
}
function setFull(el) {
  el.style.left = '0'; el.style.top = '0'; el.style.width = '100%'; el.style.height = '100%'
}
function applyLayout() { setLayoutFromState() }

// ---- 分隔条拖拽：实时调整比例，方向与框大小联动 ----
let splitting = false
let splitStart = 0
let splitStartRatio = 0.5
els.splitter.addEventListener('mousedown', (e) => {
  splitting = true
  splitStart = isCol() ? e.clientY : e.clientX
  splitStartRatio = splitRatio
  els.splitter.classList.add('dragging')
  els.workspace.classList.add('resizing')   // 拖分隔条时关闭过渡，跟手即时
  e.preventDefault()
})
document.addEventListener('mousemove', (e) => {
  if (!splitting) return
  const span = isCol() ? els.workspace.clientHeight : els.workspace.clientWidth
  const delta = isCol() ? (e.clientY - splitStart) : (e.clientX - splitStart)
  // 正向：鼠标往某方向拖，分隔条就往某方向移，该侧框变大
  splitRatio = Math.max(0.08, Math.min(0.92, splitStartRatio + delta / span))
  setLayoutFromState()
})
document.addEventListener('mouseup', () => {
  if (!splitting) return
  splitting = false
  els.splitter.classList.remove('dragging')
  els.workspace.classList.remove('resizing')
  api.updateSettings({ splitRatio })
  // 被拖到很小的框自动关闭（被挤掉）
  const MIN = isCol() ? 110 : 150
  const clipS = isCol() ? els.paneClip.getBoundingClientRect().height : els.paneClip.getBoundingClientRect().width
  const albumS = isCol() ? els.paneAlbum.getBoundingClientRect().height : els.paneAlbum.getBoundingClientRect().width
  if (clipS < MIN) closePane('clip')
  else if (albumS < MIN) closePane('album')
})
els.splitter.addEventListener('dblclick', () => {
  splitRatio = 0.5
  setLayoutFromState()
  api.updateSettings({ splitRatio })
})
window.addEventListener('resize', () => { if (!splitting) setLayoutFromState() })

// ---------------------------------------------------------------- 拖动重排：拖动即实时看到框被挤走
let dragPane = null
let dragStartPane = null
let dragging = false
let dsx = 0
let dsy = 0
const POS_BY = {
  left:   { clip: 'row',       album: 'row-rev' },
  right:  { clip: 'row-rev',   album: 'row' },
  top:    { clip: 'col',       album: 'col-rev' },
  bottom: { clip: 'col-rev',   album: 'col' }
}
function otherPane(p) { return p === 'clip' ? 'album' : 'clip' }
function paneEl(p) { return p === 'clip' ? els.paneClip : els.paneAlbum }
function clearPanes() {
  // 拖动重排已改为实时滑动预览，无目标高亮，此函数仅用于清理状态
}
function dropQuadrant(e) {
  const r = paneEl(otherPane(dragPane)).getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

document.querySelectorAll('.bubble-head').forEach((h) => {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('button, input, .bubble-count')) return
    dragging = false; dragPane = null; dragStartPane = null
    dsx = e.clientX; dsy = e.clientY
    dragStartPane = h.closest('.bubble').id === 'pane-clipboard' ? 'clip' : 'album'
  })
})
document.addEventListener('pointermove', (e) => {
  if (dragStartPane === null) return
  if (!dragging && Math.hypot(e.clientX - dsx, e.clientY - dsy) > 8) {
    dragging = true
    dragPane = dragStartPane
  }
  if (dragging) {
    const q = dropQuadrant(e)
    const t = POS_BY[q][dragPane]
    if (t !== pos) { pos = t; setLayoutFromState() }   // 实时预览：框跟着动、另一个框被挤走
  }
})
document.addEventListener('pointerup', (e) => {
  if (dragStartPane === null) { dragStartPane = null; return }
  if (dragging && dragPane) {
    splitRatio = 0.5            // 落定后两框均分，各自填满
    setLayoutFromState()
    api.updateSettings({ pos, splitRatio })
    bouncePanes()
    toast('已互换位置')
  }
  dragging = false; dragPane = null; dragStartPane = null
  clearPanes()
})
function bouncePanes() {
  [els.paneClip, els.paneAlbum].forEach((el) => {
    el.classList.remove('swap-pop')
    void el.offsetWidth
    el.classList.add('swap-pop')
  })
  setTimeout(() => [els.paneClip, els.paneAlbum].forEach((el) => el.classList.remove('swap-pop')), 500)
}

// ---------------------------------------------------------------- 单框关闭 / 四壁唤出
function updateCornerHints() {
  const has = els.paneClip.classList.contains('closed') || els.paneAlbum.classList.contains('closed')
  $('#cornerHints').classList.toggle('show', !!has)
  els.workspace.classList.toggle('has-closed', !!has)
  els.splitter.style.display = has ? 'none' : ''
}
function closePane(pane) {
  paneEl(pane).classList.add('closed')
  setLayoutFromState()          // 让另一个框覆盖整个面板
  updateCornerHints()
  api.updateSettings(pane === 'clip' ? { clipMinimized: true } : { albumMinimized: true })
}
function openPaneAt(pane, side) {
  paneEl(pane).classList.remove('closed')
  pos = POS_BY[side][pane]
  applyLayout()
  api.updateSettings(Object.assign({ pos }, pane === 'clip' ? { clipMinimized: false } : { albumMinimized: false }))
  updateCornerHints()
  toast('已唤出「' + (pane === 'clip' ? '剪贴板' : '相册') + '」')
}
$('#clipMinBtn').addEventListener('click', () => closePane('clip'))
$('#albumMinBtn').addEventListener('click', () => closePane('album'))
document.querySelectorAll('#cornerHints .edge').forEach((ed) => {
  ed.addEventListener('click', () => {
    const closed = els.paneClip.classList.contains('closed') ? 'clip'
      : (els.paneAlbum.classList.contains('closed') ? 'album' : null)
    if (closed) openPaneAt(closed, ed.dataset.side)
  })
})

// ---------------------------------------------------------------- 主题风格
function applyTheme(theme, animate) {
  if (animate) {
    document.body.classList.add('theming')
    setTimeout(() => document.body.classList.remove('theming'), 650)
  }
  document.body.dataset.theme = theme || 'memphis'
  document.querySelectorAll('.theme-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === (theme || 'memphis'))
  })
}
function setTheme(theme) {
  applyTheme(theme, true)
  api.updateSettings({ theme })
}

// ---------------------------------------------------------------- 面板透明度
const elsOpacity = $('#opacityRange')
function applyOpacity(v) {
  const o = typeof v === 'number' ? Math.max(0.3, Math.min(1, v)) : 1
  document.body.style.opacity = String(o)
  if (elsOpacity) elsOpacity.value = String(o)
}
elsOpacity && elsOpacity.addEventListener('input', (e) => {
  const o = Number(e.target.value)
  applyOpacity(o)
  api.updateSettings({ opacity: o })
})

// ---------------------------------------------------------------- 折叠 / 展开
function showCollapsed() {
  els.app.classList.add('hidden')
  els.collapsedBar.classList.remove('hidden')
}
function showNormal() {
  els.app.classList.remove('hidden')
  els.collapsedBar.classList.add('hidden')
}
$('#btnCollapseBar').addEventListener('click', () => {
  api.collapse()
  showCollapsed()
})
$('#btnExpand').addEventListener('click', () => {
  api.expand()
  showNormal()
})
$('.cb-hint').addEventListener('click', () => {
  api.expand()
  showNormal()
})

// ---------------------------------------------------------------- render: clipboard
function renderClipboard() {
  const q = els.search.value.trim().toLowerCase()
  const now = Date.now()
  const items = S.history.filter((it) => {
    if (filterTag && !(it.tags || []).includes(filterTag)) return false   // 按标签筛选
    if (it.type === 'text') return !q || it.text.toLowerCase().includes(q)
    if (it.type === 'file-image') {
      return !q || it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q)
    }
    return !q
  }).sort((a, b) => (b.pinned - a.pinned) || (b.time - a.time))

  if (!items.length) {
    els.clipList.innerHTML = `<div class="empty"><span class="big">📋</span>${
      filterTag ? '该标签下暂无记录' : (q ? '没有匹配的记录' : '暂无剪贴记录<br>复制或剪切任意内容后会自动出现在这里')
    }</div>`
  } else {
    els.clipList.innerHTML = items.map((it) => {
      const t = fmtTime(it.time)
      const fresh = now - it.time < 20000   // 最近 20 秒内剪切的项高亮
      const pin = it.pinned ? '<span class="pin-badge">📌 已置顶</span>' : ''
      const tags = (it.tags || []).map((tag) => `<span class="tag-mini" style="background:${tagColor(tag)};color:#fff">${escapeHtml(tag)}</span>`).join('')
      const richBadge = it.formulaImage ? '<span class="rich-badge">公式图片</span>'
        : (it.formula ? '<span class="rich-badge formula">∑ 公式</span>'
          : (it.rich ? '<span class="rich-badge">富文本</span>' : ''))
      let body = ''
      if (it.type === 'text') {
        body = `<div class="item-text">${escapeHtml(it.text)}</div>`
        if (it.latex) body += `<div class="item-latex">${escapeHtml(it.latex)}</div>`
      } else if (it.type === 'image') {
        body = `<div class="item-name">${it.formulaImage ? '∑ 公式图片' : '剪贴板图片'}</div>` +
          (it.formulaImage ? '<div class="item-path">来源仅提供图片，无法转换为公式</div>' : '')
      } else {
        body = `<div class="item-name">🖼 ${escapeHtml(it.name)}</div><div class="item-path">${escapeHtml(it.path)}</div>`
      }
      const thumb = it.type === 'image'
        ? `<img class="item-thumb" draggable="false" src="dsp://res/images/${it.hash}.png">`
        : `<div class="item-icon">${it.type === 'text' ? '📝' : '🖼'}</div>`
      const drag = it.type === 'image' ? ' draggable="true"' : ''
      return `<div class="item${it.pinned ? ' pinned' : ''}${fresh ? ' fresh' : ''}" data-id="${it.id}" data-type="${it.type}"${drag}>
        ${thumb}
        <div class="item-body">${body}${(richBadge || tags) ? `<div class="item-tags">${richBadge}${tags}</div>` : ''}<div class="item-meta">${pin}<span>${t}</span></div></div>
        <div class="item-actions">
          <button class="mini-btn" data-act="tag" title="标注标签">🏷</button>
          <button class="mini-btn" data-act="copy" title="复制（富文本优先，粘到 Word 是可编辑公式）">⧉</button>
          ${it.latex ? '<button class="mini-btn" data-act="latex" title="复制 LaTeX 源码（对比测试用）">∑</button>' : ''}
          <button class="mini-btn${it.pinned ? ' pin-on' : ''}" data-act="pin" title="置顶/取消置顶">${it.pinned ? '★' : '☆'}</button>
          <button class="mini-btn del" data-act="del" title="删除">✕</button>
        </div>
      </div>`
    }).join('')
  }

  const pinned = S.history.filter((i) => i.pinned).length
  els.countClip.textContent = S.history.length
  els.clipStatus.textContent = filterTag
    ? `「${filterTag}」· ${items.length} 条`
    : `共 ${S.history.length} 条记录 · 置顶 ${pinned} 条`
}

// 依据标签名生成稳定颜色
function tagColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}

// ---------------------------------------------------------------- render: 标签栏
function renderTagBar() {
  const counts = {}
  for (const it of S.history) for (const tag of (it.tags || [])) counts[tag] = (counts[tag] || 0) + 1
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  if (!tags.length && !filterTag) { els.tagbar.innerHTML = ''; return }
  const chips = tags.map((tag) => `
    <span class="tagbar-chip${filterTag === tag ? ' active' : ''}" data-tag="${escapeHtml(tag)}"
      style="--tc:${tagColor(tag)}">
      <span class="tc-name">${escapeHtml(tag)}</span><span class="tc-count">${counts[tag]}</span>
      <button class="tc-x" data-del="${escapeHtml(tag)}" title="删除该标签">×</button>
    </span>`).join('')
  const all = `<span class="tagbar-chip all${!filterTag ? ' active' : ''}" data-tag="">全部</span>`
  const plus = `<span class="tagbar-chip add" id="tagAddBtn" title="给选中的条目加标签">＋</span>`
  els.tagbar.innerHTML = all + chips + plus
}

// ---------------------------------------------------------------- render: album
function renderAlbum() {
  const all = S.album || []
  const list = albumFilterTag ? all.filter((it) => (it.tags || []).includes(albumFilterTag)) : all
  els.countAlbum.textContent = list.length

  if (!list.length) {
    els.albumGrid.innerHTML = `<div class="empty"><span class="big">🖼</span>${
      albumFilterTag ? '该标签下暂无图片' : (S.album === null ? '正在扫描电脑中的图片…' : '相册为空<br>点击「＋ 文件夹」或把图片拖进面板即可添加')
    }</div>`
  } else {
    els.albumGrid.innerHTML = list.map((it) => `
      <div class="album-item" data-path="${escapeHtml(it.path)}" data-managed="${it.managed}">
        <img loading="lazy" src="${it.thumbUrl}">
        ${(it.tags || []).length ? `<div class="album-tags">${(it.tags || []).map((t) => `<span class="tag-mini" style="background:${tagColor(t)};color:#fff">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="ov">
          <button data-act="tag" title="标注标签">🏷</button>
          <button data-act="copy">⧉ 复制</button>
          <button data-act="open">打开</button>
          ${it.managed ? '<button class="del" data-act="del">删除</button>' : ''}
        </div>
      </div>`).join('')
  }

  els.albumStatus.textContent = list.length
    ? `共 ${list.length} 张图片 · 拖入图片文件或剪贴板图片即可加入相册`
    : '可把图片文件拖进面板，或把剪贴板图片拖到右侧相册'
}

// ---------------------------------------------------------------- render: 相册标签栏
function renderAlbumTagbar() {
  const counts = {}
  for (const it of (S.album || [])) for (const tag of (it.tags || [])) counts[tag] = (counts[tag] || 0) + 1
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  if (!tags.length && !albumFilterTag) { els.albumTagbar.innerHTML = ''; return }
  const chips = tags.map((tag) => `
    <span class="tagbar-chip${albumFilterTag === tag ? ' active' : ''}" data-tag="${escapeHtml(tag)}" style="--tc:${tagColor(tag)}">
      <span class="tc-name">${escapeHtml(tag)}</span><span class="tc-count">${counts[tag]}</span>
      <button class="tc-x" data-del="${escapeHtml(tag)}" title="删除该标签">×</button>
    </span>`).join('')
  const all = `<span class="tagbar-chip all${!albumFilterTag ? ' active' : ''}" data-tag="">全部</span>`
  els.albumTagbar.innerHTML = all + chips
}

function renderChips() {
  const folders = S.settings.albumFolders || []
  const chips = folders.map((f) => `
    <span class="chip"><b>${escapeHtml(f)}</b><button data-folder="${escapeHtml(f)}" title="移除">✕</button></span>`).join('')
  const builtin = `<span class="chip" title="拖入的图片会保存到这里"><b>📁 内置相册</b></span>`
  els.folderChips.innerHTML = builtin + chips
}

// ---------------------------------------------------------------- render all
function applyLocked(locked) {
  els.titlebar.classList.toggle('locked', !!locked)
  els.btnTop.classList.toggle('top-active', !!locked)
  els.btnTop.textContent = locked ? '🔒' : '🔓'
  els.btnTop.title = locked ? '已锁定位置（点击解除）' : '锁定位置（点击后不能移动）'
}
function renderAll() {
  renderClipboard()
  renderAlbum()
  renderChips()
  renderTagBar()
  renderAlbumTagbar()
  els.optTop.checked = !!S.settings.alwaysOnTop
  applyLocked(!!S.settings.locked)
  applyTheme(S.settings.theme)          // 保持当前风格选中态一致
  if (typeof S.settings.opacity === 'number') { document.body.style.opacity = String(Math.max(0.3, Math.min(1, S.settings.opacity))); elsOpacity && (elsOpacity.value = String(S.settings.opacity)) }
}

// ---------------------------------------------------------------- clipboard events
els.clipList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.mini-btn')
  if (!btn) return
  const itemEl = btn.closest('.item')
  const id = itemEl.dataset.id
  const act = btn.dataset.act
  if (act === 'tag') { openTagEditor('clip', id); return }
  try {
    if (act === 'copy') {
      await api.copyItem(id)
      const it = S.history.find((x) => x.id === id)
      if (it && it.latex) toast('已复制公式语法（Word 线性格式）：WPS 里粘贴后按 Ctrl+= 试转换')
      else if (it && (it.formula || it.rich)) toast('已复制富文本：粘到 Word 即为可编辑公式')
      else toast('已复制到剪贴板')
    }
    else if (act === 'word') {
      await api.copyWord(id)
      toast('已复制 Word 线性格式：粘贴后按 Ctrl+= 转换')
    }
    else if (act === 'latex') {
      await api.copyLatex(id)
      toast('已复制 LaTeX 源码：WPS 里粘贴后按 Ctrl+= 试试（用于对比）')
    }
    else if (act === 'pin') {
      const willPin = !itemEl.classList.contains('pinned')
      await api.setPin(id, willPin)
      toast(willPin ? '已置顶' : '已取消置顶')
    } else if (act === 'del') { await api.deleteItem(id); toast('已删除') }
  } catch (err) { showError(err) }
})

els.clipList.addEventListener('dragstart', (e) => {
  const itemEl = e.target.closest('.item')
  if (!itemEl || itemEl.dataset.type !== 'image') return
  e.dataTransfer.setData('text/clipboard-hash', itemEl.dataset.id)
  e.dataTransfer.effectAllowed = 'copy'
})

// ---------------------------------------------------------------- 标签：标签栏 + 编辑器
function allTagNames() {
  const s = new Set()
  for (const it of S.history) for (const t of (it.tags || [])) s.add(t)
  for (const it of (S.album || [])) for (const t of (it.tags || [])) s.add(t)
  return Array.from(s)
}

// 打开/关闭标签编辑器（type: 'clip' 条目 或 'album' 图片）
function openTagEditor(type, key) {
  let tags = []
  if (type === 'clip') {
    const item = S.history.find((i) => i.id === key)
    if (item) tags = item.tags || []
  } else if (type === 'album') {
    const item = (S.album || []).find((i) => i.path === key)
    if (item) tags = item.tags || []
  } else {
    return
  }
  tagEditType = type
  tagEditKey = key
  tagEditSet = tags.slice()
  renderTagEditor()
  els.tagEditor.classList.remove('hidden')
  els.tagInput.value = ''
  els.tagInput.focus()
}
function closeTagEditor() { els.tagEditor.classList.add('hidden'); tagEditType = null; tagEditKey = null }

function renderTagEditor() {
  const cur = tagEditSet
  const avail = allTagNames().filter((t) => !cur.includes(t))
  els.tagCurrent.innerHTML = cur.length
    ? cur.map((t) => `<span class="tag-mini cur" style="background:${tagColor(t)};color:#fff">${escapeHtml(t)}<b data-rm="${escapeHtml(t)}" title="移除">×</b></span>`).join('')
    : `<span class="tag-none">尚未添加标签</span>`
  els.tagSuggest.innerHTML = avail.length
    ? `<span class="tag-sug-hint">已有标签（点击添加）</span>` + avail.map((t) => `<span class="tag-sug" data-tag="${escapeHtml(t)}" style="border-color:${tagColor(t)};color:${tagColor(t)}">${escapeHtml(t)}</span>`).join('')
    : ''
}

function addTagToEdit(tag) {
  tag = String(tag || '').trim()
  if (!tag) return
  if (!tagEditSet.includes(tag)) tagEditSet.push(tag)
  renderTagEditor()
}

async function saveTagEdit() {
  if (tagEditType === 'clip' && tagEditKey) {
    await api.setTags(tagEditKey, tagEditSet); toast('已更新标签')
  } else if (tagEditType === 'album' && tagEditKey) {
    await api.setAlbumTags(tagEditKey, tagEditSet); toast('已更新标签')
  }
  closeTagEditor()
}

// 标签栏：筛选 / 删除标签 / 添加
els.tagbar.addEventListener('click', (e) => {
  const del = e.target.closest('.tc-x')
  if (del) {
    const tag = del.dataset.del
    api.deleteTag(tag).then(() => {
      if (filterTag === tag) filterTag = null
      toast('已删除标签「' + tag + '」')
    })
    e.stopPropagation()
    return
  }
  const add = e.target.closest('#tagAddBtn')
  if (add) { toast('请把鼠标移到某条记录上，点 🏷 即可标注'); return }
  const chip = e.target.closest('.tagbar-chip')
  if (!chip) return
  const v = chip.dataset.tag
  filterTag = v || null
  renderClipboard()
  renderTagBar()
})

// 标签编辑器事件
els.tagAdd.addEventListener('click', () => { addTagToEdit(els.tagInput.value); els.tagInput.value = ''; els.tagInput.focus() })
els.tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { addTagToEdit(els.tagInput.value); els.tagInput.value = ''; els.tagInput.focus() }
  else if (e.key === 'Escape') closeTagEditor()
})
els.tagCurrent.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]')
  if (rm) { tagEditSet = tagEditSet.filter((t) => t !== rm.dataset.rm); renderTagEditor() }
})
els.tagSuggest.addEventListener('click', (e) => {
  const sg = e.target.closest('.tag-sug')
  if (sg) addTagToEdit(sg.dataset.tag)
})
els.tagDone.addEventListener('click', saveTagEdit)

// ---------------------------------------------------------------- album events
els.albumGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  const itemEl = e.target.closest('.album-item')
  if (!itemEl) return
  const p = itemEl.dataset.path
  if (btn) {
    const act = btn.dataset.act
    if (act === 'tag') { openTagEditor('album', p); return }
    if (act === 'copy') { api.copyImage(p); toast('图片已复制到剪贴板') }
    else if (act === 'open') api.openImage(p)
    else if (act === 'del') { api.deleteAlbumImage(p); toast('已从相册删除') }
  } else {
    api.openImage(p)
  }
})

// 相册标签栏：筛选 / 删除
els.albumTagbar.addEventListener('click', (e) => {
  const del = e.target.closest('.tc-x')
  if (del) {
    const tag = del.dataset.del
    api.deleteAlbumTag(tag).then(() => {
      if (albumFilterTag === tag) albumFilterTag = null
      toast('已删除标签「' + tag + '」')
    })
    e.stopPropagation()
    return
  }
  const chip = e.target.closest('.tagbar-chip')
  if (!chip) return
  const v = chip.dataset.tag
  albumFilterTag = v || null
  renderAlbum()
  renderAlbumTagbar()
})

// 拖入相册高亮
els.paneAlbum.addEventListener('dragover', (e) => {
  if (hasDraggablePayload(e)) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    els.albumGrid.classList.add('drag-over')
    els.dropHint.classList.remove('hidden')
  }
})
els.paneAlbum.addEventListener('dragleave', () => {
  els.albumGrid.classList.remove('drag-over')
  els.dropHint.classList.add('hidden')
})
els.paneAlbum.addEventListener('drop', (e) => {
  e.stopPropagation()
  els.albumGrid.classList.remove('drag-over')
  els.dropHint.classList.add('hidden')
  handleDrop(e)
})

// 全窗口拖放：图片文件拖进面板即加入相册
document.addEventListener('dragover', (e) => { if (hasDraggablePayload(e)) e.preventDefault() })
document.addEventListener('drop', (e) => {
  if (hasDraggablePayload(e)) { e.preventDefault(); handleDrop(e) }
})

function hasDraggablePayload(e) {
  const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : []
  return types.includes('Files') || types.includes('text/clipboard-hash')
}

async function handleDrop(e) {
  const types = Array.from(e.dataTransfer.types || [])
  let msg = ''
  try {
    if (types.includes('text/clipboard-hash')) {
      const id = e.dataTransfer.getData('text/clipboard-hash')
      const item = S.history.find((i) => i.id === id)
      if (item && item.type === 'image') {
        await api.importClipboardImage(item.hash)
        msg = '剪贴板图片已加入相册'
      }
    }
    if (types.includes('Files') && e.dataTransfer.files.length) {
      const paths = []
      for (const f of e.dataTransfer.files) {
        try { const p = api.getPathForFile(f); if (p) paths.push(p) } catch {}
      }
      if (paths.length) {
        const n = await api.importFiles(paths)
        msg = msg || `已加入 ${n} 张图片到相册`
      }
    }
  } catch (err) { showError(err) }
  if (msg) toast(msg)
}

// ---------------------------------------------------------------- toolbar / window
$('#btnClear').addEventListener('click', async () => {
  try { await api.clearHistory(); toast('已清空未标记记录（置顶 / 标签项已保留）') } catch (err) { showError(err) }
})
$('#btnClearAll').addEventListener('click', async () => {
  if (!confirm('清空所有「未标记」的剪贴记录？\n\n置顶项和带标签的记录会保留，如需删除请单独删除。')) return
  try { await api.clearHistory(); els.popover.classList.add('hidden'); toast('已清空未标记记录（置顶 / 标签项已保留）') } catch (err) { showError(err) }
})
$('#btnAddFolder').addEventListener('click', async () => {
  try { await api.addAlbumFolder(); toast('已添加文件夹') } catch (err) { showError(err) }
})
$('#btnOpenAlbum').addEventListener('click', () => api.openAlbumFolder())
$('#btnMin').addEventListener('click', () => api.minimize())
$('#btnClose').addEventListener('click', () => api.closeWin())

// 贴边隐藏 / 唤出
$('#btnDock').addEventListener('click', async () => {
  try {
    const side = await api.dock()
    if (side) {
      document.body.classList.add('docked')
      document.body.classList.add('dock-' + side)
      $('#dockArrow').textContent = side === 'right' ? '‹' : '›'
    }
  } catch (err) { showError(err) }
})
$('#dockHandle').addEventListener('click', async () => {
  try {
    await api.undock()
    document.body.classList.remove('docked', 'dock-left', 'dock-right')
  } catch (err) { showError(err) }
})
$('#btnTop').addEventListener('click', async () => {
  try {
    const v = await api.toggleLock()
    applyLocked(v)
    toast(v ? '已锁定位置（面板不能移动）' : '已解除锁定（可自由拖动）')
  } catch (err) { showError(err) }
})
$('#btnGear').addEventListener('click', () => els.popover.classList.toggle('hidden'))
$('#optTop').addEventListener('change', (e) => api.updateSettings({ alwaysOnTop: e.target.checked }))

els.folderChips.addEventListener('click', async (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  try { await api.removeAlbumFolder(btn.dataset.folder); toast('已移除文件夹') } catch (err) { showError(err) }
})

document.querySelectorAll('.sizes button').forEach((b) => {
  b.addEventListener('click', () => {
    api.resize(Number(b.dataset.w), Number(b.dataset.h))
    els.popover.classList.add('hidden')
  })
})

// 面板风格切换
document.querySelectorAll('.theme-btn').forEach((b) => {
  b.addEventListener('click', () => {
    setTheme(b.dataset.theme)
    toast('已切换为「' + b.textContent.trim() + '」风格')
  })
})

// 点击弹层外部关闭
document.addEventListener('click', (e) => {
  if (!els.popover.classList.contains('hidden') &&
      !e.target.closest('#popover') && !e.target.closest('#btnGear')) {
    els.popover.classList.add('hidden')
  }
  // 点击标签编辑器外部关闭（但先判断是否点在编辑器内部）
  if (!els.tagEditor.classList.contains('hidden') &&
      !e.target.closest('#tagEditor')) {
    if (e.target.closest('[data-act="tag"]')) return // 正在从条目打开编辑器
    saveTagEdit()
  }
})

// 搜索防抖
let searchTimer = null
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(renderClipboard, 120)
})

// ---------------------------------------------------------------- init
;(async function init() {
  if (!window.api) {
    showError('无法连接主进程（preload 未加载）')
    return
  }
  try {
    // 先订阅再取快照，避免错过扫描完成后的推送
    api.onState((s) => { S = s; renderAll() })
    S = await api.getState()
    console.log('renderer init ok, history=' + (S.history || []).length + ', album=' + ((S.album || []).length) + ', api=' + (typeof window.api))
    splitRatio = (typeof S.settings.splitRatio === 'number') ? S.settings.splitRatio : 0.5
    pos = ['row', 'row-rev', 'col', 'col-rev'].includes(S.settings.pos) ? S.settings.pos : 'row'
    applyLayout()
    els.paneClip.classList.toggle('closed', !!S.settings.clipMinimized)
    els.paneAlbum.classList.toggle('closed', !!S.settings.albumMinimized)
    updateCornerHints()
    applyTheme(S.settings.theme)          // 应用上次保存的风格
    applyOpacity(S.settings.opacity)      // 应用上次保存的透明度
    renderAll()
    if (S.settings.collapsed) showCollapsed(); else showNormal()
  } catch (err) {
    showError(err && err.message || err)
  }
})()
})()
