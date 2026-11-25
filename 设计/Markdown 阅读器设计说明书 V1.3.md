# Markdown 阅读器设计说明书 V1.3

- 文档版本：V1.3
- 编制日期：2026-11-25
- 编制人：DSH（lead）
- 适用项目：`P:\Bundur\mdviewer`
- 需求来源：2026-11-24 指令（阅读器、大纲、连续滚动、滚轮翻页、打印、GitHub）；2026-11-24 18:00 追加指令（Windows/macOS 桌面可执行程序）

## 修订记录

| 版本 | 日期 | 变更内容 | 编制人 |
| --- | --- | --- | --- |
| V1.0 | 2026-11-24 | 初版：需求、形态、技术方案、分页与搜索算法、测试方案 | DSH（lead） |
| V1.1 | 2026-11-24 | 新增文档大纲模式、收起侧栏后的连续纸面滚动、单页滚轮到底翻页；补充对应测试与限制 | DSH（lead） |
| V1.2 | 2026-11-24 | 新增打印功能：按逻辑页生成 A4 打印纸、隐藏应用界面、溢出页可延展；补充测试与发布说明 | DSH（lead） |
| V1.3 | 2026-11-25 | 新增 Electron 桌面壳与 Windows 单文件分发；补充 macOS Actions 构建与签名限制 | DSH（lead） |

---

## 1. 背景与目标

用户需要一个「最简单的」Markdown 文档阅读器：打开文件后立即进入阅读状态，阅读形态向 PDF 阅读器看齐——**左侧页面缩略预览，右侧单页阅读**；支持**全文搜索**与**选中文本复制**。

设计目标：

1. **零安装、零构建、零网络**：双击 `index.html`（或单文件版 `Markdown阅读器.html`）即可使用；
2. **打开即读**：选择文件后自动分页并显示第一页，不出现中间设置页；
3. **PDF 式版式**：固定 A4 纵向纸张、页脚页码、左侧缩略图、上一页/下一页翻页；
4. **导航可切换**：左侧可在「页面预览 / 文档大纲」之间切换，点击大纲标题跳到对应页；
5. **连续阅读**：收起预览或大纲后，页面按页尾接页首拼成一张长纸，滚动条连续滚动；
6. **滚轮翻页**：单页模式滚到底后继续下滚自动到下一页，顶部继续上滚回到上一页；
7. **搜索可用**：全文命中计数、跨页跳转、当前页高亮、上一个/下一个命中；
8. **复制零干扰**：正文使用浏览器原生选区与复制（Ctrl+C / 右键复制），不劫持鼠标；
9. **可打印**：一键打印全文，每个逻辑页对应一张 A4 纸，隐藏应用界面与搜索高亮；
10. **可维护**：源码分层（HTML / CSS / JS / vendor），另提供单文件产物便于分发；
11. **桌面可执行**：Windows 单文件免安装 EXE；macOS DMG/ZIP 通过 GitHub Actions 的 macOS runner 构建。

非目标（本期不做）：

- 不做后端、不上传文档、不保存阅读进度与书架；
- 不做编辑器、批注、双页并排、导出 PDF；
- 大纲只按标题层级缩进展示，不做可折叠多级目录树；
- 不处理相对路径图片（浏览器 `file://` 下无法读取同目录资源），仅支持网络图片与 data URI；
- 不做移动端手势翻页（保留按钮、键盘与滚轮翻页）；
- 不做应用商店上架、Windows/macOS 代码签名与公证。

## 2. 需求分解

| 编号 | 需求 | 实现方式 | 验收标准 |
| --- | --- | --- | --- |
| R1 | 打开文件即阅读 | `<input type=file>` + 拖拽 + FileReader；解析后直接分页渲染 | 选择 `.md` 后立即出现第 1 页；无需二次确认 |
| R2 | 左侧页预览 | 每页 DOM 克隆后按比例缩放为缩略图，点击跳页 | 缩略图数量 = 总页数；当前页高亮；点击可跳转 |
| R3 | 右侧页阅读 | A4 纸张（760×1075 CSS px），固定页高，滚动条只出现在超长单块页内 | 页面按内容自然分页；普通块不被裁切 |
| R4 | 搜索 | 文本节点级子串匹配 + CSS Custom Highlight 高亮 | 显示 `当前/总数`；Enter/Shift+Enter 或按钮跨页跳转 |
| R5 | 选中复制 | 正文 `user-select:text`，不拦截选择与右键 | 可拖选正文；Ctrl+C 内容正确；无脚本改写选区 |
| R6 | 翻页 | 按钮、页码输入、←/→、PageUp/PageDown、Home/End | 页码与页脚同步；到边界不越界 |
| R7 | 自适应 | 页面按窗口高度等比缩放，可手动缩放 | 改变窗口大小页面不裁切；缩放比例可见 |
| R8 | 文档大纲 | 侧栏「页面 / 大纲」切换；扫描每页 h1–h6，按层级缩进，标注页码，点击跳页 | 大纲项数量 = 标题数；点击后当前页与页脚一致；当前项高亮 |
| R9 | 连续滚动 | 收起侧栏（预览或大纲）后，所有页按页尾接页首拼成长纸，连续滚动 | 滚动条可连续滚动；滚动时页码同步；展开后回到当前单页 |
| R10 | 滚轮翻页 | 单页模式下，页/舞台滚到底再下滚翻下一页；顶部继续上滚回上一页 | 普通页一次滚轮翻页；有页内滚动时先滚完页内内容；末页不越界 |
| R11 | 打印 | 打印按钮 / Ctrl+P；克隆全部逻辑页到打印容器，`@media print` 每页一张 A4 | 打印预览无工具栏；页数 = 文档页数；溢出页内容不被裁切 |
| R12 | 桌面程序 | Electron 33 桌面壳；Windows 7zS 单文件；macOS GitHub Actions 构建 | Windows 双击即用；macOS 产出 DMG/ZIP；阅读/打印行为与浏览器版一致 |

## 3. 技术选型

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| 原生 HTML + CSS + JavaScript | **采用** | 无构建步骤，`file://` 直接运行；符合「最简单」 |
| Markdown 解析：marked v15.0.12（本地 vendored） | **采用** | 成熟 GFM 支持；UMD 非模块脚本，file:// 下可用；MIT 许可 |
| 分页：测量式块级分页 | **采用** | 固定纸张尺寸，块级装箱可精确控制页高，缩略图可克隆 |
| 分页：CSS 多栏 / iframe | 放弃 | 多栏难以生成逐页缩略图；iframe 增加通信与样式复杂度 |
| 搜索高亮：CSS Custom Highlight API | **采用** | 不修改 DOM，不破坏原生选区与复制；Chrome/Edge 105+ 支持 |
| 搜索高亮：包裹 `<mark>` | 放弃 | 会改写 DOM、切断选区、影响复制与分页测量 |
| 打印：浏览器原生 `window.print()` + `@media print` | **采用** | 无需 PDF 库；按逻辑页克隆，A4 纸面尺寸由 CSS 控制 |
| 打印：服务端/客户端生成 PDF | 放弃 | 增加依赖与构建复杂度，不符合零依赖目标 |
| 桌面壳：Electron 33 + 7zS SFX（Windows） | **采用** | 复用现有 HTML；Electron 45 体积导致 NSIS mmap 失败，33 可将单文件压到 81MB |
| 桌面壳：Tauri / Neutralino | 放弃 | 需额外原生工具链；macOS 仍需 macOS 构建 |
| macOS 构建：GitHub Actions macos-latest | **采用** | Windows 无法跨平台生成 macOS 包；由 macOS runner 构建 x64/arm64 DMG/ZIP |
| 单文件分发：Python 内联脚本 | **采用** | 保持源码可读，同时产出可单独复制的一个 HTML 文件；符合参考项目 `build_*.py` 惯例 |

## 4. 总体结构

```
mdviewer/
├─ index.html                 源码入口（双击即可运行）
├─ assets/
│  ├─ styles.css              全部样式（纸张、工具栏、侧栏、空状态）
│  └─ app.js                  解析、分页、渲染、搜索、交互
├─ vendor/marked.min.js       marked v15.0.12（MIT）
├─ build_single.py            生成单文件版
├─ desktop/                   Electron 桌面壳（Windows/macOS）
│  ├─ main.js                 窗口、菜单、打印 IPC
│  ├─ preload.js              最小 contextBridge
│  ├─ prepare.mjs             同步单文件阅读器
│  ├─ package.json / lock     Electron 33、electron-builder 配置
│  ├─ build/                  图标 png/ico/icns
│  └─ README.md               桌面构建说明
├─ .github/workflows/         macOS Actions 构建
├─ .gitignore                 排除无关本地文档与构建产物
├─ Markdown阅读器.html        单文件产物（由脚本生成）
├─ README.md                  使用说明
├─ 工作规则.md
├─ 设计/Markdown 阅读器设计说明书 V1.2.md
├─ 日志/2026-11-24.md
└─ 测试/
   ├─ fixtures/               测试用 Markdown
   ├─ test_reader.mjs         CDP 自动化测试（Edge headless）
   ├─ 测试记录.md
   └─ 截图/
```

应用内模块划分（`assets/app.js`，单一 IIFE，避免全局污染）：

| 模块 | 职责 |
| --- | --- |
| `decodeBuffer` | 文本解码：UTF-8（严格）→ GB18030 兜底；识别 UTF-16 BOM；二进制拦截 |
| `sanitizeFragment` | 白名单式清洗 marked 输出：去脚本/事件/危险 URL，限制 class |
| `paginate` | 将顶层块装箱到固定纸张，超长代码块按行拆分，其他超高块记录溢出 |
| `buildThumbs` | 逐页克隆并缩放缩略图 |
| `buildOutline` | 扫描每页 h1–h6，生成带页码与层级的大纲；点击跳页并同步当前项 |
| `layout` | 在「单页」与「连续纸面」两种布局间切换，缩放、滚动同步与当前页判定 |
| `wheel` | 单页模式的边界滚轮翻页；处理页内滚动、舞台滚动与冷却时间 |
| `search` | 全页文本节点扫描、命中索引、高亮与跳转；连续模式高亮全部页面 |
| `print` | 将全部逻辑页克隆进 `.print-root`，按 A4 纸张分页；打印前后自动准备/清理 |
| `desktop` | Electron 主进程/预加载：窗口、菜单、外部链接、打印 IPC；Windows 7zS 与 macOS Actions 分发 |
| `view` | 翻页、缩放、侧栏与标签切换、键盘、状态栏 |
| `MDV` | 对外测试/调试 API（`openText`、`state`、`goToPage`、`outlineInfo`、`preparePrint` 等） |

## 5. 页面与分页设计

### 5.1 纸张参数

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 页面尺寸 | 760 × 1075 px | 近似 A4（1:1.414）竖版 |
| 左右内边距 | 68 px | 正文宽 624 px |
| 上内边距 | 64 px | |
| 下内边距 | 92 px | 预留页脚空间 |
| 正文高度 | 919 px | 由运行时探测 CSS 计算值，不写死 |
| 正文字号 | 16 px / 行高 1.95 | 约每行 39 个汉字 |

### 5.2 分页算法（测量式装箱）

1. `marked.parse()` 得到 HTML，`sanitizeHtml()` 清洗，`<table>` 外包 `.table-wrap`；
2. 将顶层块（heading / p / ul / pre / table-wrap / blockquote / hr…）依次装入测量页；
3. 每个块加入后读取 `getBoundingClientRect().height + margin-bottom`，累加高度；
4. 若累计高度超过正文高度且当前页非空：移除该块，提交当前页，新开一页重新放入；
5. 若**超长代码块**本身高于整页：按行拆分到多页，第一段优先填满当前页的剩余空间，避免整页留白；
6. 其他单块本身高于整页（超大表格、超长段落）：独占一页，标记 `has-overflow`，该页正文改为页内滚动；
7. 所有块处理完后，逐页补齐页脚「标题 · 第 N / M 页」，并清理测量容器。

块间距只使用 `margin-bottom`，禁止 `margin-top`（`.page-body > * { margin-top: 0 }`），使「块高 + 下边距」严格等于累计高度，避免外边距合并导致的分页误差。若出现水平溢出，页正文同样标记 `has-overflow` 以允许横向滚动。

### 5.3 翻页与缩放

- **单页布局**下所有页面元素常驻内存，当前页移入 `.page-zoom` 显示，其余保持游离（其文本节点仍可被搜索索引）；
- 缩放：`fit` 模式按「可用宽高 / 纸张尺寸」取最小值（上限 1.25），手动模式以 10% 步进，范围 40%–200%；
- `ResizeObserver` 监听阅读区，`fit` 模式下自动重算；缩放只改变 `transform: scale()`，不触发重新分页；
- 离开某页时记录其页内滚动位置，返回时恢复；
- 连续布局见 5.6，两种布局共用同一缩放比例。

### 5.4 缩略图

- 每个缩略图为 `button`，内含按 `156 / 760` 缩放的整页克隆，页脚保留；
- 克隆时清除 `id`，避免重复；缩略图内容 `pointer-events:none`，整块可点击；
- 当前页以强调色描边 + 页码加粗标识，翻页时 `scrollIntoView({block:'nearest'})` 保持可见。

### 5.5 文档大纲

- 侧栏头部为「页面 / 大纲」两个标签，切换只改变侧栏内容，不改变正文布局；
- 打开文档后扫描每页 `.page-body` 中的 `h1–h6`，按 DOM 顺序记录 `{level, text, page, element}`；文本做空白折叠，空标题忽略；
- 大纲项按标题层级缩进（h1 为根，h6 最深），右侧显示 `P<页码>`；
- 点击大纲项：调用 `goToPage(page)`；若标题位于页内滚动区域，再按缩放比例反算该标题的 `scrollTop`，保证标题可见；
- 当前项判定：优先保留用户刚点击的项；否则取当前页第一个标题，若当前页没有标题则取此前最近的标题；
- 切换页面、搜索跳页、连续滚动时同步高亮；大纲面板滚动时用 `scrollIntoView({block:'nearest'})` 保持当前项可见；
- 无标题文档显示「本文档没有标题」，不会生成空列表。

### 5.6 连续纸面布局

- 触发条件：侧栏收起（页面预览或文档大纲均可）；展开侧栏恢复单页布局，并保留当前页；
- 所有页面移入 `.continuous-stack`，每页包一层 `.continuous-page > .continuous-zoom`；页面间距为 0，页尾直接接下一页页首；
- 每页外层按当前缩放设置宽高，内层用 `transform: scale()` 缩放；整叠纸只有一条外阴影，页与页之间用 1px 内阴影分隔；
- 阅读区滚动条连续滚动；滚动时以「页面中心距离视口中心最近」判定当前页，同步页码、缩略图高亮与大纲当前项；
- 页码按钮、页码输入、键盘翻页在连续布局下变为「滚动到目标页顶部」；
- 搜索在连续布局下对已挂载的全部页面创建高亮 `Range`，当前命中滚动到可视区；
- 缩放或窗口变化时重算每页尺寸，并重新对齐当前页顶部；
- 超长溢出页仍保留页内滚动，这是固定纸面与连续滚动的折中。

### 5.7 滚轮翻页

- 仅在**单页布局**启用；连续布局交给浏览器原生滚动；
- 滚轮事件监听在阅读区，`passive:false`；优先级：
  1. 当前页正文可滚动且方向未到边界 → 滚动页内正文；
  2. 阅读区（缩放后）可滚动且未到边界 → 交给浏览器滚动；
  3. 两者都到边界 → `preventDefault` 并累计滚轮距离；
- 累计超过 40px 触发一次翻页；向上到顶回上一页，向下到底去下一页；
- 翻页后 800ms 冷却，避免触控板惯性一次翻过多页；累计值 350ms 无事件自动清零；
- 末页继续下滚、首页继续上滚时只阻止默认滚动，不越界。

### 5.8 打印

- 入口：顶栏「打印」按钮、`Ctrl+P`；浏览器菜单打印也通过 `beforeprint` 自动准备；
- 打印准备 `preparePrint()`：为每个逻辑页克隆一个 `.print-sheet`（内部为整页 `.page`），移除重复 `id`、重置页内滚动；打印结束 `afterprint` / `clearPrint()` 清理；
- 打印版式：`@page { size: A4 portrait; margin: 0 }`；`.print-sheet` 为 210×297mm，顶部 6mm 留白，页面 760×1075px 居中，每张纸 `page-break-after:always`；
- 屏幕上 `.print-root` 为 `display:none`；`@media print` 下隐藏应用界面，只显示打印容器，因此不会打印工具栏、侧栏、搜索高亮；
- 普通页保留页脚「文档名 · 第 N / M 页」；内容高于一页的溢出页使用 `is-overflow`：纸张高度自动延展、正文 `overflow:visible`、隐藏绝对定位页脚，避免内容被裁切；
- 打印不生成 PDF 文件，调用浏览器打印对话框；由用户选择打印机、页码范围与纸张。
- 打印始终输出**全文**，与当前是单页、连续、页面预览还是大纲模式无关。

## 6. 搜索设计

1. **索引**：对每页 `.page-body` 做 `TreeWalker` 遍历文本节点，记录 `{page, node, offset, length}`；
2. **匹配**：大小写不敏感的子串查找（`toLowerCase` + `indexOf`），不计跨文本节点的命中（例如 `**加粗**文字` 中间被标签切开的情形），单文档命中上限 5000 条；
3. **计数**：工具栏显示 `当前序号 / 总命中数`；命中为 0 时显示 `0 / 0` 并禁用上/下一个；
4. **高亮**：使用 `CSS.highlights` 注册两个高亮组——`mdv-search`（全部命中，暖黄）与 `mdv-search-active`（当前命中，橙色）；单页布局只对当前页创建 `Range`，连续布局对全部已挂载页面创建；
5. **跳转**：输入后若当前页有命中则停留，否则自动跳到第一处命中；Enter → 下一个，Shift+Enter → 上一个，循环；
6. **定位**：命中位于溢出页时，按缩放比例反算页内 `scrollTop`；连续布局再滚动阅读区，使命中进入视口；
7. **降级**：浏览器不支持 Custom Highlight 时仍可计数与跳页，仅不高亮（README 注明推荐 Chrome/Edge 105+）；
8. **过期请求保护**：搜索定位用 `requestAnimationFrame` 延迟执行前，会校验命中序号、命中对象与当前页，避免用户立即翻页/清空搜索后被旧滚动拉回。

## 7. 选中与复制

- `.page-body` 设置 `user-select:text`，工具栏、缩略图、页脚设置 `user-select:none`；
- 不注册会 `preventDefault` 的 `mousedown/click/dblclick` 处理，保留浏览器原生选区、双击选词、右键菜单与 Ctrl+C；
- 搜索高亮通过 `CSS.highlights` 实现，不插入 `<mark>`，因此不影响选区边界与复制内容；
- 页脚与正文分离，复制正文不会混入页码。

## 8. 安全性

| 风险 | 处置 |
| --- | --- |
| Markdown 内嵌脚本 | 清洗删除 `script/style/iframe/object/embed/form/link/meta/base/svg/canvas/video/audio` 等标签 |
| 事件属性注入 | 删除全部 `on*` 属性与 `style` 属性 |
| 危险链接 | 移除 `javascript:` / `vbscript:` / `data:text/html`；外链强制 `target=_blank rel=noopener noreferrer` |
| 表单控件 | 仅保留任务列表所需的 `input[type=checkbox][disabled]` |
| 本地文件 | 不上传、不写入 localStorage；只在内存中解析展示 |

## 9. 兼容性与性能

- 目标浏览器：Chrome / Edge 105+（Custom Highlight API）；基础阅读在 Firefox/Safari 可用（无搜索高亮）；
- 无网络依赖：marked 本地加载，字体使用系统字体栈，避免 webfont 引起的二次分页；
- 分页复杂度 O(块数)，搜索 O(文本长度)，大纲 O(标题数)；缩略图为全量克隆，适用于常规文档（≤ 300 页）；
- 连续布局会把全部页面同时挂到 DOM，超大文档的内存与首屏开销高于单页布局；
- 大文件解码优先 UTF-8，失败回退 GB18030，兼顾 Windows 下中文文档。

## 10. 测试方案

自动化（`测试/test_reader.mjs`，Edge headless + CDP）：

1. 通过 `DOM.setFileInputFiles` 走真实文件选择路径打开测试文档；
2. 校验页数、每页正文高度不超限、缩略图数量与页码；
3. 校验搜索命中数、自动跳页、下一个/上一个循环、CSS 高亮组存在；
4. 程序化创建选区，校验选区文本非空且 `user-select` 未被禁用，并通过 Ctrl+C 校验剪贴板内容；
5. 校验翻页按钮、页码输入、快捷键、缩放与侧栏收起；
6. 校验超长代码块按行拆分、其他超高单块页内滚动兜底、GB18030 解码与安全清洗；
7. 切换大纲：标题数量/层级/页码、点击跳页、当前项高亮、大纲收起与恢复；
8. 收起预览：连续页面拼接、滚动同步页码、下一页按钮、连续模式搜索、展开回到当前页；
9. 滚轮：单页向下翻页、向上回页、末页不越界；
10. 打印：按钮存在、逐页生成打印纸、屏幕隐藏、打印媒体隐藏应用、A4 尺寸、溢出页延展、清理临时纸张；
11. 桌面：Windows 单文件 EXE 启动、窗口标题「墨阅」、SHA-256 校验；macOS 由 Actions 生成 x64/arm64 DMG/ZIP；
12. 截图归档到 `测试/截图/`；失败时进程退出码非 0。

手工验收：双击 `index.html` → 打开 `测试/fixtures/阅读器验收文档.md` → 目视检查分页、缩略图、搜索、复制；切换大纲并点击标题；收起侧栏连续滚动，再展开；点击打印或 Ctrl+P 检查打印预览；对单文件版重复一次。

## 11. 风险与限制

| 风险/限制 | 影响 | 处置 |
| --- | --- | --- |
| 单个超长块超过一页 | 代码块已按行拆分；超大表格/超长段落仍可能页内滚动 | 代码块按行拆分；其余块标记溢出并在状态栏提示「含长内容」 |
| 跨内联标签的搜索词 | 搜不到被标签分隔的词组 | 已注明；后续可做块级文本索引映射 |
| 相对路径图片 | `file://` 下无法加载 | 仅支持网络图片/data URI；README 注明 |
| 超大文档 | 分页与缩略图构建耗时 | 常规文档足够；后续可做缩略图懒渲染、分页 Worker |
| 字体差异 | 不同系统分页位置略有差异 | 使用系统字体栈；页内滚动兜底，不丢内容 |
| 大纲只列标题 | 图片、表格、代码块内的标题不会被单独识别为目录项 | 按 h1–h6 生成大纲；不做锚点树与折叠 |
| 连续布局页脚重复 | 页尾仍显示页码，翻到下一页时会看到页脚 | 保留页脚作为连续纸面的分页标记 |
| 滚轮惯性 | 触控板惯性可能连续翻页 | 800ms 冷却 + 40px 累计阈值；可按需调大 |
| 连续布局内存 | 所有页面同时挂载 | 常规文档可接受；超大文档建议使用单页模式 |
| 打印纸张 | 浏览器/打印机可能加页眉页脚，A4 以外纸张可能缩放 | 使用 `@page A4`，建议在打印对话框关闭页眉页脚 |
| 打印溢出页 | 超高页打印时纸张延展，可能跨多张物理纸 | 正文 `overflow:visible`，隐藏页脚，不裁切内容 |
| 打印颜色 | 背景色/代码块底色取决于打印机“背景图形”选项 | 打印预览确认；正文对比度不依赖背景色 |
| 桌面签名 | Windows SmartScreen、macOS Gatekeeper 会提示未签名应用 | 在 Release 与 README 说明；macOS 可右键打开或 `xattr -dr` |
| Electron 33 | 为体积与打包兼容性固定 33；Chromium 版本较旧 | 桌面壳只加载本地 HTML，不访问远程页面；后续可升级并改 CI 打包 |
| 7zS 自解压 | 首次启动先解压到临时目录，启动略慢 | 81MB 单文件；解压后运行 `Moyue.exe`，不写注册表 |

## 12. 交付清单

- [x] `index.html` + `assets/*` + `vendor/marked.min.js`
- [x] `Markdown阅读器.html` 单文件版（脚本生成）
- [x] `README.md` 使用说明
- [x] `设计/Markdown 阅读器设计说明书 V1.3.md`
- [x] `desktop/` Electron 桌面壳 + Windows 单文件 + macOS Actions
- [x] `测试/test_reader.mjs` + 测试文档 + `测试/测试记录.md` + 截图
- [x] 当日工作日志与变更影响评估

## 13. 桌面分发（V1.3）

- **单一事实来源**：桌面版不维护第二套 UI；`desktop/prepare.mjs` 将 `Markdown阅读器.html` 复制为 `app/index.html`，Electron 加载本地文件；
- **Electron 版本**：固定 33.4.11。Electron 45 的 Windows 应用体积过大，导致 electron-builder 的 NSIS makensis 在本机创建 126MB mmap 失败；33 将 7z 归档压到 78MB；
- **Windows**：electron-builder portable 仍受 makensis mmap 限制；IExpress 不能保留 `locales/`、`resources/` 目录结构；最终采用 `7zS.sfx + config.txt + app.7z` 拼接为单文件 EXE，`RunProgram=Moyue.exe`。首次启动自解压到临时目录，不写注册表；
- **Windows 产物**：`Moyue-1.2.0-Windows-x64.exe`，81,132,251 字节，SHA-256 单独提供；
- **macOS**：Windows 无法交叉生成 macOS 包（electron-builder 明确拒绝，packager 需要符号链接权限）；GitHub Actions `macos-latest` 上执行 `electron-builder --mac dmg zip --x64 --arm64`，产出两个架构的 DMG/ZIP；未签名/未公证；
- **打印**：渲染层检测 `window.moyueDesktop.print`，存在时通过 preload → IPC → `webContents.print({silent:false, printBackground:true, pageSize:'A4'})` 打开系统打印对话框；否则回退 `window.print()`；
- **安全**：`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`；仅暴露 `platform` 与 `print`；外部链接交给系统浏览器，阻止窗口内导航与 webview；
- **发布**：GitHub Release `v1.2.0`，包含 Windows 单文件与校验、macOS arm64/x64 DMG+ZIP、macOS SHA-256 校验；全部未签名。
