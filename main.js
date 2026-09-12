'use strict'

const fs0 = require('fs')
try { fs0.appendFileSync(path.join(__dirname, 'debug.log'), `[${new Date().toISOString()}] TOP\n`) } catch {}

const {
  app, BrowserWindow, clipboard, nativeImage, ipcMain, dialog,
  shell, protocol, screen, net, ClipboardItem
} = require('electron')
try { fs0.appendFileSync(path.join(__dirname, 'debug.log'), `[${new Date().toISOString()}] REQUIRES OK\n`) } catch {}
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const crypto = require('crypto')
const os = require('os')
const { execFile } = require('child_process')
const { pathToFileURL } = require('url')
const { toLatex, toUnicodeMath, extractMathml } = require('./latex')

const APP_NAME = 'clipboard-panel'
// 数据目录：可用环境变量覆盖（便携模式 / 测试用）；默认存用户目录 AppData。
// 必须在 app ready 之前 setPath，让 Chromium 配置文件也使用同一目录，
// 避免 app 名称对应的默认 userData 被占用/锁定导致启动卡死。
if (process.env.CLIP_PANEL_DATA_DIR) {
  app.setPath('userData', process.env.CLIP_PANEL_DATA_DIR)
}
const dataDir = app.getPath('userData')
const imagesDir = path.join(dataDir, 'images')
const thumbsDir = path.join(dataDir, 'thumbs')
const albumDir = path.join(dataDir, 'album')
const historyFile = path.join(dataDir, 'clipboard.json')
const settingsFile = path.join(dataDir, 'settings.json')
const albumTagsFile = path.join(dataDir, 'album-tags.json')

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.avif']
const MAX_HISTORY = 600
const MAX_ALBUM = 1200
const SCAN_DEPTH = 3
const POLL_MS = 800

const wantDemo = process.argv.includes('--demo')
const wantScreenshot = process.argv.includes('--screenshot')

// 调试日志：写入项目目录 debug.log（GUI 程序控制台不可见，写文件最可靠）
const debugLog = path.join(__dirname, 'debug.log')
function log(msg) {
  try { fs.appendFileSync(debugLog, `[${new Date().toISOString()}] ${msg}\n`) } catch {}
}
process.on('uncaughtException', (e) => { log('uncaughtException: ' + (e && e.stack || e)) })
process.on('unhandledRejection', (e) => { log('unhandledRejection: ' + (e && e.stack || e)) })

// ---------------------------------------------------------------- utils
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }) }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function saveJson(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8') } catch (e) { console.error('save failed', file, e) }
}
const isImgExt = (p) => IMG_EXTS.includes(path.extname(p).toLowerCase())
const isManaged = (p) => p.toLowerCase().startsWith(albumDir.toLowerCase() + path.sep)

// ---------------------------------------------------------------- state
function defaultSettings() {
  return {
    bounds: null,
    alwaysOnTop: true,          // 默认置顶，面板始终在桌面最上层不被覆盖
    albumFolders: [app.getPath('pictures')].filter(Boolean),
    tab: 'clipboard',
    splitRatio: 0.5,
    pos: 'row',                // 两个框的布局方向：row|row-rev|col|col-rev
    collapsed: false,
    collapsedSize: null,
    locked: false,
    theme: 'memphis',
    opacity: 1,
    clipMinimized: false,
    albumMinimized: false
  }
}
let settings = Object.assign(defaultSettings(), loadJson(settingsFile, {}))
if (!Array.isArray(settings.albumFolders)) settings.albumFolders = defaultSettings().albumFolders
let history = loadJson(historyFile, [])
if (!Array.isArray(history)) history = []
for (const it of history) if (!Array.isArray(it.tags)) it.tags = []
// 相册图片标签：path -> [tag,...]
let albumTags = loadJson(albumTagsFile, {})
if (!albumTags || typeof albumTags !== 'object' || Array.isArray(albumTags)) albumTags = {}
function saveAlbumTags() { saveJson(albumTagsFile, albumTags) }

let win = null
let albumCache = null          // last built album payload
let albumScanning = false

// ---------------------------------------------------------------- persistence helpers
function saveSettings() { saveJson(settingsFile, settings) }
function saveHistory() { saveJson(historyFile, history) }

function trimHistory() {
  if (history.length <= MAX_HISTORY) return
  const removed = history.splice(MAX_HISTORY)
  // delete orphan image files
  const used = new Set(history.filter(i => i.type === 'image').map(i => i.hash))
  for (const item of removed) {
    if (item.type === 'image' && !used.has(item.hash)) {
      try { fs.unlinkSync(path.join(imagesDir, item.hash + '.png')) } catch {}
    }
  }
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', buildState())
}

function buildState() {
  return {
    history,
    settings: Object.assign({}, settings, {
      albumFolders: settings.albumFolders.filter(f => f && fs.existsSync(f))
    }),
    album: albumCache,
    picsDefault: app.getPath('pictures'),
    albumDir
  }
}

// ---------------------------------------------------------------- history
function addItem(item) {
  if (!Array.isArray(item.tags)) item.tags = []
  history.unshift(item)
  trimHistory()
  saveHistory()
  pushState()
}

function maybeAddText(text) {
  if (history.length && history[0].type === 'text' && history[0].text === text) return
  addItem({ id: uid(), type: 'text', text, pinned: false, time: Date.now() })
}

function maybeAddImage(hash, png, meta) {
  if (history.length && history[0].type === 'image' && history[0].hash === hash) return
  ensureDir(imagesDir)
  const file = path.join(imagesDir, hash + '.png')
  if (!fs.existsSync(file)) fs.writeFileSync(file, png)
  addItem(Object.assign({ id: uid(), type: 'image', hash, pinned: false, time: Date.now() }, meta || {}))
}

// 提取"公式图片"：WPS 等把公式当图片放进剪贴板（RTF 内嵌 PNG，或 HTML 引用本地图片文件）
function extractFormulaImagePng(html, rtf) {
  try {
    const s = String(rtf || '')
    const idx = s.indexOf('\\pngblip')
    if (idx >= 0) {
      const seg = s.slice(idx, idx + 6 * 1024 * 1024)
      const m = /([0-9a-fA-F]{400,})/.exec(seg)
      if (m) {
        const buf = Buffer.from(m[1], 'hex')
        if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return buf
      }
    }
  } catch {}
  try {
    const m = /<img[^>]+src=["']file:\/\/([^"']+)["']/i.exec(String(html || ''))
    if (m) {
      let p = m[1]
      try { p = decodeURIComponent(p) } catch {}
      p = p.replace(/^\/+/, '')
      if (/^[a-zA-Z]:/.test(p)) {
        const f = p.replace(/\//g, '\\')
        if (fs.existsSync(f)) return fs.readFileSync(f)
      }
    }
  } catch {}
  return null
}

function maybeAddFileImage(filePath) {
  const last = history[0]
  if (last && last.type === 'file-image' && last.path === filePath) return
  addItem({ id: uid(), type: 'file-image', path: filePath, name: path.basename(filePath), pinned: false, time: Date.now() })
}

// ---------------------------------------------------------------- clipboard watcher
// 注意：Electron 44 的 clipboard 是全新的异步 W3C API（readText/writeText/read/write/has 均返回 Promise，
// 没有 readImage/availableFormats/readBuffer）。这里全部用新 API 实现。
// 为了让 Word 公式等富文本粘贴不失真，除了纯文本，还保存 HTML / RTF / MathML 格式，
// 复制回剪贴板时按多格式写回，Word/WPS 会优先使用 HTML（其中含公式的 MathML/OMML）。
let lastText = ''
let lastHtmlHash = ''
let lastImgHash = null
let polling = false
let pausePoll = false      // 我们自己写剪贴板时暂停轮询，避免自己跟自己抢剪贴板

const MAX_RICH = 400 * 1024   // 富文本单条上限，避免历史文件过大
const MAX_RTF = 900 * 1024    // RTF 上限（超限则丢弃，避免写入无效 RTF）

// ---- 原生剪贴板（RTF 等 Chromium 读不到的格式，靠系统 PowerShell + .NET 读写）----
const PS_EXE = 'powershell.exe'
const PS_READ = path.join(__dirname, 'scripts', 'clip-read.ps1')
const PS_WRITE = path.join(__dirname, 'scripts', 'clip-write.ps1')

function runPowerShell(args, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      execFile(PS_EXE, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ...args],
        { timeout, windowsHide: true },
        (err, stdout, stderr) => resolve({ err, stderr: String(stderr || '') }))
    } catch (e) { resolve({ err: e, stderr: String(e && e.message || e) }) }
  })
}

// 读取系统剪贴板原生格式（RTF / HTML / 纯文本）
async function readClipboardNative() {
  const outFile = path.join(os.tmpdir(), 'clip-panel-read-' + process.pid + '-' + Date.now() + '.json')
  const r = await runPowerShell([PS_READ, '-OutFile', outFile])
  if (r.err) { log('native read ps err: ' + (r.stderr || r.err.message)) }
  try {
    const txt = fs.readFileSync(outFile, 'utf8')
    try { fs.unlinkSync(outFile) } catch {}
    const obj = JSON.parse(txt)
    return obj && obj.ok ? obj : null
  } catch { return null }
}

// 把原生格式写回系统剪贴板（Word 会优先采用 RTF → 得到"可编辑公式"）
async function writeClipboardNative(payload) {
  const inFile = path.join(os.tmpdir(), 'clip-panel-write-' + process.pid + '-' + Date.now() + '.json')
  try { fs.writeFileSync(inFile, JSON.stringify(payload), 'utf8') } catch { return false }
  const r = await runPowerShell([PS_WRITE, '-InFile', inFile])
  try { fs.unlinkSync(inFile) } catch {}
  if (r.err) { log('native write ps err: ' + (r.stderr || r.err.message)); return false }
  return true
}

// 把一张 PNG 字节写入系统剪贴板（Electron 44 用 ClipboardItem）
async function writeImageToClipboard(pngBuffer) {
  const blob = new Blob([pngBuffer], { type: 'image/png' })
  const item = new ClipboardItem({ 'image/png': blob })
  await clipboard.write([item])
}

// 用 Chromium 的 MathML 渲染引擎把公式渲染成高清 PNG（WPS 粘贴图片一定准确、不会变形或缩小）
async function renderMathmlPng(mathml) {
  if (!mathml || !/<\s*math/i.test(mathml)) return null
  let w = null
  try {
    w = new BrowserWindow({
      width: 900, height: 300, show: false, frame: false,
      backgroundColor: '#ffffff',
      webPreferences: { offscreen: false, contextIsolation: true }
    })
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:18px;background:#ffffff}' +
      'math{font-size:56px;color:#000000}' +
      '</style></head><body>' + mathml + '</body></html>'
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise(r => setTimeout(r, 700))
    // 按内容尺寸裁剪
    try {
      const d = await w.webContents.executeJavaScript('({w: document.body.scrollWidth, h: document.body.scrollHeight})')
      if (d && d.w > 0 && d.h > 0) {
        w.setContentSize(Math.min(2400, Math.max(80, Math.ceil(d.w))), Math.min(900, Math.max(60, Math.ceil(d.h))))
        await new Promise(r => setTimeout(r, 300))
      }
    } catch {}
    const img = await w.webContents.capturePage()
    if (!img || img.isEmpty()) return null
    return img.toPNG()
  } catch (e) {
    log('render mathml err: ' + (e && e.message || e))
    return null
  } finally {
    try { if (w) w.destroy() } catch {}
  }
}

// 从剪贴板读出全部文本类格式（纯文本 / HTML / RTF / MathML）
async function readClipboardFormats() {
  const out = { plain: '', html: '', rtf: '', mathml: '' }
  try {
    const items = await clipboard.read()
    for (const item of items) {
      const types = (item && item.types) || []
      for (const ty of types) {
        const t = String(ty).toLowerCase()
        try {
          if (t === 'text/plain' && !out.plain) {
            out.plain = await (await item.getType(ty)).text()
          } else if (t === 'text/html' && !out.html) {
            out.html = await (await item.getType(ty)).text()
          } else if ((t === 'text/rtf' || t === 'application/rtf') && !out.rtf) {
            out.rtf = await (await item.getType(ty)).text()
          } else if ((t === 'text/mathml' || t === 'application/mathml+xml' || t === 'mathml') && !out.mathml) {
            out.mathml = await (await item.getType(ty)).text()
          }
        } catch {}
      }
    }
  } catch {}
  return out
}

// 从剪贴板读出一张图片的 PNG 字节（若有）；遍历所有 item 的 MIME 类型找 image/*
async function readClipboardImagePng() {
  try {
    const items = await clipboard.read()
    for (const item of items) {
      const types = (item && item.types) || []
      for (const ty of types) {
        if (/^image\//.test(ty)) {
          try {
            const blob = await item.getType(ty)
            if (blob && blob.size) return Buffer.from(await blob.arrayBuffer())
          } catch {}
        }
      }
    }
  } catch {}
  return null
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// 把富文本（可能含公式）写回剪贴板：同时写入多种格式，确保 Word 等能还原成公式
async function writeRichToClipboard(entry) {
  const plain = entry.text || (entry.html ? stripHtml(entry.html) : '')
  let html = entry.html || ''
  // 只有 MathML 时，包装成 HTML，便于 Word 识别为公式
  if (!html && entry.mathml) {
    html = '<html><head><meta charset="utf-8"></head><body>' + entry.mathml + '</body></html>'
  }
  const data = {}
  if (plain) data['text/plain'] = new Blob([plain], { type: 'text/plain' })
  if (html) data['text/html'] = new Blob([html], { type: 'text/html' })
  if (entry.rtf) data['text/rtf'] = new Blob([entry.rtf], { type: 'text/rtf' })
  if (entry.mathml) data['text/mathml'] = new Blob([entry.mathml], { type: 'text/mathml' })
  if (!Object.keys(data).length) return false
  await clipboard.write([new ClipboardItem(data)])
  return true
}

// 记录一条文本/富文本剪贴项（含公式信息）
function maybeAddRich(fmt) {
  const plain = fmt.plain || ''
  const html = (fmt.html || '').slice(0, MAX_RICH)
  const rtfRaw = fmt.rtf || ''
  const rtf = (rtfRaw && rtfRaw.length <= MAX_RTF) ? rtfRaw : ''
  const mathml = (fmt.mathml || '').slice(0, MAX_RICH)
  // 纯文本用 HTML 兜底（例如只提供 html 的复制源）
  const text = plain || (html ? stripHtml(html) : '')
  if (!text && !html && !mathml) return
  if (history.length && history[0].type === 'text' && history[0].text === text && (history[0].html || '') === html) return
  // 尝试把公式转成 LaTeX：便于在 Word 公式编辑器里粘贴编译
  let latex = ''
  try { latex = toLatex({ html, rtf, mathml, plain: text }) } catch (e) { log('latex conv err: ' + (e && e.message || e)) }
  const hasFormula = !!latex || /<math[\s>]/i.test(html) || /<m:oMath[\s>]/i.test(html) || !!mathml
  // 诊断：没有转出 LaTeX 时，记录剪贴板原始内容片段，便于定位公式的表示方式
  if (!latex) {
    if (rtf.length > 300 || html.length > 150) {
      log('FORMULA-DIAG html[' + html.length + ']=' + html.slice(0, 500).replace(/\s+/g, ' '))
      // RTF 中定位公式相关的关键标记及其上下文（比无脑取开头更有用）
      const keys = ['oMath', 'moMath', '\\pict', 'wmetafile', 'emfblip', 'pngblip', 'jpegblip',
        '\\object', '\\fldinst', 'EQ ', 'mml', '\\mmath', 'ole']
      const parts = []
      for (const k of keys) {
        const i = rtf.indexOf(k)
        if (i >= 0) parts.push('[' + k + '@' + i + '] ' + rtf.slice(Math.max(0, i - 40), i + 260).replace(/\s+/g, ' '))
      }
      log('FORMULA-DIAG rtfHints=' + (parts.join(' ||| ') || '(none)'))
      log('FORMULA-DIAG rtfTail=' + rtf.slice(-700).replace(/\s+/g, ' '))
      log('FORMULA-DIAG plain=' + text.slice(0, 200).replace(/\s+/g, ' '))
    }
  } else {
    log('FORMULA-OK latex=' + latex.slice(0, 200))
  }
  addItem({
    id: uid(), type: 'text', text,
    html: html || undefined,
    rtf: rtf || undefined,
    mathml: mathml || undefined,
    latex: latex || undefined,
    rich: !!(html || rtf || mathml),
    formula: hasFormula,
    pinned: false, time: Date.now()
  })
  return !!latex
}

async function pollClipboard() {
  if (polling || pausePoll) return
  polling = true
  try {
    // ---- 文本 / 富文本检测（独立，永不因其它错误失败） ----
    try {
      const fmt = await readClipboardFormats()
      const htmlHash = fmt.html ? sha256(Buffer.from(fmt.html, 'utf8')).slice(0, 12) : ''
      if ((fmt.plain || fmt.html) && (fmt.plain !== lastText || htmlHash !== lastHtmlHash)) {
        lastText = fmt.plain
        lastHtmlHash = htmlHash
        // 再抓一次系统原生格式：RTF（Word 公式的"可编辑"载体，Chromium 读不到）
        let nat = null
        try { nat = await readClipboardNative() } catch {}
        const rtfRaw = (nat && nat.rtf) ? nat.rtf : ''
        const rtf = (rtfRaw && rtfRaw.length <= MAX_RTF) ? rtfRaw : ''
        const html = (fmt.html || (nat && nat.html) || '').slice(0, MAX_RICH)
        const plain = fmt.plain || (nat && nat.text) || ''
        log('clip: TEXT len=' + plain.length + ' html=' + html.length + (rtf ? ' rtf=' + rtf.length : '') +
            ((/<math[\s>]/i.test(html) || fmt.mathml) ? ' [含公式]' : '') +
            ' :: ' + plain.slice(0, 30))
        const latexOk = maybeAddRich({ plain, html, rtf, mathml: fmt.mathml })
        // 公式结构转不出 LaTeX 时（如 WPS 只给图片），把公式图片保存下来，至少可查看/留档
        if (!latexOk) {
          const png = extractFormulaImagePng(html, rtf)
          if (png) {
            log('formula image extracted: ' + png.length + ' bytes')
            maybeAddImage(sha256(png), png, { name: '公式图片', formulaImage: true })
          }
        }
      }
    } catch (e) { log('clip text err: ' + (e && e.message || e)) }

    // ---- 图片检测（独立） ----
    try {
      const png = await readClipboardImagePng()
      if (png && png.length) {
        const hash = sha256(png)
        if (hash !== lastImgHash) {
          lastImgHash = hash
          log('clip: IMAGE hash=' + hash.slice(0, 10) + ' bytes=' + png.length)
          maybeAddImage(hash, png)
        }
      } else {
        lastImgHash = null
      }
    } catch (e) { log('clip img err: ' + (e && e.message || e)) }
  } finally {
    polling = false
  }
}

// ---------------------------------------------------------------- album
function walk(dir, depth, out, seen) {
  return fsp.readdir(dir, { withFileTypes: true }).then(async (entries) => {
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= MAX_ALBUM) return
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < SCAN_DEPTH) await walk(full, depth + 1, out, seen)
      } else if (e.isFile() && isImgExt(full)) {
        const key = full.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        try {
          const st = await fsp.stat(full)
          out.push({ path: full, name: e.name, mtime: st.mtimeMs, size: st.size })
        } catch {}
      }
    }
  }, () => {})
}

async function ensureThumb(item) {
  const key = `${Math.round(item.mtime)}-${item.size}-${item.name}`
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)
  const thumbFile = path.join(thumbsDir, hash + '.jpg')
  if (fs.existsSync(thumbFile)) return `dsp://res/thumbs/${hash}.jpg`
  try {
    const th = await nativeImage.createThumbnailFromPath(item.path, { width: 320, height: 240 })
    if (th && !th.isEmpty()) {
      ensureDir(thumbsDir)
      fs.writeFileSync(thumbFile, th.toJPEG(82))
      return `dsp://res/thumbs/${hash}.jpg`
    }
  } catch {}
  return `dsp://ext?p=${Buffer.from(item.path).toString('base64url')}`
}

async function scanAlbum() {
  if (albumScanning) return albumCache
  albumScanning = true
  try {
    const folders = Array.from(new Set([...settings.albumFolders.filter(Boolean), albumDir]))
    const list = []
    const seen = new Set()
    for (const folder of folders) {
      if (!fs.existsSync(folder)) continue
      await walk(folder, 0, list, seen)
      if (list.length >= MAX_ALBUM) break
    }
    list.sort((a, b) => b.mtime - a.mtime)
    const payload = []
    let idx = 0
    const workers = Array.from({ length: 4 }, async () => {
      while (idx < list.length) {
        const item = list[idx++]
        try {
          const thumbUrl = await ensureThumb(item)
          payload.push({
            id: item.path,
            path: item.path,
            name: item.name,
            thumbUrl,
            managed: isManaged(item.path),
            tags: (albumTags[item.path] || [])
          })
        } catch {}
      }
    })
    await Promise.all(workers)
    albumCache = payload
  } finally {
    albumScanning = false
  }
  pushState()
  return albumCache
}

// ---------------------------------------------------------------- window
function restoreBounds() {
  const b = settings.bounds
  if (!b || typeof b.width !== 'number') return null
  const visible = screen.getAllDisplays().some(d => {
    const wa = d.workArea
    return b.x < wa.x + wa.width && b.x + b.width > wa.x &&
           b.y < wa.y + wa.height && b.y + b.height > wa.y
  })
  if (!visible) return null
  const minH = settings.collapsed ? 36 : 360
  return {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(420, Math.round(b.width)),
    height: Math.max(minH, Math.round(b.height))
  }
}

let boundsTimer = null
function scheduleSaveBounds() {
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return
    settings.bounds = win.getBounds()
    saveSettings()
  }, 600)
}

function createWindow() {
  const bounds = restoreBounds() || { width: 960, height: 620 }
  win = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: settings.collapsed ? 36 : 360,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !!settings.alwaysOnTop,
    transparent: true,                      // 透明窗口，营造悬浮气泡感
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  if (settings.locked) win.setMovable(false)   // 锁定位置：不可拖动移动

  win.loadFile('index.html')
  win.once('ready-to-show', () => { log('ready-to-show'); win.show() })
  win.on('move', scheduleSaveBounds)
  win.on('resize', scheduleSaveBounds)
  win.on('close', () => { saveSettings() })

  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load ' + code + ' ' + desc))
  win.webContents.on('preload-error', (_e, p, err) => log('preload-error ' + p + ' ' + err))
  win.webContents.on('render-process-gone', (_e, details) => log('render-process-gone ' + JSON.stringify(details)))
  win.webContents.on('console-message', (...args) => {
    try { log('console: ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' | ').slice(0, 400)) } catch {}
  })
  win.webContents.once('did-finish-load', async () => {
    log('did-finish-load')
    if (settings.collapsed) applyCollapsed(true)
    scanAlbum().then(() => log('scanAlbum done')).catch((e) => log('scanAlbum err ' + e))
    // 主动同步一次完整状态，确保渲染层拿到当前剪贴历史（避免时序丢失）
    try { win.webContents.send('state', buildState()) } catch (e) { log('state sync err: ' + e) }
    if (wantDemo) startDemo()
    if (wantScreenshot) scheduleScreenshot()
    diagnoseRenderer()
    // preload 成功后会发送 'preload-ok'，2 秒内没收到则认为 preload 失败
    if (!preloadOk) {
      setTimeout(() => {
        if (!preloadOk) log('DIAG: preload did not report OK within 2s — window.api may be missing')
      }, 2000)
    }
  })
}

let preloadOk = false

// 主动探测渲染层的 window.api 是否存在（判断 preload 是否注入成功）
function diagnoseRenderer() {
  setTimeout(async () => {
    try {
      const r = await win.webContents.executeJavaScript(
        'typeof window.api + " | apiKeys=" + (window.api ? Object.keys(window.api).join(",") : "NONE")',
        true
      )
      log('DIAG: ' + String(r).slice(0, 200))
    } catch (e) {
      log('DIAG failed: ' + (e && e.message || e))
    }
  }, 2500)
}

// ---------------------------------------------------------------- collapse / expand
let collapsed = false
let normalSize = null
let docked = false
let dockSavedBounds = null

function applyCollapsed(c) {
  if (!win) return
  if (c && !collapsed) {
    const [w, h] = win.getSize()
    normalSize = { w, h }
    settings.collapsedSize = { w, h }
    collapsed = true
    win.setMinimumSize(200, 36)
    win.setSize(w, 36)
  } else if (!c && collapsed) {
    collapsed = false
    win.setMinimumSize(420, 360)
    const size = normalSize || settings.collapsedSize || { w: 960, h: 620 }
    win.setSize(size.w, size.h)
  }
  settings.collapsed = collapsed
  saveSettings()
}

function scheduleScreenshot() {
  setTimeout(async () => {
    log('screenshot capture start')
    try {
      const img1 = await win.webContents.capturePage()
      fs.writeFileSync(path.join(__dirname, 'shot-clipboard.png'), img1.toPNG())
      log('shot-clipboard saved')
      await win.webContents.executeJavaScript('window.__switchTab && window.__switchTab("album")')
      await new Promise(r => setTimeout(r, 1600))
      const img2 = await win.webContents.capturePage()
      fs.writeFileSync(path.join(__dirname, 'shot-album.png'), img2.toPNG())
      log('shot-album saved')
    } catch (e) { console.error('screenshot failed', e); log('screenshot failed ' + e) }
    app.exit(0)
  }, 6000)
}

// ---------------------------------------------------------------- demo
function makeDemoPng(width, height, colorFn) {
  const buf = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const c = colorFn(x / width, y / height)
      buf[i] = Math.round(c[2])      // B
      buf[i + 1] = Math.round(c[1])  // G
      buf[i + 2] = Math.round(c[0])  // R
      buf[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(buf, { width, height }).toPNG()
}

async function ensureDemoImages() {
  ensureDir(albumDir)
  const defs = [
    ['demo-sunset.png', (u, v) => [255 * (0.4 + 0.6 * u), 90 + 120 * v, 60 + 60 * (1 - u)]],
    ['demo-ocean.png', (u, v) => [40 + 60 * v, 90 + 120 * v, 200 + 50 * u]],
    ['demo-forest.png', (u, v) => [30 + 40 * v, 130 + 100 * v, 60 + 30 * u]],
    ['demo-purple.png', (u, v) => [140 + 80 * v, 60 + 60 * u, 220 + 30 * v]]
  ]
  const files = []
  for (const [name, fn] of defs) {
    const p = path.join(albumDir, name)
    if (!fs.existsSync(p)) fs.writeFileSync(p, makeDemoPng(320, 200, fn))
    files.push(p)
  }
  return files
}

function startDemo() {
  ensureDemoImages().then(() => {
    const texts = [
      '你好，这是一条剪贴板历史示例文本 ✂️',
      'https://example.com 的链接示例',
      'const answer = 42; // 代码片段示例'
    ]
    let i = 0
    const timer = setInterval(async () => {
      try {
        if (i < texts.length) {
          await clipboard.writeText(texts[i]); i++
        } else if (i === texts.length) {
          const first = path.join(albumDir, 'demo-sunset.png')
          await writeImageToClipboard(fs.readFileSync(first)); i++
        } else {
          clearInterval(timer)
        }
      } catch (e) { clearInterval(timer) }
    }, 1000)
  })
}

// ---------------------------------------------------------------- protocols
protocol.registerSchemesAsPrivileged([
  { scheme: 'dsp', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } }
])

function registerProtocols() {
  protocol.handle('dsp', (req) => {
    try {
      const u = new URL(req.url)
      if (u.host === 'res') {
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
        const abs = path.resolve(dataDir, rel)
        if (abs !== dataDir && !abs.startsWith(dataDir + path.sep)) {
          return new Response('forbidden', { status: 403 })
        }
        if (!fs.existsSync(abs)) return new Response('not found', { status: 404 })
        return net.fetch(pathToFileURL(abs).toString())
      }
      if (u.host === 'ext') {
        const p = decodeURIComponent(u.searchParams.get('p') || '')
        const abs = path.resolve(p)
        if (!isImgExt(abs) || !fs.existsSync(abs)) return new Response('not found', { status: 404 })
        const inside = abs.startsWith(albumDir + path.sep) ||
          settings.albumFolders.some(f => f && abs.startsWith(path.resolve(f) + path.sep))
        if (!inside) return new Response('forbidden', { status: 403 })
        return net.fetch(pathToFileURL(abs).toString())
      }
      return new Response('not found', { status: 404 })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('state:get', () => buildState())

  ipcMain.handle('item:copy', async (_e, id) => {
    const item = history.find(i => i.id === id)
    if (!item) return false
    pausePoll = true
    try {
      if (item.type === 'text') {
        // 公式条目：只复制「纯文本公式语法」——WPS/Word 里粘贴后按 Ctrl+= / Alt+= 即可转成公式。
        // 实测：WPS 能识别 UnicodeMath 线性格式（∑_(n=1)^n、c_n=(a)/(b)…）；
        // 这里刻意不写富文本(RTF/HTML)，否则 WPS 会走富文本路径，导致无法转换、字号异常。
        if (item.latex) {
          const um = toUnicodeMath(item.latex)
          await clipboard.writeText(um || item.latex)
          return true
        }
        // 非公式的富文本：保持富文本（RTF/HTML）写回
        if (item.rtf || item.html) {
          const ok = await writeClipboardNative({ text: item.text || '', rtf: item.rtf || '', html: item.html || '' })
          if (ok) return true
          log('native write failed, fallback to clipboard API')
        }
        if (item.html || item.mathml) { await writeRichToClipboard(item); return true }
        await clipboard.writeText(item.text)
      } else if (item.type === 'image') {
        const f = path.join(imagesDir, item.hash + '.png')
        if (fs.existsSync(f)) await writeImageToClipboard(fs.readFileSync(f))
      } else if (item.type === 'file-image') {
        if (fs.existsSync(item.path)) await writeImageToClipboard(fs.readFileSync(item.path))
        else await clipboard.writeText(item.path)
      }
      return true
    } catch (e) { log('copy err: ' + (e && e.message || e)); return false }
    finally { setTimeout(() => { pausePoll = false }, 800) }
  })

  ipcMain.handle('item:copy-image', async (_e, id) => {
    const item = history.find(i => i.id === id)
    if (!item) return false
    try {
      let mathml = item.mathml || ''
      if (!mathml && item.html) mathml = extractMathml(item.html)
      if (!mathml) return false
      const png = await renderMathmlPng(mathml)
      if (!png) return false
      await writeImageToClipboard(png)
      return true
    } catch (e) { log('copy image err: ' + (e && e.message || e)); return false }
  })

  ipcMain.handle('item:copy-word', async (_e, id) => {
    const item = history.find(i => i.id === id)
    if (!item || !item.latex) return false
    pausePoll = true
    try { await clipboard.writeText(toUnicodeMath(item.latex)); return true }
    catch { return false }
    finally { setTimeout(() => { pausePoll = false }, 500) }
  })

  ipcMain.handle('item:copy-latex', async (_e, id) => {
    const item = history.find(i => i.id === id)
    if (!item || !item.latex) return false
    pausePoll = true
    try { await clipboard.writeText(item.latex); return true }
    catch { return false }
    finally { setTimeout(() => { pausePoll = false }, 500) }
  })
  ipcMain.handle('item:pin', (_e, payload) => {
    const item = history.find(i => i.id === payload.id)
    if (!item) return false
    item.pinned = !!payload.pinned
    item.time = Date.now()
    history.sort((a, b) => (b.pinned - a.pinned) || (b.time - a.time))
    saveHistory(); pushState()
    return true
  })

  ipcMain.handle('item:set-tags', (_e, payload) => {
    const item = history.find(i => i.id === payload.id)
    if (!item) return false
    const tags = Array.isArray(payload.tags) ? payload.tags : []
    item.tags = Array.from(new Set(tags.map(String).map(t => t.trim()).filter(Boolean))).slice(0, 12)
    saveHistory(); pushState()
    return true
  })

  ipcMain.handle('tag:delete', (_e, tag) => {
    if (!tag) return false
    let changed = false
    for (const it of history) {
      if (it.tags && it.tags.includes(tag)) { it.tags = it.tags.filter(t => t !== tag); changed = true }
    }
    if (changed) saveHistory()
    pushState()
    return true
  })

  // 相册图片标签
  ipcMain.handle('album:set-tags', async (_e, payload) => {
    const p = payload.path
    if (!p) return false
    const tags = Array.isArray(payload.tags) ? payload.tags : []
    albumTags[p] = Array.from(new Set(tags.map(String).map(t => t.trim()).filter(Boolean))).slice(0, 12)
    saveAlbumTags()
    scanAlbum()
    return true
  })
  ipcMain.handle('album:delete-tag', async (_e, tag) => {
    if (!tag) return false
    let changed = false
    for (const p of Object.keys(albumTags)) {
      if (albumTags[p].includes(tag)) { albumTags[p] = albumTags[p].filter(t => t !== tag); changed = true }
    }
    if (changed) saveAlbumTags()
    scanAlbum()
    return true
  })

  ipcMain.handle('item:delete', (_e, id) => {
    const idx = history.findIndex(i => i.id === id)
    if (idx < 0) return false
    const [item] = history.splice(idx, 1)
    if (item.type === 'image' && !history.some(i => i.type === 'image' && i.hash === item.hash)) {
      try { fs.unlinkSync(path.join(imagesDir, item.hash + '.png')) } catch {}
    }
    saveHistory(); pushState()
    return true
  })

  ipcMain.handle('item:clear', () => {
    // 置顶项、带标签项视为"特殊标记"，清空时一律保留（如需删除请单独删除）
    const isSpecial = (i) => !!i.pinned || (Array.isArray(i.tags) && i.tags.length > 0)
    const kept = history.filter(isSpecial)
    const used = new Set(kept.filter(i => i.type === 'image').map(i => i.hash))
    for (const item of history) {
      if (!isSpecial(item) && item.type === 'image' && !used.has(item.hash)) {
        try { fs.unlinkSync(path.join(imagesDir, item.hash + '.png')) } catch {}
      }
    }
    history = kept
    saveHistory(); pushState()
    return true
  })

  ipcMain.handle('album:add-folder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要加入相册的图片文件夹',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths.length) return settings.albumFolders
    const f = r.filePaths[0]
    if (!settings.albumFolders.includes(f)) settings.albumFolders.push(f)
    saveSettings()
    scanAlbum()
    return settings.albumFolders
  })

  ipcMain.handle('album:remove-folder', (_e, folder) => {
    settings.albumFolders = settings.albumFolders.filter(f => f !== folder)
    saveSettings()
    scanAlbum()
    return settings.albumFolders
  })

  ipcMain.handle('album:import-files', async (_e, paths) => {
    ensureDir(albumDir)
    let imported = 0
    for (const src of paths) {
      if (!src || !isImgExt(src) || !fs.existsSync(src)) continue
      let name = path.basename(src)
      let dest = path.join(albumDir, name)
      let n = 1
      while (fs.existsSync(dest)) {
        const ext = path.extname(name)
        dest = path.join(albumDir, `${path.basename(name, ext)}-${n++}${ext}`)
      }
      try { await fsp.copyFile(src, dest); imported++ } catch {}
    }
    scanAlbum()
    return imported
  })

  ipcMain.handle('album:import-clipboard-image', async (_e, hash) => {
    const src = path.join(imagesDir, hash + '.png')
    if (!fs.existsSync(src)) return false
    ensureDir(albumDir)
    const dest = path.join(albumDir, `剪贴板-${hash.slice(0, 8)}.png`)
    if (!fs.existsSync(dest)) await fsp.copyFile(src, dest)
    scanAlbum()
    return true
  })

  ipcMain.handle('album:copy', async (_e, p) => {
    if (!p || !fs.existsSync(p)) return false
    try { await writeImageToClipboard(fs.readFileSync(p)); return true } catch { return false }
  })

  ipcMain.handle('album:open', (_e, p) => { if (p) shell.openPath(p); return true })
  ipcMain.handle('album:delete', async (_e, p) => {
    if (!p || !isManaged(p)) return false
    try { await fsp.unlink(p); scanAlbum(); return true } catch { return false }
  })

  ipcMain.handle('album:open-folder', () => { shell.openPath(albumDir); return true })

  ipcMain.handle('settings:update', (_e, patch) => {
    Object.assign(settings, patch || {})
    if (typeof patch.alwaysOnTop === 'boolean' && win) {
      win.setAlwaysOnTop(patch.alwaysOnTop, 'floating')
    }
    saveSettings(); pushState()
    return true
  })

  ipcMain.handle('win:toggle-top', () => {
    settings.alwaysOnTop = !settings.alwaysOnTop
    if (win) win.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
    saveSettings(); pushState()
    return settings.alwaysOnTop
  })

  ipcMain.handle('win:toggle-lock', () => {
    settings.locked = !settings.locked
    if (win) win.setMovable(!settings.locked)   // 锁定位置：不可拖动
    saveSettings(); pushState()
    return settings.locked
  })

  ipcMain.handle('win:resize', (_e, w, h) => {
    if (!win) return false
    const [cw, ch] = win.getSize()
    const dx = Math.max(420, Math.round(w)) - cw
    const dy = Math.max(360, Math.round(h)) - ch
    const [x, y] = win.getPosition()
    win.setBounds({ x, y, width: cw + dx, height: ch + dy })
    return true
  })

  ipcMain.handle('win:collapse', () => { applyCollapsed(true); return true })
  ipcMain.handle('win:expand', () => { applyCollapsed(false); return true })
  ipcMain.handle('win:get-size', () => { if (!win) return null; return win.getSize() })

  // 贴边隐藏：固定藏到屏幕右侧，只露一条细边；点把手唤回
  ipcMain.handle('win:dock', () => {
    if (!win) return null
    const b = win.getBounds()
    dockSavedBounds = b
    const wa = screen.getDisplayMatching(b).workArea
    const HANDLE = 10
    win.setBounds({ x: wa.x + wa.width - HANDLE, y: Math.max(wa.y, b.y), width: b.width, height: b.height })
    docked = true
    return 'right'
  })
  ipcMain.handle('win:undock', () => {
    if (!win) return false
    if (dockSavedBounds) win.setBounds(dockSavedBounds)
    dockSavedBounds = null
    docked = false
    return true
  })

  ipcMain.on('renderer-error', (_e, msg) => log('renderer-error: ' + String(msg).slice(0, 500)))
  ipcMain.on('preload-ok', () => { preloadOk = true; log('preload OK (window.api injected)') })

  ipcMain.on('win:minimize', () => { if (win) win.minimize() })
  ipcMain.on('win:close', () => { if (win) win.close() })
}

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(() => {
  log('app ready')
  ensureDir(imagesDir)
  ensureDir(thumbsDir)
  ensureDir(albumDir)
  registerProtocols()
  registerIpc()
  if (wantDemo) settings.albumFolders = [] // 演示模式只扫描内置相册，保证测试确定性
  createWindow()
  setInterval(pollClipboard, POLL_MS)
  log('DIAG: clipboard watcher started (poll=' + POLL_MS + 'ms)')

  // 安全心跳：确认轮询未崩溃；每 20 次（约16秒）记录一次
  let beat = 0
  const hb = setInterval(() => {
    beat++
    if (beat % 20 === 0) log('DIAG: clip watcher alive, history=' + history.length)
  }, POLL_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => { app.quit() })
