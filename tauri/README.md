# 墨阅 Tauri 桌面壳

用系统 WebView 承载阅读器：Windows 用 WebView2，macOS 用 WKWebView。相比 Electron，不打包 Chromium，壳体积通常 3–10 MB。

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

## macOS 构建

macOS 使用系统 WKWebView，需在 macOS 上构建；GitHub Actions 配置：

```
.github/workflows/build-tauri-macos.yml
```

运行 `build-tauri-macos` 会构建 **Universal（Apple Silicon + Intel）** DMG：

```bash
cd tauri
npm ci
npm run build:mac
```

产物：`src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg`

已构建并发布：`Moyue-1.3.0-macOS-universal.dmg`（约 5.8 MB，Universal 二进制）。macOS 打印通过 Tauri 原生 `WebviewWindow::print()` 命令调用 WKWebView 打印。版本未做 Apple 签名/公证，首次打开需右键“打开”，或：

```bash
xattr -dr com.apple.quarantine /Applications/墨阅.app
```

## 已验证（2026-11-25 / 11-27）

- Windows：GitHub Actions `build-tauri-windows` 在 `windows-latest` 构建成功；便携版 8,971,776 字节（约 9.0 MB）、NSIS 安装包 1,961,789 字节（约 2.0 MB）；本地磁盘启动、窗口标题「墨阅」、三档模式与 localStorage 偏好通过 WebView2 CDP 验证。
- macOS：GitHub Actions `build-tauri-macos` 在 `macos-latest` 构建成功；DMG 5,794,299 字节，内含 Universal Mach-O（x86_64 + arm64）；未在实体 Mac 上运行验证。
- 重要：**不要直接从网络映射盘（如 `P:`）运行 Windows 便携 exe**；WebView2 不支持该运行方式。复制到本地磁盘/下载目录，或使用安装包安装到 `%LOCALAPPDATA%`。
- 发布地址：https://github.com/bundur163/moyue/releases/tag/v1.3.0

## 与 Electron 版的差异

- Tauri 使用系统 WebView2，不携带 Chromium，体积和启动速度明显更优；
- 打印使用 `window.print()` 调起 WebView2 的系统打印对话框，A4 打印样式与浏览器版共用；
- 打包时把 `Markdown阅读器.html` 作为 `ui/index.html` 嵌入；
- 文件打开、拖拽、localStorage 偏好、搜索高亮由 WebView2 直接支持；
- 当前 Windows 与 macOS 均已构建；macOS 只做了 CI 构建与包结构核对，仍需实体 Mac 实机确认。
