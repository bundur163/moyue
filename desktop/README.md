# 墨阅桌面版（Electron）

把单文件阅读器 `Markdown阅读器.html` 包装成桌面程序。阅读器本身仍是唯一事实来源：打包前由 `prepare.mjs` 复制到 `app/index.html`。

## 结构

```
desktop/
├─ main.js              Electron 主进程：窗口、菜单、打印桥接
├─ preload.js           最小 contextBridge（仅打印）
├─ prepare.mjs          复制 ../Markdown阅读器.html → app/index.html
├─ package.json         桌面依赖与 electron-builder 配置
├─ package-lock.json
├─ build/               应用图标（png / ico / icns）
├─ app/                 打包时生成，已忽略
├─ dist/                构建产物，已忽略
└─ node_modules/        已忽略
```

## 开发运行

```powershell
cd desktop
npm install
npm start
```

## Windows 单文件版

```powershell
cd desktop
npm run dist:win
```

`electron-builder` 的 NSIS portable 在本机 Windows Server 2016 上会因 makensis 创建 mmap 失败；当前发布包使用 **7zS.sfx + 7z 归档** 生成单文件自解压 EXE：

- 应用目录：`dist/win-unpacked/`
- 7z 归档：`dist/moyue-app.7z`
- 单文件：`dist/Moyue-1.2.0-Windows-x64.exe`

单文件启动时先自解压到临时目录再运行 `Moyue.exe`，无需安装。未签名，Windows SmartScreen 可能提示。

## macOS

macOS 产物由 GitHub Actions 的 macOS runner 构建，配置文件：

```
.github/workflows/build-macos.yml
```

在 GitHub 仓库 Actions 中运行 `build-macos`，会生成：

- `Moyue-1.2.0-macOS-x64.dmg` / `.zip`
- `Moyue-1.2.0-macOS-arm64.dmg` / `.zip`

macOS 版本未做开发者签名/公证，首次打开需右键“打开”，或在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/墨阅.app
```

## 打印

渲染层通过 `window.moyueDesktop.print()` 调用 Electron `webContents.print()`，在桌面壳中打开系统打印对话框；浏览器版本仍回退到 `window.print()`。阅读器 DOM 中的 A4 打印样式与浏览器版完全一致。

## 安全

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- preload 只暴露 `platform` 与 `print`
- 外部链接交给系统浏览器，窗口内导航被阻止
- 应用只加载本地 `app/index.html`，不加载远程页面
