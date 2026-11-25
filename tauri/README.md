# 墨阅 Tauri 桌面壳

用系统 WebView 承载阅读器：Windows 用 WebView2，macOS 后续用 WKWebView。相比 Electron，不打包 Chromium，壳体积通常 3–10 MB。

## 结构

```
tauri/
├─ package.json             Tauri CLI 与构建脚本
├─ prepare.mjs              同步 ../Markdown阅读器.html → ui/index.html
├─ ui/                      前端产物（生成，已忽略）
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   ├─ icons/
   └─ src/{main.rs,lib.rs}
```

## Windows 构建

依赖：Node.js 22、Rust stable、MSVC 生成工具、WebView2 Runtime。

```powershell
cd tauri
npm install
npm run build:win
```

产物：

- `src-tauri/target/release/moyue.exe`：单文件便携版，依赖系统 WebView2 Runtime
- `src-tauri/target/release/bundle/nsis/*.exe`：当前用户安装包，安装时按需引导 WebView2

本地没有 Rust 工具链，Windows 构建由 GitHub Actions `build-tauri-windows` 在 `windows-latest` 上完成。

## 与 Electron 版的差异

- Tauri 使用系统 WebView2，不携带 Chromium，体积和启动速度明显更优；
- 打印使用 `window.print()` 调起 WebView2 的系统打印对话框，A4 打印样式与浏览器版共用；
- 打包时把 `Markdown阅读器.html` 作为 `ui/index.html` 嵌入；
- 文件打开、拖拽、localStorage 偏好、搜索高亮由 WebView2 直接支持；
- 当前只做 Windows；macOS 等 Windows 版确认后再加 WKWebView/Actions。
