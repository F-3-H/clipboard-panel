'use strict'

let contextBridge = null
let ipcRenderer = null
let webUtils = null
try {
  const electron = require('electron')
  contextBridge = electron.contextBridge
  ipcRenderer = electron.ipcRenderer
  webUtils = electron.webUtils
} catch (err) {
  // preload 加载失败时，主进程会通过 preload-error 事件写入 debug.log
  try { console.error('preload require failed: ' + (err && err.stack || err)) } catch {}
}

if (contextBridge && ipcRenderer) {
  contextBridge.exposeInMainWorld('api', {
    // state
    getState: () => ipcRenderer.invoke('state:get'),
    onState: (cb) => { ipcRenderer.on('state', (_e, s) => cb(s)) },

    // clipboard history
    copyItem: (id) => ipcRenderer.invoke('item:copy', id),
    setPin: (id, pinned) => ipcRenderer.invoke('item:pin', { id, pinned }),
    deleteItem: (id) => ipcRenderer.invoke('item:delete', id),
    clearHistory: () => ipcRenderer.invoke('item:clear'),
    setTags: (id, tags) => ipcRenderer.invoke('item:set-tags', { id, tags }),
    deleteTag: (tag) => ipcRenderer.invoke('tag:delete', tag),
    setAlbumTags: (path, tags) => ipcRenderer.invoke('album:set-tags', { path, tags }),
    deleteAlbumTag: (tag) => ipcRenderer.invoke('album:delete-tag', tag),

    // album
    addAlbumFolder: () => ipcRenderer.invoke('album:add-folder'),
    removeAlbumFolder: (folder) => ipcRenderer.invoke('album:remove-folder', folder),
    importFiles: (paths) => ipcRenderer.invoke('album:import-files', paths),
    importClipboardImage: (hash) => ipcRenderer.invoke('album:import-clipboard-image', hash),
    copyImage: (p) => ipcRenderer.invoke('album:copy', p),
    openImage: (p) => ipcRenderer.invoke('album:open', p),
    deleteAlbumImage: (p) => ipcRenderer.invoke('album:delete', p),
    openAlbumFolder: () => ipcRenderer.invoke('album:open-folder'),

    // settings / window
    updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
    toggleTop: () => ipcRenderer.invoke('win:toggle-top'),
    toggleLock: () => ipcRenderer.invoke('win:toggle-lock'),
    resize: (w, h) => ipcRenderer.invoke('win:resize', w, h),
    minimize: () => ipcRenderer.send('win:minimize'),
    closeWin: () => ipcRenderer.send('win:close'),
    collapse: () => ipcRenderer.invoke('win:collapse'),
    expand: () => ipcRenderer.invoke('win:expand'),
    getWinSize: () => ipcRenderer.invoke('win:get-size'),
    dock: () => ipcRenderer.invoke('win:dock'),
    undock: () => ipcRenderer.invoke('win:undock'),
    reportError: (msg) => ipcRenderer.send('renderer-error', msg),

    // file path from dropped File (Electron 32+ removed File.path)
    getPathForFile: (file) => (webUtils && webUtils.getPathForFile) ? webUtils.getPathForFile(file) : (file && file.path)
  })

  try { ipcRenderer.send('preload-ok') } catch {}
}
