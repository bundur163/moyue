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

## 已验证（2026-11-25）

- GitHub Actions `build-tauri-windows` 在 `windows-latest` 构建成功；
- 产物：
  - `moyue.exe` 8,892,928 字节（约 8.9 MB）
  - `墨阅_1.3.0_x64-setup.exe` 1,946,542 字节（约 1.9 MB）
- 在 Windows 本地磁盘启动 `moyue.exe`，窗口标题「墨阅」，页面版本 1.3.0，示例文档 4 页；
- 通过 WebView2 CDP 验证三档显示模式与 localStorage 偏好；
- 重要：**不要直接从网络映射盘（如 `P:`）运行便携 exe**，WebView2 用户数据目录会报 os error 5（拒绝访问）。复制到本地磁盘/下载目录运行，或使用安装包安装到 `%LOCALAPPDATA%`。
- 发布地址：https://github.com/bundur163/moyue/releases/tag/v1.3.0

## 与 Electron 版的差异

- Tauri 使用系统 WebView2，不携带 Chromium，体积和启动速度明显更优；
- 打印使用 `window.print()` 调起 WebView2 的系统打印对话框，A4 打印样式与浏览器版共用；
- 打包时把 `Markdown阅读器.html` 作为 `ui/index.html` 嵌入；
- 文件打开、拖拽、localStorage 偏好、搜索高亮由 WebView2 直接支持；
- 当前只做 Windows；macOS 等 Windows 版确认后再加 WKWebView/Actions。
