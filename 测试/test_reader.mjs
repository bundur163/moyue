#!/usr/bin/env node
/**
 * Markdown 阅读器 — 自动化验收测试
 *
 * 依赖：Windows 自带 Microsoft Edge（headless）+ Node 22（内置 fetch / WebSocket）。
 * 不使用 npm 依赖，直接运行：
 *   node 测试/test_reader.mjs
 *
 * 通过 CDP 驱动真实浏览器，覆盖：空状态、示例文档、分页、缩略图、搜索、
 * 原生选中/复制、翻页、缩放、侧栏、文件选择、GB18030、超长代码块与安全清洗。
 */

import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, '截图');
const FIXTURES = path.join(HERE, 'fixtures');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VIEWPORT = { width: 1600, height: 1000 };

const results = { passed: 0, failed: 0, failures: [], notes: [] };
const pageErrors = [];

let browser = null;
let cdp = null;
let screenshotIndex = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    console.log('  PASS  ' + name);
  } else {
    results.failed += 1;
    results.failures.push({ name, detail });
    console.log('  FAIL  ' + name + (detail ? '  —— ' + detail : ''));
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeout, label) {
  const started = Date.now();
  let lastError = null;
  let lastValue;
  while (Date.now() - started < timeout) {
    try {
      lastValue = await fn();
      if (lastValue) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    '等待超时：' + label + '；最后值=' + JSON.stringify(lastValue) +
    (lastError ? '；错误=' + lastError.message : '')
  );
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 10000);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 连接失败：' + (event.message || 'unknown')));
      }, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      const handle = (text) => {
        let message;
        try {
          message = JSON.parse(text);
        } catch (error) {
          return;
        }
        if (message.id) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message + ' (' + message.error.code + ')'));
          else pending.resolve(message.result);
          return;
        }
        if (message.method) {
          const handlers = this.listeners.get(message.method) || [];
          for (const handler of handlers) handler(message.params || {});
        }
      };

      const data = event.data;
      if (typeof data === 'string') handle(data);
      else if (data && typeof data.text === 'function') data.text().then(handle).catch(() => {});
      else if (data) handle(Buffer.from(data).toString('utf8'));
    });

    this.ws.addEventListener('close', () => {
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP 连接已关闭'));
      }
      this.pending.clear();
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }

  send(method, params = {}, timeout = 30000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP 未连接：' + method));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP 调用超时：' + method));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (error) { /* ignore */ }
    }
  }
}

async function launchBrowser() {
  if (!(await fileExists(EDGE))) {
    throw new Error('找不到 Microsoft Edge：' + EDGE + '（可用 EDGE_PATH 环境变量指定）');
  }

  const profile = path.join(HERE, '.edge-profile');
  await fs.rm(profile, { recursive: true, force: true });
  await fs.mkdir(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
  ];

  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  child.on('error', (error) => {
    pageErrors.push('浏览器启动失败：' + error.message);
  });

  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(async () => {
    try {
      const content = await fs.readFile(portFile, 'utf8');
      const first = content.trim().split(/\r?\n/)[0];
      const value = parseInt(first, 10);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      if (child.exitCode !== null) throw new Error('Edge 提前退出，exitCode=' + child.exitCode);
      return null;
    }
  }, 20000, '等待 Edge DevToolsActivePort');

  const listUrl = 'http://127.0.0.1:' + port + '/json/list';
  const targets = await waitFor(async () => {
    try {
      const response = await fetch(listUrl);
      if (!response.ok) return null;
      const list = await response.json();
      return list.find((item) => item.type === 'page') ? list : null;
    } catch (error) {
      return null;
    }
  }, 10000, '等待 Edge 调试目标');

  const target = targets.find((item) => item.type === 'page');
  const client = new CDP(target.webSocketDebuggerUrl);
  await client.connect();
  browser = { child, profile, port };
  cdp = client;
  return client;
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    return false;
  }
}

async function evaluate(expression, options = {}) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: !!options.awaitPromise,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: true
  });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    const description = details.exception && details.exception.description
      ? details.exception.description
      : details.text;
    throw new Error('页面执行异常：' + description);
  }
  return response.result ? response.result.value : undefined;
}

async function waitForPageReady() {
  await waitFor(async () => {
    return evaluate('document.readyState === "complete" && !!window.MDV && MDV.ready');
  }, 15000, '页面与 MDV 初始化');
}

function fileUrl(name) {
  return pathToFileURL(path.join(ROOT, name)).href;
}

async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  await sleep(150);
  await waitForPageReady();
  await sleep(120);
}

async function screenshot(name) {
  screenshotIndex += 1;
  const prefix = String(screenshotIndex).padStart(2, '0');
  const file = path.join(SHOTS, prefix + '-' + name + '.png');
  const response = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await fs.writeFile(file, Buffer.from(response.data, 'base64'));
  console.log('  SHOT  ' + path.relative(ROOT, file));
  return file;
}

async function openFixtureViaInput(fixtureName) {
  const documentNode = await cdp.send('DOM.getDocument', { depth: -1 });
  const input = await cdp.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: '#fileInput'
  });
  if (!input.nodeId) throw new Error('找不到 #fileInput');

  await cdp.send('DOM.setFileInputFiles', {
    files: [path.join(FIXTURES, fixtureName)],
    nodeId: input.nodeId
  });
  await evaluate('document.getElementById("fileInput").dispatchEvent(new Event("change", { bubbles: true }))');
}

async function runTests() {
  await fs.mkdir(SHOTS, { recursive: true });

  section('1. 空状态');
  await navigate(fileUrl('index.html'));
  const empty = await evaluate(`(() => ({
    isEmpty: document.body.classList.contains('is-empty'),
    emptyVisible: !document.getElementById('emptyState').hidden,
    sidebarHidden: document.getElementById('sidebar').hidden,
    controlsHidden: document.getElementById('topbarControls').hidden,
    stats: document.getElementById('statusStats').textContent,
    title: document.getElementById('docTitle').textContent
  }))()`);
  check('空状态显示引导页', empty.isEmpty && empty.emptyVisible);
  check('空状态隐藏工具栏与侧栏', empty.sidebarHidden && empty.controlsHidden);
  check('空状态文档标题正确', empty.title === '未打开文档', empty.title);
  await screenshot('空状态');

  section('2. 示例文档与分页');
  await navigate(fileUrl('index.html') + '?demo=1');
  await waitFor(async () => {
    return evaluate('MDV.state.pages.length >= 3 && !document.body.classList.contains("is-empty")');
  }, 15000, '示例文档分页完成');
  await sleep(250);

  const demo = await evaluate(`(() => ({
    pages: MDV.pageCount(),
    metrics: MDV.pageMetrics(),
    contentH: MDV.PAGE.contentH,
    thumbs: document.querySelectorAll('.thumb').length,
    activeThumbs: document.querySelectorAll('.thumb.active').length,
    footer: document.querySelector('#pageZoom .footer-num').textContent,
    pageInput: document.getElementById('pageInput').value,
    docTitle: document.getElementById('docTitle').textContent,
    current: MDV.state.current,
    overflowPages: MDV.state.pages.filter((page) => page.overflow).length,
    hasOverflowClass: !!document.querySelector('.page-body.has-overflow')
  }))()`);

  check('示例文档至少 3 页', demo.pages >= 3, '页数=' + demo.pages);
  check('缩略图数量与页数一致', demo.thumbs === demo.pages, demo.thumbs + ' / ' + demo.pages);
  check('当前页缩略图唯一高亮', demo.activeThumbs === 1, String(demo.activeThumbs));
  check('页码输入与页脚同步', demo.pageInput === '1' && /^1 \/ \d+$/.test(demo.footer), demo.pageInput + ' · ' + demo.footer);
  check('文档标题为示例文档', demo.docTitle === '示例文档.md', demo.docTitle);
  check('无内容被裁切（普通页）', demo.metrics.every((item) => item.overflow || item.scrollHeight <= item.clientHeight + 2),
    JSON.stringify(demo.metrics.filter((item) => !item.overflow && item.scrollHeight > item.clientHeight + 2)));
  check('示例文档无意外溢出页', demo.overflowPages === 0, String(demo.overflowPages));
  await screenshot('示例文档第一页');

  section('3. 搜索与高亮');
  const searched = await evaluate(`(() => {
    const hits = MDV.search('分页');
    const count = document.getElementById('searchCount');
    return {
      hits,
      storedHits: MDV.state.hits.length,
      hitIndex: MDV.state.hitIndex,
      current: MDV.state.current,
      countText: count.textContent,
      countHidden: count.hidden,
      prevDisabled: document.getElementById('searchPrev').disabled,
      nextDisabled: document.getElementById('searchNext').disabled,
      activeHighlight: CSS.highlights.has('mdv-search-active'),
      allHighlight: CSS.highlights.has('mdv-search'),
      highlightSupported: typeof Highlight === 'function' && !!CSS.highlights
    };
  })()`);

  check('搜索“分页”有命中', searched.hits > 0, String(searched.hits));
  check('命中计数显示', !searched.countHidden && /^\d+ \/ \d+$/.test(searched.countText), searched.countText);
  check('搜索自动跳到命中页', searched.current >= 0 && searched.hitIndex >= 0, JSON.stringify(searched));
  check('当前页有搜索高亮', searched.activeHighlight || !searched.highlightSupported);
  check('搜索前后按钮可用', !searched.prevDisabled && !searched.nextDisabled);
  await sleep(150);
  await screenshot('搜索命中');

  const nextHit = await evaluate(`(() => {
    const before = MDV.state.hitIndex;
    MDV.nextHit();
    return {
      before,
      after: MDV.state.hitIndex,
      total: MDV.state.hits.length,
      current: MDV.state.current,
      activeHighlight: CSS.highlights.has('mdv-search-active')
    };
  })()`);
  check('下一个命中循环切换', nextHit.after === (nextHit.before + 1) % nextHit.total,
    JSON.stringify(nextHit));
  check('切换后当前页保留高亮', nextHit.activeHighlight);

  const cleared = await evaluate(`(() => {
    MDV.clearSearch();
    return {
      hits: MDV.state.hits.length,
      countHidden: document.getElementById('searchCount').hidden,
      hasAll: CSS.highlights.has('mdv-search'),
      hasActive: CSS.highlights.has('mdv-search-active'),
      input: document.getElementById('searchInput').value
    };
  })()`);
  check('清除搜索后归零', cleared.hits === 0 && cleared.countHidden && cleared.input === '');
  check('清除搜索后移除高亮', !cleared.hasAll && !cleared.hasActive);

  section('4. 选中与复制');
  await cdp.send('Page.bringToFront').catch(() => {});
  const selection = await evaluate(`(() => {
    const body = document.querySelector('#pageZoom .page-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim().length >= 12) break;
    }
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(12, node.nodeValue.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const text = selection.toString();
    const style = getComputedStyle(body);

    const synthetic = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    body.dispatchEvent(synthetic);

    let queryEnabled = false;
    let commandResult = false;
    try {
      queryEnabled = document.queryCommandEnabled('copy');
      commandResult = document.execCommand('copy');
    } catch (error) {
      queryEnabled = false;
      commandResult = false;
    }

    window.__copyProbe = { fired: false, text: '' };
    window.__copyProbe.listener = () => {
      window.__copyProbe.fired = true;
      window.__copyProbe.text = String(window.getSelection());
    };
    document.addEventListener('copy', window.__copyProbe.listener, true);

    return {
      text,
      userSelect: style.userSelect || style.webkitUserSelect,
      syntheticPrevented: synthetic.defaultPrevented,
      queryEnabled,
      commandResult
    };
  })()`);

  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2,
    key: 'c',
    code: 'KeyC',
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67,
    commands: ['copy']
  }).catch(() => {});
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    key: 'c',
    code: 'KeyC',
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67
  }).catch(() => {});
  await sleep(200);

  const keyCopy = await evaluate(`(async () => {
    let clip = null;
    let clipError = null;
    try {
      clip = await navigator.clipboard.readText();
    } catch (error) {
      clipError = error.name + ': ' + error.message;
    }
    const probe = window.__copyProbe || { fired: false, text: '' };
    if (probe.listener) {
      document.removeEventListener('copy', probe.listener, true);
      delete probe.listener;
    }
    return {
      fired: probe.fired,
      text: probe.text,
      clip,
      clipError,
      hasFocus: document.hasFocus()
    };
  })()`, { awaitPromise: true });

  check('正文文本可被选中', selection.text.length > 0, JSON.stringify(selection.text));
  check('正文 user-select 为 text', selection.userSelect === 'text', selection.userSelect);
  check('阅读器未拦截 copy 事件', selection.syntheticPrevented === false, JSON.stringify(selection));
  check('Ctrl+C 可触发复制路径', keyCopy.fired || selection.commandResult,
    JSON.stringify({ keyCopy, commandResult: selection.commandResult, queryEnabled: selection.queryEnabled }));

  if (keyCopy.clip) {
    check('剪贴板内容与选区一致',
      keyCopy.clip.includes(selection.text) || keyCopy.text.includes(selection.text),
      JSON.stringify(keyCopy));
  } else if (keyCopy.fired) {
    results.notes.push('Ctrl+C 已触发 copy 事件，但 headless 环境无法读取系统剪贴板（' + (keyCopy.clipError || '无内容') + '）。');
  } else {
    results.notes.push('headless 环境未能执行系统剪贴板复制；已验证选区、user-select 与 copy 事件未被拦截。');
  }
  await evaluate('window.getSelection().removeAllRanges()');

  section('5. 翻页 / 页码 / 缩放 / 侧栏');
  const nav = await evaluate(`(() => {
    const total = MDV.pageCount();
    MDV.goToPage(2);
    const a = {
      current: MDV.state.current,
      footer: document.querySelector('#pageZoom .footer-num').textContent,
      input: document.getElementById('pageInput').value
    };
    document.querySelectorAll('.thumb')[0].click();
    const b = {
      current: MDV.state.current,
      activeThumb: document.querySelector('.thumb.active').dataset.page
    };
    document.getElementById('nextPage').click();
    const c = { current: MDV.state.current };
    const targetPage = Math.min(4, total);
    document.getElementById('pageInput').value = String(targetPage);
    document.getElementById('pageInput').dispatchEvent(new Event('change', { bubbles: true }));
    const d = {
      current: MDV.state.current,
      input: document.getElementById('pageInput').value,
      targetPage
    };
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const e = { current: MDV.state.current, expected: Math.min(targetPage, total - 1) };
    return { a, b, c, d, e, total };
  })()`);
  check('跳到第 3 页', nav.a.current === 2 && nav.a.footer.startsWith('3 / ') && nav.a.input === '3', JSON.stringify(nav.a));
  check('点击缩略图跳页', nav.b.current === 0 && nav.b.activeThumb === '0', JSON.stringify(nav.b));
  check('下一页按钮生效', nav.c.current === 1, JSON.stringify(nav.c));
  check('页码输入生效',
    nav.d.current === nav.d.targetPage - 1 && nav.d.input === String(nav.d.targetPage),
    JSON.stringify(nav.d));
  check('方向键翻页生效', nav.e.current === nav.e.expected, JSON.stringify(nav.e));

  const zoom = await evaluate(`(() => {
    MDV.goToPage(0);
    document.getElementById('zoomLabel').click();
    const fit = { mode: MDV.state.zoomMode, scale: MDV.state.scale, label: document.getElementById('zoomLabel').textContent };
    document.getElementById('zoomIn').click();
    const zoomed = { mode: MDV.state.zoomMode, scale: MDV.state.scale, label: document.getElementById('zoomLabel').textContent };
    const frame = document.getElementById('pageFrame').getBoundingClientRect();
    document.getElementById('zoomLabel').click();
    const back = { mode: MDV.state.zoomMode, scale: MDV.state.scale };
    return { fit, zoomed, back, frameWidth: Math.round(frame.width), expected: Math.round(MDV.PAGE.w * zoomed.scale) };
  })()`);
  check('默认适应窗口', zoom.fit.mode === 'fit' && zoom.fit.scale > 0, JSON.stringify(zoom.fit));
  check('放大进入手动缩放', zoom.zoomed.mode !== 'fit' && zoom.zoomed.scale > zoom.fit.scale, JSON.stringify(zoom.zoomed));
  check('纸张尺寸随缩放变化', Math.abs(zoom.frameWidth - zoom.expected) <= 2, JSON.stringify(zoom));
  check('点击百分比恢复适应窗口', zoom.back.mode === 'fit', JSON.stringify(zoom.back));

  const sidebar = await evaluate(`(() => {
    const before = document.getElementById('stage').getBoundingClientRect().width;
    document.getElementById('collapseSidebar').click();
    const after = document.getElementById('stage').getBoundingClientRect().width;
    const expandVisible = !document.getElementById('expandSidebar').hidden;
    document.getElementById('expandSidebar').click();
    const restored = document.getElementById('stage').getBoundingClientRect().width;
    return { before: Math.round(before), after: Math.round(after), restored: Math.round(restored), expandVisible };
  })()`);
  check('侧栏收起后阅读区变宽', sidebar.after > sidebar.before, JSON.stringify(sidebar));
  check('侧栏可重新展开', sidebar.expandVisible && sidebar.restored <= sidebar.before + 2, JSON.stringify(sidebar));

  section('6. 真实文件选择（UTF-8）');
  await navigate(fileUrl('index.html'));
  await openFixtureViaInput('阅读器验收文档.md');
  await waitFor(async () => {
    return evaluate('MDV.state.name === "阅读器验收文档.md" && MDV.state.pages.length >= 2');
  }, 15000, '通过文件选择打开验收文档');
  const fileOpen = await evaluate(`(() => ({
    name: MDV.state.name,
    pages: MDV.pageCount(),
    empty: document.body.classList.contains('is-empty'),
    docTitle: document.getElementById('docTitle').textContent,
    firstPageText: document.querySelector('#pageZoom .page-body').textContent.slice(0, 40),
    thumbs: document.querySelectorAll('.thumb').length
  }))()`);
  check('文件选择后进入阅读状态', !fileOpen.empty && fileOpen.pages >= 2, JSON.stringify(fileOpen));
  check('文档名传递正确', fileOpen.docTitle === '阅读器验收文档.md', fileOpen.docTitle);
  check('正文渲染正确', fileOpen.firstPageText.includes('验收文档'), fileOpen.firstPageText);
  check('缩略图随文档生成', fileOpen.thumbs === fileOpen.pages, fileOpen.thumbs + ' / ' + fileOpen.pages);
  await screenshot('打开验收文档');

  const fileSearch = await evaluate(`(() => {
    const hits = MDV.search('阅读');
    return {
      hits,
      current: MDV.state.current,
      active: CSS.highlights.has('mdv-search-active'),
      count: document.getElementById('searchCount').textContent
    };
  })()`);
  check('验收文档可搜索', fileSearch.hits > 0, JSON.stringify(fileSearch));
  check('验收文档搜索高亮', fileSearch.active || fileSearch.hits === 0);

  section('7. GB18030 解码');
  await navigate(fileUrl('index.html'));
  await openFixtureViaInput('编码测试.md');
  await waitFor(async () => {
    return evaluate('MDV.state.name === "编码测试.md" && MDV.state.pages.length >= 1');
  }, 15000, '通过文件选择打开 GB18030 文档');
  const gb = await evaluate(`(() => {
    const text = document.querySelector('#pageZoom .page-body').textContent;
    return {
      hasTitle: text.includes('编码测试'),
      hasChinese: text.includes('编码兜底生效'),
      replacement: (text.match(/\\uFFFD/g) || []).length,
      pages: MDV.pageCount(),
      sample: text.slice(0, 60)
    };
  })()`);
  check('GB18030 中文正常显示', gb.hasTitle && gb.hasChinese, JSON.stringify(gb));
  check('GB18030 无替换字符', gb.replacement === 0, String(gb.replacement));

  section('8. 超长代码块按行拆分');
  const longCode = await fs.readFile(path.join(FIXTURES, '长代码块.md'), 'utf8');
  const split = await evaluate(`(async () => {
    await MDV.openText('长代码块.md', ${JSON.stringify(longCode)});
    const pages = MDV.state.pages;
    const allText = pages.map((page) => page.body.textContent).join('\\n');
    const metrics = MDV.pageMetrics();
    MDV.goToPage(0);
    return {
      pages: pages.length,
      overflowCount: pages.filter((page) => page.overflow).length,
      hasFirst: allText.includes('line 001'),
      hasLast: allText.includes('line 150'),
      afterText: pages[pages.length - 1].body.textContent.slice(-80),
      stats: document.getElementById('statusStats').textContent,
      allFit: metrics.every((item) => item.overflow || item.scrollHeight <= item.clientHeight + 2),
      codePages: pages.filter((page) => !!page.body.querySelector('pre')).length
    };
  })()`, { awaitPromise: true });
  check('超长代码块被拆分到多页', split.codePages >= 2 && split.pages >= 3, JSON.stringify(split));
  check('代码首行与末行都保留', split.hasFirst && split.hasLast, JSON.stringify(split));
  check('拆分后各页不裁切', split.allFit, JSON.stringify(split));
  check('代码块之后正文仍在', split.afterText.includes('阅读器会把超长代码块按行拆分到多页'), split.afterText);
  check('拆分页不触发溢出告警', !split.stats.includes('含长内容'), split.stats);
  await sleep(150);
  await screenshot('超长代码块拆分');

  section('9. 超高单块兜底（页内滚动）');
  const giantContent = '# 超高段落\n\n' + '排版测试。'.repeat(320);
  const giant = await evaluate(`(async () => {
    await MDV.openText('超高段落.md', ${JSON.stringify(giantContent)});
    const pages = MDV.state.pages;
    const index = pages.findIndex((page) => page.overflow);
    if (index >= 0) MDV.goToPage(index);
    const page = index >= 0 ? pages[index] : null;
    return {
      pages: pages.length,
      overflowCount: pages.filter((item) => item.overflow).length,
      index,
      className: page ? page.body.className : '',
      scrollHeight: page ? page.body.scrollHeight : 0,
      clientHeight: page ? page.body.clientHeight : 0,
      stats: document.getElementById('statusStats').textContent
    };
  })()`, { awaitPromise: true });
  check('超高单块落入页内滚动兜底',
    giant.overflowCount >= 1 && giant.className.includes('has-overflow') && giant.scrollHeight > giant.clientHeight,
    JSON.stringify(giant));
  check('兜底页在状态栏提示含长内容', giant.stats.includes('含长内容'), giant.stats);

  section('10. 安全清洗');
  const xssMarkdown = [
    '# 安全测试',
    '',
    '<script>window.__pwned = 1;</script>',
    '',
    '<img src="x" onerror="window.__pwned = 2;">',
    '',
    '<div onclick="window.__pwned = 3;">click</div>',
    '',
    '[bad](javascript:window.__pwned=4)',
    '',
    '<a href="java&#10;script:window.__pwned=6">bad2</a>',
    '',
    '<a href="data:text/html,<script>window.__pwned=7</script>">bad3</a>',
    '',
    '<iframe src="javascript:window.__pwned=5"></iframe>'
  ].join('\n');
  const security = await evaluate(`(async () => {
    await MDV.openText('安全测试.md', ${JSON.stringify(xssMarkdown)});
    return {
      pwned: window.__pwned,
      scripts: document.querySelectorAll('.page script').length,
      iframes: document.querySelectorAll('.page iframe').length,
      eventAttrs: document.querySelectorAll('.page [onclick], .page [onerror]').length,
      badHref: (() => {
        const link = Array.from(document.querySelectorAll('.page a')).find((item) => item.textContent === 'bad');
        return link ? link.getAttribute('href') : null;
      })(),
      unsafeHrefs: Array.from(document.querySelectorAll('.page a[href]'))
        .map((item) => item.getAttribute('href'))
        .filter((href) => /^(?:javascript|vbscript|data:)/i.test(href.replace(/[\\u0000-\\u0020]+/g, ''))),
      pages: MDV.pageCount()
    };
  })()`, { awaitPromise: true });
  check('脚本标签被移除', security.pwned === undefined && security.scripts === 0, JSON.stringify(security));
  check('iframe 被移除', security.iframes === 0, JSON.stringify(security));
  check('事件属性被移除', security.eventAttrs === 0, JSON.stringify(security));
  check('javascript: 链接被移除',
    security.badHref === null && security.unsafeHrefs.length === 0,
    JSON.stringify({ badHref: security.badHref, unsafeHrefs: security.unsafeHrefs }));

  section('11. 空白文档与无命中搜索');
  const edge = await evaluate(`(async () => {
    await MDV.openText('空白.md', '');
    const emptyPlaceholder = !!document.querySelector('.empty-doc');
    const hits = MDV.search('绝对不存在的词组-XYZ');
    return {
      pages: MDV.pageCount(),
      emptyPlaceholder,
      hits,
      countText: document.getElementById('searchCount').textContent,
      prevDisabled: document.getElementById('searchPrev').disabled,
      nextDisabled: document.getElementById('searchNext').disabled,
      countHidden: document.getElementById('searchCount').hidden,
      highlights: CSS.highlights.has('mdv-search') || CSS.highlights.has('mdv-search-active')
    };
  })()`, { awaitPromise: true });
  check('空白文档生成 1 页占位', edge.pages === 1 && edge.emptyPlaceholder, JSON.stringify(edge));
  check('无命中显示 0 / 0', edge.hits === 0 && edge.countText === '0 / 0', edge.countText);
  check('无命中禁用切换按钮', edge.prevDisabled && edge.nextDisabled);
  check('无命中不产生高亮', !edge.highlights);

  section('12. 单文件产物（若已生成）');
  const single = path.join(ROOT, 'Markdown阅读器.html');
  if (await fileExists(single)) {
    await navigate(pathToFileURL(single).href + '?demo=1');
    await waitFor(async () => evaluate('MDV.state.pages.length >= 3'), 15000, '单文件版分页');
    const singleInfo = await evaluate(`(() => ({
      pages: MDV.pageCount(),
      name: MDV.state.name,
      thumbs: document.querySelectorAll('.thumb').length,
      search: MDV.search('分页'),
      active: CSS.highlights.has('mdv-search-active')
    }))()`);
    check('单文件版可独立运行', singleInfo.pages >= 3 && singleInfo.thumbs === singleInfo.pages, JSON.stringify(singleInfo));
    check('单文件版搜索可用', singleInfo.search > 0 && singleInfo.active, JSON.stringify(singleInfo));

    const singleFeatures = await evaluate(`(() => {
      const outlineItems = document.querySelectorAll('.outline-item').length;
      document.getElementById('tabOutline').click();
      const outlineMode = MDV.state.sidebarMode === 'outline' && !document.getElementById('outline').hidden;
      document.getElementById('collapseSidebar').click();
      const continuous = MDV.state.layout === 'continuous' &&
        document.querySelectorAll('.continuous-page').length === MDV.pageCount();
      document.getElementById('expandSidebar').click();
      document.getElementById('tabPages').click();
      return {
        version: MDV.version,
        outlineItems,
        outlineMode,
        continuous,
        layout: MDV.state.layout
      };
    })()`);
    check('单文件版包含大纲与连续模式',
      singleFeatures.version === '1.3.0' && singleFeatures.outlineItems > 0 &&
      singleFeatures.outlineMode && singleFeatures.continuous && singleFeatures.layout === 'single',
      JSON.stringify(singleFeatures));
    await sleep(150);
    await screenshot('单文件版');
  } else {
    results.notes.push('未找到 Markdown阅读器.html，跳过单文件版测试。');
  }

  section('13. 文档大纲');
  await navigate(fileUrl('index.html') + '?demo=1');
  await waitFor(async () => evaluate('MDV.state.pages.length >= 3'), 15000, '大纲测试文档分页');
  await sleep(150);

  const outline = await evaluate(`(() => {
    document.getElementById('tabOutline').click();
    const items = Array.from(document.querySelectorAll('#outline .outline-item'));
    const levels = Array.from(new Set(items.map((item) => {
      const levelClass = item.className.split(' ').find((name) => name.indexOf('level-') === 0);
      return levelClass ? levelClass.slice(6) : '';
    })));
    return {
      mode: MDV.state.sidebarMode,
      outlineVisible: !document.getElementById('outline').hidden,
      thumbsHidden: document.getElementById('thumbs').hidden,
      count: items.length,
      stateCount: MDV.state.outline.length,
      badge: document.getElementById('sidebarCount').textContent,
      levels,
      first: items[0] ? {
        text: items[0].querySelector('.outline-text').textContent,
        page: items[0].dataset.page
      } : null
    };
  })()`);

  check('切换到文档大纲模式', outline.mode === 'outline' && outline.outlineVisible && outline.thumbsHidden,
    JSON.stringify(outline));
  check('大纲列出标题并带层级', outline.count > 0 && outline.count === outline.stateCount &&
    outline.levels.includes('1') && outline.levels.includes('2'),
    JSON.stringify({ count: outline.count, levels: outline.levels, badge: outline.badge }));
  check('大纲首项有标题与页码', !!outline.first && !!outline.first.text && outline.first.page === '0',
    JSON.stringify(outline.first));

  const outlineJump = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('#outline .outline-item'));
    const target = items.slice().reverse().find((item) => Number(item.dataset.page) >= 2) || items[items.length - 1];
    const expectedPage = Number(target.dataset.page);
    const expectedIndex = Number(target.dataset.index);
    target.click();
    return {
      expectedPage,
      expectedIndex,
      current: MDV.state.current,
      input: document.getElementById('pageInput').value,
      footer: document.querySelector('#pageZoom .footer-num').textContent,
      activeIndex: MDV.state.outlineActive,
      activeCount: document.querySelectorAll('#outline .outline-item.active').length
    };
  })()`);

  check('点击大纲定位到对应页',
    outlineJump.current === outlineJump.expectedPage &&
    outlineJump.activeIndex === outlineJump.expectedIndex &&
    outlineJump.input === String(outlineJump.expectedPage + 1) &&
    outlineJump.footer.startsWith(String(outlineJump.expectedPage + 1) + ' / '),
    JSON.stringify(outlineJump));
  check('大纲当前项高亮', outlineJump.activeCount === 1, String(outlineJump.activeCount));

  await sleep(150);
  await screenshot('大纲模式');

  const outlineCollapse = await evaluate(`(() => {
    document.getElementById('collapseSidebar').click();
    return {
      layout: MDV.state.layout,
      sidebarHidden: document.getElementById('sidebar').hidden,
      expandVisible: !document.getElementById('expandSidebar').hidden,
      stackPages: document.querySelectorAll('.continuous-page').length,
      mode: MDV.state.sidebarMode
    };
  })()`);
  check('大纲收起后进入连续滚动',
    outlineCollapse.layout === 'continuous' && outlineCollapse.sidebarHidden &&
    outlineCollapse.expandVisible && outlineCollapse.stackPages === (await evaluate('MDV.pageCount()')),
    JSON.stringify(outlineCollapse));

  await sleep(150);
  const outlineExpand = await evaluate(`(() => {
    document.getElementById('expandSidebar').click();
    return {
      layout: MDV.state.layout,
      mode: MDV.state.sidebarMode,
      outlineVisible: !document.getElementById('outline').hidden,
      thumbsHidden: document.getElementById('thumbs').hidden
    };
  })()`);
  check('展开后仍是文档大纲',
    outlineExpand.layout === 'single' && outlineExpand.mode === 'outline' && outlineExpand.outlineVisible,
    JSON.stringify(outlineExpand));

  const backToPages = await evaluate(`(() => {
    document.getElementById('tabPages').click();
    return {
      mode: MDV.state.sidebarMode,
      thumbsVisible: !document.getElementById('thumbs').hidden,
      outlineHidden: document.getElementById('outline').hidden
    };
  })()`);
  check('可切回页面预览', backToPages.mode === 'pages' && backToPages.thumbsVisible && backToPages.outlineHidden,
    JSON.stringify(backToPages));

  section('14. 连续滚动与滚轮翻页');
  await evaluate('MDV.goToPage(0)');
  await sleep(100);
  const continuous = await evaluate(`(() => {
    document.getElementById('collapseSidebar').click();
    return {
      layout: MDV.state.layout,
      pages: MDV.pageCount(),
      stackPages: document.querySelectorAll('.continuous-page').length,
      pageFrameHidden: document.getElementById('pageFrame').hidden,
      stackVisible: !document.getElementById('continuousStack').hidden,
      sidebarHidden: document.getElementById('sidebar').hidden,
      scrollable: (() => {
        const stage = document.getElementById('stageScroll');
        return stage.scrollHeight > stage.clientHeight + 1;
      })()
    };
  })()`);
  check('收起预览进入连续纸面模式',
    continuous.layout === 'continuous' && continuous.stackPages === continuous.pages &&
    continuous.pageFrameHidden && continuous.stackVisible && continuous.sidebarHidden,
    JSON.stringify(continuous));
  check('连续模式滚动条可滚动', continuous.scrollable, JSON.stringify(continuous));

  await sleep(250);
  await screenshot('连续滚动模式');

  const continuousScroll = await evaluate(`(() => {
    const wraps = document.querySelectorAll('.continuous-page');
    const stage = document.getElementById('stageScroll');
    const wrap = wraps[2];
    const stageRect = stage.getBoundingClientRect();
    const rect = wrap.getBoundingClientRect();
    stage.scrollTop += rect.top - stageRect.top - 26;
    return { target: 2, scrollTop: Math.round(stage.scrollTop) };
  })()`);
  await sleep(350);
  const continuousCurrent = await evaluate(`(() => ({
    current: MDV.state.current,
    input: document.getElementById('pageInput').value,
    activeThumb: document.querySelectorAll('.thumb.active').length
  }))()`);
  check('连续滚动同步当前页',
    continuousCurrent.current === continuousScroll.target &&
    continuousCurrent.input === String(continuousScroll.target + 1),
    JSON.stringify({ continuousScroll, continuousCurrent }));

  const continuousNext = await evaluate(`(() => {
    document.getElementById('nextPage').click();
    return { current: MDV.state.current, input: document.getElementById('pageInput').value };
  })()`);
  check('连续模式下一页按钮生效', continuousNext.current === 3 && continuousNext.input === '4',
    JSON.stringify(continuousNext));

  const continuousSearch = await evaluate(`(() => {
    const hits = MDV.search('分页');
    return {
      hits,
      active: CSS.highlights.has('mdv-search-active'),
      all: CSS.highlights.has('mdv-search'),
      current: MDV.state.current
    };
  })()`);
  check('连续模式搜索与高亮可用',
    continuousSearch.hits > 0 && continuousSearch.active,
    JSON.stringify(continuousSearch));

  await evaluate('MDV.clearSearch(); MDV.goToPage(2)');
  await sleep(200);
  const continuousExpand = await evaluate(`(() => {
    document.getElementById('expandSidebar').click();
    return {
      layout: MDV.state.layout,
      current: MDV.state.current,
      pageFrameVisible: !document.getElementById('pageFrame').hidden,
      stackHidden: document.getElementById('continuousStack').hidden,
      footer: document.querySelector('#pageZoom .footer-num').textContent
    };
  })()`);
  check('展开预览回到当前单页',
    continuousExpand.layout === 'single' && continuousExpand.current === 2 &&
    continuousExpand.pageFrameVisible && continuousExpand.stackHidden &&
    continuousExpand.footer.startsWith('3 / '),
    JSON.stringify(continuousExpand));

  await evaluate('MDV.goToPage(0)');
  await sleep(100);
  const wheelDown = await evaluate(`(() => {
    const stage = document.getElementById('stageScroll');
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    const allowed = stage.dispatchEvent(event);
    return { current: MDV.state.current, cancelled: !allowed };
  })()`);
  check('单页底部继续下滚翻到下一页', wheelDown.current === 1 && wheelDown.cancelled,
    JSON.stringify(wheelDown));

  await sleep(900);
  const wheelUp = await evaluate(`(() => {
    const stage = document.getElementById('stageScroll');
    const event = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
    const allowed = stage.dispatchEvent(event);
    return { current: MDV.state.current, cancelled: !allowed };
  })()`);
  check('单页顶部继续上滚回到上一页', wheelUp.current === 0 && wheelUp.cancelled,
    JSON.stringify(wheelUp));

  await sleep(900);
  const wheelLast = await evaluate(`(() => {
    MDV.goToPage(MDV.pageCount() - 1);
    const stage = document.getElementById('stageScroll');
    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    const allowed = stage.dispatchEvent(event);
    return {
      current: MDV.state.current,
      last: MDV.pageCount() - 1,
      cancelled: !allowed
    };
  })()`);
  check('末页继续下滚不越界', wheelLast.current === wheelLast.last, JSON.stringify(wheelLast));

  section('15. 打印版式');
  const printButton = await evaluate(`(() => ({
    visible: !document.getElementById('topbarControls').hidden &&
      !!document.getElementById('printBtn') &&
      document.getElementById('printBtn').offsetParent !== null,
    title: document.getElementById('printBtn').title
  }))()`);
  check('工具栏显示打印按钮', printButton.visible && /打印/.test(printButton.title),
    JSON.stringify(printButton));

  const prepared = await evaluate(`(() => {
    MDV.preparePrint();
    const sheets = Array.from(document.querySelectorAll('#printRoot .print-sheet'));
    return {
      sheets: sheets.length,
      pages: MDV.pageCount(),
      pageCount: document.querySelectorAll('#printRoot .print-sheet .page').length,
      screenDisplay: getComputedStyle(document.getElementById('printRoot')).display
    };
  })()`);
  check('打印准备生成逐页纸张',
    prepared.sheets === prepared.pages && prepared.pageCount === prepared.pages,
    JSON.stringify(prepared));
  check('打印容器在屏幕上隐藏', prepared.screenDisplay === 'none', prepared.screenDisplay);

  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(100);
  const printStyle = await evaluate(`(() => {
    const root = document.getElementById('printRoot');
    const sheet = document.querySelector('#printRoot .print-sheet');
    const page = document.querySelector('#printRoot .print-sheet .page');
    return {
      rootDisplay: getComputedStyle(root).display,
      topbarDisplay: getComputedStyle(document.querySelector('.topbar')).display,
      sheetWidth: parseFloat(getComputedStyle(sheet).width),
      sheetHeight: parseFloat(getComputedStyle(sheet).height),
      pageWidth: parseFloat(getComputedStyle(page).width),
      pageHeight: parseFloat(getComputedStyle(page).height)
    };
  })()`);
  check('打印媒体隐藏应用界面', printStyle.rootDisplay === 'block' && printStyle.topbarDisplay === 'none',
    JSON.stringify(printStyle));
  check('打印纸张为 A4、正文页为 760px',
    printStyle.sheetWidth > 780 && printStyle.sheetWidth < 810 &&
    printStyle.sheetHeight > 1100 && printStyle.pageWidth === 760 && printStyle.pageHeight === 1075,
    JSON.stringify(printStyle));
  await sleep(100);
  await screenshot('打印版式');
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
  await evaluate('MDV.clearPrint()');

  const giantPrintText = '# 超高段落\n\n' + '打印溢出测试。'.repeat(320);
  const printOverflow = await evaluate(`(async () => {
    await MDV.openText('打印溢出测试.md', ${JSON.stringify(giantPrintText)});
    MDV.preparePrint();
    const overflowSheet = document.querySelector('#printRoot .print-sheet.is-overflow');
    return {
      pages: MDV.pageCount(),
      overflowSheets: document.querySelectorAll('#printRoot .print-sheet.is-overflow').length,
      hasSheet: !!overflowSheet
    };
  })()`, { awaitPromise: true });
  check('溢出页使用可延展打印纸', printOverflow.overflowSheets >= 1, JSON.stringify(printOverflow));

  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  const overflowStyle = await evaluate(`(() => {
    const sheet = document.querySelector('#printRoot .print-sheet.is-overflow');
    const body = sheet ? sheet.querySelector('.page-body') : null;
    const page = sheet ? sheet.querySelector('.page') : null;
    return {
      sheetHeight: sheet ? getComputedStyle(sheet).height : '',
      bodyOverflow: body ? getComputedStyle(body).overflow : '',
      pageOverflow: page ? getComputedStyle(page).overflow : ''
    };
  })()`);
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
  check('溢出页打印时内容不被裁切',
    overflowStyle.bodyOverflow === 'visible' && overflowStyle.pageOverflow === 'visible',
    JSON.stringify(overflowStyle));

  const printCleared = await evaluate(`(() => {
    MDV.clearPrint();
    return { children: document.getElementById('printRoot').childElementCount };
  })()`);
  check('打印结束清理临时纸张', printCleared.children === 0, JSON.stringify(printCleared));

  section('16. 显示模式与偏好');
  await navigate(fileUrl('index.html') + '?demo=1');
  await waitFor(async () => evaluate('MDV.state.pages.length >= 3'), 15000, '显示模式测试文档分页');

  const modes = await evaluate(`(() => {
    const stage = document.getElementById('stageScroll');
    const frame = document.getElementById('pageFrame');
    const saved = () => localStorage.getItem('moyue.view-mode.v1');
    document.getElementById('modeWidth').click();
    const width = {
      mode: MDV.state.zoomMode,
      saved: saved(),
      scale: MDV.state.scale,
      frame: Math.round(frame.getBoundingClientRect().width),
      expected: Math.round(stage.clientWidth - 80),
      active: document.querySelector('.view-mode.active')?.id
    };
    document.getElementById('modeActual').click();
    const actual = {
      mode: MDV.state.zoomMode,
      saved: saved(),
      scale: MDV.state.scale,
      frame: Math.round(frame.getBoundingClientRect().width),
      active: document.querySelector('.view-mode.active')?.id
    };
    document.getElementById('modePage').click();
    const page = {
      mode: MDV.state.zoomMode,
      saved: saved(),
      scale: MDV.state.scale,
      frame: Math.round(frame.getBoundingClientRect().width),
      active: document.querySelector('.view-mode.active')?.id
    };
    return { width, actual, page };
  })()`);

  check('满宽显示铺满阅读区', modes.width.mode === 'width' && modes.width.active === 'modeWidth' &&
    Math.abs(modes.width.frame - modes.width.expected) <= 2 && modes.width.saved === 'width',
    JSON.stringify(modes.width));
  check('1:1 显示为 100%', modes.actual.mode === 'actual' && modes.actual.active === 'modeActual' &&
    modes.actual.scale === 1 && modes.actual.frame === 760 && modes.actual.saved === 'actual',
    JSON.stringify(modes.actual));
  check('整页显示为默认适配', modes.page.mode === 'fit' && modes.page.active === 'modePage' &&
    modes.page.frame < 760 && modes.page.saved === 'fit',
    JSON.stringify(modes.page));

  await evaluate(`document.getElementById('modeWidth').click()`);
  await sleep(150);
  await screenshot('满宽显示');

  const preference = await evaluate(`(async () => {
    document.getElementById('modeWidth').click();
    document.getElementById('zoomIn').click();
    const manual = {
      mode: MDV.state.zoomMode,
      saved: localStorage.getItem('moyue.view-mode.v1'),
      active: document.querySelectorAll('.view-mode.active').length
    };
    await MDV.openText('偏好测试.md', '# 偏好测试\\n\\n' + '内容。'.repeat(300));
    return {
      manual,
      reopenedMode: MDV.state.zoomMode,
      reopenedSaved: localStorage.getItem('moyue.view-mode.v1'),
      reopenedScale: MDV.state.scale,
      active: document.querySelector('.view-mode.active')?.id,
      frame: Math.round(document.getElementById('pageFrame').getBoundingClientRect().width)
    };
  })()`, { awaitPromise: true });
  check('手动缩放不覆盖显示偏好', preference.manual.saved === 'width' &&
    preference.manual.active === 0 && preference.manual.mode !== 'width',
    JSON.stringify(preference.manual));
  check('再次打开文件沿用满宽偏好', preference.reopenedMode === 'width' &&
    preference.reopenedSaved === 'width' && preference.active === 'modeWidth' &&
    preference.reopenedScale > 1,
    JSON.stringify(preference));

  await evaluate(`document.getElementById('modePage').click()`);
}

async function main() {
  console.log('Markdown 阅读器自动化测试');
  console.log('Edge:', EDGE);
  console.log('Root:', ROOT);

  try {
    await launchBrowser();
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails || {};
      const text = details.exception && details.exception.description
        ? details.exception.description
        : details.text || 'unknown exception';
      pageErrors.push(text);
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = (params.args || []).map((arg) => arg.value || arg.description || '').join(' ');
        if (text) pageErrors.push('console.error: ' + text);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    try {
      await cdp.send('Browser.grantPermissions', {
        origin: 'file://',
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      });
    } catch (error) {
      results.notes.push('未授予文件源剪贴板权限（' + error.message + '），复制测试按环境能力降级。');
    }

    await runTests();

    section('浏览器异常');
    const meaningfulErrors = pageErrors.filter((text) =>
      !/favicon|net::ERR_FILE_NOT_FOUND|Failed to load resource/i.test(text)
    );
    check('无未捕获的页面异常', meaningfulErrors.length === 0, meaningfulErrors.slice(0, 3).join(' | '));
  } catch (error) {
    results.failed += 1;
    results.failures.push({ name: '测试执行中断', detail: error.stack || error.message });
    console.error('\n测试执行中断：', error.stack || error.message);
  } finally {
    if (cdp) cdp.close();
    if (browser && browser.child && browser.child.pid) {
      spawnSync('taskkill', ['/PID', String(browser.child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    if (browser && browser.profile) {
      await sleep(300);
      await fs.rm(browser.profile, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log('\n==========================================');
  console.log('通过：' + results.passed + '　失败：' + results.failed);
  for (const failure of results.failures) {
    console.log(' - ' + failure.name + (failure.detail ? '：' + failure.detail : ''));
  }
  for (const note of results.notes) console.log(' 注：' + note);
  console.log('==========================================');

  if (results.failed > 0) process.exitCode = 1;
}

main();
