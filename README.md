# 📋 剪贴面板 · Clipboard Panel

一个可高度定制的 **Windows 桌面剪贴板历史 + 电脑图片相册** 悬浮面板。常驻桌面上层，自动记录你的复制/剪切内容，支持标签分类、多套艺术风格、自定义透明度与自由拖拽布局。

![license](https://img.shields.io/badge/license-MIT-ff5b25)
![electron](https://img.shields.io/badge/Electron-44-3b6bff)
![platform](https://img.shields.io/badge/platform-Windows-22c3d6)

---

## ✨ 功能特性

### 📋 剪贴板历史
- 自动记录**复制 / 剪切**的文本与图片，最近 20 秒的新条目高亮
- 每条记录支持 **⧉ 复制回剪贴板 / ★ 置顶 / 🏷 标签 / ✕ 删除**，顶部搜索即时过滤
- 记录做成**聊天气泡造型**（圆角气泡 + 左下尾巴 + 右下时间戳，悬停浮现操作按钮）

### 🖼 电脑图片相册
- 默认扫描系统「图片」文件夹，可一键添加更多目录
- 缩略图墙 + 标签分类；悬停可 **🏷 标注 / ⧉ 复制 / 打开 / 删除**
- **拖入即加入相册**：把剪贴板历史里的图片直接拖到相册，或从资源管理器拖图片进面板

### 🏷 标签分类（剪贴板 + 相册）
- 给任意记录 / 图片标注多个标签，顶部标签栏按数量排列，点标签只看该分类
- 标签自动按名字分配颜色，可一键删除；数据随内容持久化

### 🪟 自由布局
- **两个框可拖拽互换位置、切换上下/左右结构**，拖动时实时看到框滑动、另一个框被挤走，松手自动填满
- **单框可关闭**（另一个框铺满面板），关闭后通过面板**四壁白色亮线**点击唤回
- 拖分隔条自由调整两框比例（方向符合直觉）；把框拖到很小会自动"挤掉"关闭
- **整个面板可隐藏到屏幕右侧边**（细把手），点击把手唤回

### 🎨 多种外观
- **5 种面板风格**：孟菲斯波普 / 日系可爱 / 纸质手账 / 复古报刊 / 气泡聊天，切换平滑过渡，自动记忆
- **自定义透明度**：滑杆微调整体半透明，透出桌面
- 窗口位置、大小、两区比例、置顶、折叠、风格、透明度全部自动记忆

---

## 🚀 安装与运行

> 需要 Windows 10 / 11。

```bash
# 1. 安装依赖（首次，自动使用国内镜像下载 Electron）
install.bat

# 2. 启动面板
启动剪贴面板.bat
```

也可以用命令行：

```bash
npm install      # 安装 electron + jsdom
npm start        # 启动
```

> **便携模式**：设置环境变量 `CLIP_PANEL_DATA_DIR` 可把数据目录改到任意位置。

---

## 🧱 技术栈

- **Electron 44** — 无边框悬浮窗（`frame: false`），`backgroundMaterial: 'acrylic'` 毛玻璃
- 主进程每 800ms 轮询剪贴板（Electron 44 新版异步 clipboard API），文本/图片按内容哈希去重
- 渲染层通过 `contextBridge` 安全桥接，`dsp://` 自定义协议提供本地图片访问
- 相册缩略图用 `nativeImage.createThumbnailFromPath` 生成并缓存
- 前端：原生 HTML/CSS/JS（多主题 CSS 变量 + 绝对定位布局矩阵），带 jsdom 回归测试

> ⚙️ 配置入口在面板右上角「⚙ 设置」，包含风格、透明度、尺寸预设等。

---

## 📁 目录结构

```
clipboard-panel/
├─ main.js            # 主进程：窗口 / 剪贴板监听 / 相册扫描 / IPC
├─ preload.js         # contextBridge 安全桥接
├─ renderer.js        # 界面逻辑：布局拖拽 / 标签 / 风格切换
├─ index.html         # 界面结构
├─ styles.css         # 多主题样式
├─ tests/             # jsdom 界面回归测试
├─ install.bat        # 一键安装依赖
├─ 启动剪贴面板.bat   # 一键启动
└─ package.json
```

---

## 📦 数据位置

用户目录 `%APPDATA%\clipboard-panel\`：

| 文件/目录 | 说明 |
|---|---|
| `clipboard.json` | 剪贴历史 |
| `images\` | 剪贴板图片 |
| `album\` | 内置相册（拖入的图片） |
| `thumbs\` | 相册缩略图缓存 |
| `settings.json` | 面板设置（布局/风格/透明度等） |

---

## 🤝 许可

[MIT License](LICENSE) · Copyright © 2026 F-3-H
