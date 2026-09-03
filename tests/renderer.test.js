// 验证 renderer.js 的 IIFE 修复是否真正解决 "Identifier 'api' has already been declared"
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8')
const rjs = fs.readFileSync(path.resolve(__dirname, '..', 'renderer.js'), 'utf8')

function makeDom() {
  const dom = new JSDOM(html, { url: 'file:///E:/deepseek%20harness/clipboard-panel/index.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.api = {
    getState: () => Promise.resolve({ history: [{ id: '1', type: 'text', text: 'hi', time: Date.now(), pinned: false, tags: ['工作'] }], album: [{ id: 'p1', path: 'C:/a.png', name: 'a.png', thumbUrl: 'dsp://res/thumbs/x.jpg', managed: false, tags: ['旅行'] }], settings: { splitRatio: 0.5, collapsed: false, alwaysOnTop: true, albumFolders: [] }, albumDir: 'x' }),
    onState: () => {}, copyItem: () => Promise.resolve(true), setPin: () => Promise.resolve(true),
    deleteItem: () => Promise.resolve(true), clearHistory: () => Promise.resolve(true),
    setTags: () => Promise.resolve(true), deleteTag: () => Promise.resolve(true),
    setAlbumTags: () => Promise.resolve(true), deleteAlbumTag: () => Promise.resolve(true),
    addAlbumFolder: () => Promise.resolve([]), removeAlbumFolder: () => Promise.resolve([]),
    importFiles: () => Promise.resolve(0), importClipboardImage: () => Promise.resolve(true),
    copyImage: () => Promise.resolve(true), openImage: () => Promise.resolve(true),
    deleteAlbumImage: () => Promise.resolve(true), openAlbumFolder: () => Promise.resolve(true),
    updateSettings: () => Promise.resolve(true), toggleTop: () => Promise.resolve(true),
    toggleLock: () => Promise.resolve(true),
    resize: () => Promise.resolve(true), minimize: () => {}, closeWin: () => {},
    collapse: () => Promise.resolve(true), expand: () => Promise.resolve(true),
    getWinSize: () => Promise.resolve([960, 620]), reportError: (m) => { console.log('  [reported error] ' + m) },
    getPathForFile: () => 'C:/x.png'
  }
  return dom
}

function inject(dom, js) {
  try { dom.window.eval(js); return 'ok' } catch (e) { return 'THREW: ' + e.message }
}

// ---- 场景 A：脚本被执行两次（重复加载） ----
console.log('== 场景 A：renderer.js 被重复执行两次 ==')
{
  const dom = makeDom()
  const r1 = inject(dom, rjs)
  const r2 = inject(dom, rjs)
  console.log('  第一次执行:', r1)
  console.log('  第二次执行:', r2, '(预期 ok / 直接被防重标记拦截)')
  console.log('  防重标记:', dom.window.__clipboardPanelBooted === true)
  console.log('  剪贴板已渲染:', (dom.window.document.getElementById('clipList').innerHTML || '').includes('hi'))
}

// ---- 场景 B：全局已存在 api 词法声明 ----
console.log('== 场景 B：全局已有 const api 声明 ==')
{
  const dom = makeDom()
  // 模拟别处已在全局声明过 api（正是真实环境报 already declared 的情形）
  console.log('  先制造全局冲突:', inject(dom, 'const api = "GLOBAL";'))
  console.log('  再执行 renderer.js:', inject(dom, rjs), '(预期 ok = IIFE 局部化了 api)')
  console.log('  剪贴板已渲染:', (dom.window.document.getElementById('clipList').innerHTML || '').includes('hi'))
}

// ---- 场景 C：单次正常执行（回归） ----
console.log('== 场景 C：单次正常执行（回归） ==')
{
  const dom = makeDom()
  console.log('  执行:', inject(dom, rjs))
  setTimeout(() => {
    const clip = dom.window.document.getElementById('clipList').innerHTML || ''
    console.log('  剪贴板已渲染:', clip.includes('hi'))
    console.log('  剪贴板标签栏含"工作":', (dom.window.document.getElementById('tagbar').innerHTML || '').includes('工作'))
    console.log('  相册标签栏含"旅行":', (dom.window.document.getElementById('albumTagbar').innerHTML || '').includes('旅行'))
    console.log('  相册图片含标签条:', (dom.window.document.getElementById('albumGrid').innerHTML || '').includes('旅行'))
    console.log('  点击最小化按钮:', inject(dom, 'document.getElementById("btnMin").click()'), '(无报错即通过)')
  }, 200)
}
