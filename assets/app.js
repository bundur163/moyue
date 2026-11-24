/* ==========================================================================
   Markdown 阅读器 — 应用逻辑
   无构建依赖；双击 index.html 即可运行。
   ========================================================================== */

/* global marked */

(function () {
  'use strict';

  const MAX_HITS = 5000;
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2;
  const FIT_MAX = 1.25;
  const HIGHLIGHT_ALL = 'mdv-search';
  const HIGHLIGHT_ACTIVE = 'mdv-search-active';

  const state = {
    ready: false,
    name: '',
    pages: [],
    current: 0,
    hits: [],
    hitIndex: -1,
    query: '',
    scale: 1,
    zoomMode: 'fit',
    token: 0,
    charCount: 0,
    sidebarMode: 'pages',
    collapsed: false,
    layout: 'single',
    outline: [],
    outlineActive: -1,
    ignoreContinuousScroll: false
  };

  const PAGE = { w: 0, h: 0, contentH: 0 };
  const el = {};

  let searchTimer = 0;
  let toastTimer = 0;
  let dragDepth = 0;
  let thumbResizeFrame = 0;
  let continuousSyncFrame = 0;
  let wheelAccum = 0;
  let wheelDirection = 0;
  let wheelResetTimer = 0;
  let lastWheelTurn = 0;

  init();

  /* ------------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------------ */

  function init() {
    cacheElements();
    measurePage();
    bindEvents();
    exposeApi();
    state.ready = true;

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      const demo = getDemoSource();
      if (demo) openText('示例文档.md', demo);
    }
  }

  function cacheElements() {
    const ids = [
      'docTitle', 'docBadge', 'topbarControls', 'searchBox', 'searchInput',
      'searchCount', 'searchPrev', 'searchNext', 'searchClear', 'prevPage',
      'nextPage', 'pageInput', 'pageTotal', 'zoomOut', 'zoomIn', 'zoomLabel',
      'openBtn', 'fileInput', 'emptyOpenBtn', 'demoBtn', 'sidebar',
      'sidebarCount', 'thumbs', 'outline', 'tabPages', 'tabOutline',
      'collapseSidebar', 'expandSidebar', 'stage', 'stageScroll', 'stageInner',
      'emptyState', 'dropCard', 'pageFrame', 'pageZoom', 'continuousStack',
      'statusHint', 'statusStats', 'dropOverlay', 'measureHost', 'toast',
      'printBtn', 'printRoot'
    ];
    for (const id of ids) el[id] = document.getElementById(id);
  }

  function measurePage() {
    const probe = document.createElement('div');
    probe.className = 'page';
    probe.innerHTML = '<div class="page-body"></div>';
    el.measureHost.appendChild(probe);
    PAGE.w = probe.getBoundingClientRect().width;
    PAGE.h = probe.getBoundingClientRect().height;
    PAGE.contentH = probe.querySelector('.page-body').clientHeight;
    probe.remove();
    if (!PAGE.w || !PAGE.h || !PAGE.contentH) {
      PAGE.w = 760;
      PAGE.h = 1075;
      PAGE.contentH = 919;
    }
  }

  function bindEvents() {
    const pickFile = () => el.fileInput.click();

    el.openBtn.addEventListener('click', pickFile);
    el.emptyOpenBtn.addEventListener('click', pickFile);
    el.fileInput.addEventListener('change', () => {
      const file = el.fileInput.files && el.fileInput.files[0];
      el.fileInput.value = '';
      if (file) openFile(file);
    });

    el.demoBtn.addEventListener('click', () => {
      const demo = getDemoSource();
      if (demo) openText('示例文档.md', demo);
    });

    el.prevPage.addEventListener('click', () => goToPage(state.current - 1));
    el.nextPage.addEventListener('click', () => goToPage(state.current + 1));

    el.pageInput.addEventListener('focus', () => el.pageInput.select());
    el.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPageInput();
      }
    });
    el.pageInput.addEventListener('change', commitPageInput);
    el.pageInput.addEventListener('blur', commitPageInput);

    el.zoomOut.addEventListener('click', () => stepZoom(-0.1));
    el.zoomIn.addEventListener('click', () => stepZoom(0.1));
    el.zoomLabel.addEventListener('click', () => {
      state.zoomMode = 'fit';
      applyZoom();
    });

    el.printBtn.addEventListener('click', printDocument);
    window.addEventListener('beforeprint', preparePrint);
    window.addEventListener('afterprint', clearPrint);

    el.collapseSidebar.addEventListener('click', () => setSidebarCollapsed(true));
    el.expandSidebar.addEventListener('click', () => setSidebarCollapsed(false));
    el.tabPages.addEventListener('click', () => setSidebarMode('pages'));
    el.tabOutline.addEventListener('click', () => setSidebarMode('outline'));

    el.stageScroll.addEventListener('scroll', onStageScroll, { passive: true });
    el.stageScroll.addEventListener('wheel', onStageWheel, { passive: false });

    el.searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => runSearch(el.searchInput.value), 150);
    });
    el.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (state.hits.length) activateHit(state.hitIndex + (event.shiftKey ? -1 : 1), true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch(false);
        el.searchInput.blur();
      }
    });
    el.searchPrev.addEventListener('click', () => {
      if (state.hits.length) activateHit(state.hitIndex - 1, true);
    });
    el.searchNext.addEventListener('click', () => {
      if (state.hits.length) activateHit(state.hitIndex + 1, true);
    });
    el.searchClear.addEventListener('click', () => {
      clearSearch(true);
    });

    document.addEventListener('keydown', onKeyDown);

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', resetDragState);
    window.addEventListener('blur', resetDragState);

    window.addEventListener('resize', () => {
      window.cancelAnimationFrame(thumbResizeFrame);
      thumbResizeFrame = window.requestAnimationFrame(rescaleThumbs);
    });

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (state.pages.length && state.zoomMode === 'fit') applyZoom();
      });
      observer.observe(el.stage);
    }
  }

  function exposeApi() {
    window.MDV = {
      version: '1.2.0',
      get ready() { return state.ready; },
      state,
      PAGE,
      pageCount() { return state.pages.length; },
      outlineInfo() {
        return state.outline.map((item, index) => ({
          index,
          level: item.level,
          text: item.text,
          page: item.page
        }));
      },
      setSidebarMode,
      setSidebarCollapsed,
      setSidebarTab: setSidebarMode,
      preparePrint,
      clearPrint,
      printDocument,
      pageInfo() {
        return state.pages.map((page, index) => ({
          index,
          overflow: !!page.overflow,
          used: Math.round(page.used || 0),
          chars: page.body.textContent.length
        }));
      },
      pageMetrics() {
        return state.pages.map((page, index) => ({
          index,
          clientHeight: page.body.clientHeight,
          scrollHeight: page.body.scrollHeight,
          clientWidth: page.body.clientWidth,
          scrollWidth: page.body.scrollWidth,
          overflow: !!page.overflow
        }));
      },
      openFile,
      openText,
      goToPage,
      search(query) {
        el.searchInput.value = query;
        runSearch(query);
        return state.hits.length;
      },
      nextHit() { if (state.hits.length) activateHit(state.hitIndex + 1, true); },
      prevHit() { if (state.hits.length) activateHit(state.hitIndex - 1, true); },
      clearSearch() { clearSearch(false); },
      setZoom(value) {
        state.zoomMode = value === 'fit' ? 'fit' : clamp(Number(value) || 1, MIN_ZOOM, MAX_ZOOM);
        applyZoom();
      },
      getDemoSource
    };
  }

  /* ------------------------------------------------------------------------
     打开文件 / 解码
     ------------------------------------------------------------------------ */

  async function openFile(file) {
    try {
      setStatusHint('正在读取文件…');
      const buffer = await file.arrayBuffer();
      const text = decodeBuffer(buffer);
      if (text === null) {
        toast('无法读取：这似乎不是文本文件');
        setStatusHint('Ctrl+O 打开文件 · 拖拽文件到窗口');
        return;
      }
      await openText(file.name || '未命名.md', text);
    } catch (error) {
      console.error(error);
      toast('打开失败：' + errorMessage(error));
      setStatusHint('Ctrl+O 打开文件 · 拖拽文件到窗口');
    }
  }

  function decodeBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer);
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buffer);
      }
    }

    const sample = Math.min(bytes.length, 4096);
    let nulls = 0;
    for (let i = 0; i < sample; i += 1) {
      if (bytes[i] === 0) nulls += 1;
    }
    if (sample > 0 && nulls / sample > 0.01) return null;

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
      try {
        return new TextDecoder('gb18030').decode(buffer);
      } catch (fallbackError) {
        return new TextDecoder('utf-8').decode(buffer);
      }
    }
  }

  function errorMessage(error) {
    return error && error.message ? error.message : '未知错误';
  }

  /* ------------------------------------------------------------------------
     文档渲染与分页
     ------------------------------------------------------------------------ */

  async function openText(name, content) {
    const token = ++state.token;
    state.name = name || '未命名.md';
    resetReader();
    setStatusHint('正在排版…');

    await new Promise((resolve) => window.setTimeout(resolve, 16));
    if (token !== state.token) return;

    try {
      const fragment = parseMarkdown(String(content == null ? '' : content));
      const pages = paginate(fragment);
      if (token !== state.token) return;

      state.pages = pages;
      state.charCount = String(content == null ? '' : content).replace(/\s+/g, '').length;
      finalizePages();

      showReadingUI();
      state.zoomMode = 'fit';
      state.current = 0;
      buildOutline();
      buildThumbs();
      applySidebarMode();
      el.pageTotal.textContent = String(pages.length);
      el.pageInput.max = String(pages.length);

      applyLayoutMode();
      applyZoom();
      updateStats();
      updateReadingHint();

      el.docTitle.textContent = state.name;
      el.docTitle.title = state.name;
      const ext = extensionOf(state.name);
      el.docBadge.textContent = ext || 'MD';
      document.title = state.name + ' · Markdown 阅读器';
    } catch (error) {
      console.error(error);
      toast('渲染失败：' + errorMessage(error));
      showEmptyUI();
    }
  }

  function parseMarkdown(text) {
    if (!window.marked) throw new Error('Markdown 解析库未加载');
    const raw = window.marked.parse(text, {
      gfm: true,
      breaks: false,
      async: false
    });
    const template = document.createElement('template');
    template.innerHTML = raw;
    sanitizeFragment(template.content);
    wrapTables(template.content);
    return template.content;
  }

  function sanitizeFragment(fragment) {
    const blocked = new Set([
      'script', 'style', 'iframe', 'object', 'embed', 'form', 'select',
      'textarea', 'button', 'link', 'meta', 'base', 'svg', 'math', 'canvas',
      'video', 'audio', 'source', 'track', 'frame', 'frameset', 'noscript',
      'template', 'applet'
    ]);
    const nodes = Array.from(fragment.querySelectorAll('*'));

    for (const node of nodes) {
      if (!fragment.contains(node)) continue;
      const tag = node.tagName.toLowerCase();

      if (blocked.has(tag)) {
        node.remove();
        continue;
      }

      if (tag === 'input') {
        const type = (node.getAttribute('type') || '').toLowerCase();
        if (type !== 'checkbox') {
          node.remove();
          continue;
        }
        const checked = node.hasAttribute('checked');
        for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
        node.setAttribute('type', 'checkbox');
        node.setAttribute('disabled', '');
        if (checked) node.setAttribute('checked', '');
        continue;
      }

      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (
          name.startsWith('on') ||
          name === 'style' ||
          name === 'srcdoc' ||
          name === 'formaction' ||
          name === 'contenteditable' ||
          name === 'autofocus' ||
          name === 'background'
        ) {
          node.removeAttribute(attr.name);
          continue;
        }

        if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'poster') {
          // 去掉控制字符与空白后再比对协议，防止 java&#10;script: 之类的绕过。
          const compact = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
          if (
            /^(?:javascript|vbscript|data:text\/html)/.test(compact) ||
            (name === 'href' && compact.startsWith('data:'))
          ) {
            node.removeAttribute(attr.name);
            continue;
          }
          if (name === 'src' && compact.startsWith('data:') && !compact.startsWith('data:image/')) {
            node.removeAttribute(attr.name);
            continue;
          }
        }

        if (name === 'class') {
          if (tag === 'code') {
            const language = value
              .split(/\s+/)
              .filter((item) => /^language-[a-z0-9_+-]+$/i.test(item));
            if (language.length) node.setAttribute('class', language.join(' '));
            else node.removeAttribute('class');
          } else {
            node.removeAttribute('class');
          }
        }
      }

      if (tag === 'a') {
        const href = node.getAttribute('href');
        node.removeAttribute('target');
        node.removeAttribute('rel');
        if (href && /^(?:https?:)?\/\//i.test(href)) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }

      if (tag === 'img') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        if (!node.hasAttribute('alt')) node.setAttribute('alt', '');
      }
    }

    for (const checkbox of fragment.querySelectorAll('input[type="checkbox"]')) {
      const item = checkbox.closest('li');
      if (item) item.classList.add('task-list-item');
    }
  }

  function wrapTables(fragment) {
    const tables = Array.from(fragment.querySelectorAll('table'));
    for (const table of tables) {
      if (table.parentNode && table.parentNode.classList && table.parentNode.classList.contains('table-wrap')) {
        continue;
      }
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }
  }

  function collectBlocks(fragment) {
    const blocks = [];
    for (const node of Array.from(fragment.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        blocks.push(node);
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\u00a0/g, ' ').trim();
        if (text) {
          const paragraph = document.createElement('p');
          paragraph.textContent = text;
          blocks.push(paragraph);
        }
      }
    }
    return blocks;
  }

  function paginate(fragment) {
    const blocks = collectBlocks(fragment);
    if (!blocks.length) {
      const placeholder = document.createElement('p');
      placeholder.className = 'empty-doc';
      placeholder.textContent = '（空白文档）';
      blocks.push(placeholder);
    }

    const pages = [];
    let page = null;
    let body = null;
    let used = 0;
    let overflow = false;

    function newPage() {
      page = document.createElement('div');
      page.className = 'page';
      page.innerHTML =
        '<div class="page-body"></div>' +
        '<div class="page-footer"><span class="footer-title"></span><span class="footer-num"></span></div>';
      body = page.querySelector('.page-body');
      el.measureHost.appendChild(page);
      used = 0;
      overflow = false;
    }

    function commitPage() {
      if (!page) return;
      if (body.scrollHeight > PAGE.contentH + 1) overflow = true;
      if (body.scrollWidth > body.clientWidth + 1) overflow = true;
      body.classList.toggle('has-overflow', overflow);
      page.dataset.page = String(pages.length + 1);
      page.dataset.overflow = overflow ? '1' : '0';
      pages.push({ el: page, body, overflow, used, scrollTop: 0 });
      page = null;
      body = null;
      used = 0;
      overflow = false;
    }

    function makeCodeChunk(pre, code, text) {
      const chunk = pre.cloneNode(false);
      const codeNode = code.cloneNode(false);
      codeNode.textContent = text;
      chunk.appendChild(codeNode);
      return chunk;
    }

    /**
     * 超长代码块（高于整页）按行拆到多页；第一段可以先填满当前页的剩余空间。
     * 返回 true 表示已经处理完该块。
     */
    function trySplitCodeBlock(block) {
      if (!block || block.tagName !== 'PRE') return false;
      const code = block.querySelector('code');
      if (!code) return false;
      const raw = code.textContent;
      if (raw.indexOf('\n') < 0) return false;
      const lines = raw.replace(/\n$/, '').split('\n');
      if (lines.length < 2) return false;

      const probe = block.cloneNode(true);
      body.appendChild(probe);
      const fullHeight = blockHeight(probe);
      const computed = window.getComputedStyle(probe);
      body.removeChild(probe);
      if (fullHeight <= PAGE.contentH + 0.75) return false;

      const lineHeight = parseFloat(computed.lineHeight) || 22;
      const chrome =
        (parseFloat(computed.paddingTop) || 0) +
        (parseFloat(computed.paddingBottom) || 0) +
        (parseFloat(computed.borderTopWidth) || 0) +
        (parseFloat(computed.borderBottomWidth) || 0) +
        (parseFloat(computed.marginBottom) || 0);

      let index = 0;
      while (index < lines.length) {
        const available = PAGE.contentH - used;
        if (used > 0 && available < chrome + lineHeight * 2) {
          commitPage();
          newPage();
          continue;
        }

        const maxLines = Math.max(1, Math.floor((available - chrome - 1) / lineHeight));
        const take = Math.min(maxLines, lines.length - index);
        let chunkLines = lines.slice(index, index + take);
        let node = makeCodeChunk(block, code, chunkLines.join('\n'));
        body.appendChild(node);
        let height = blockHeight(node);

        while (height > available + 1 && chunkLines.length > 1) {
          chunkLines.pop();
          body.removeChild(node);
          node = makeCodeChunk(block, code, chunkLines.join('\n'));
          body.appendChild(node);
          height = blockHeight(node);
        }

        if (height > available + 1) {
          body.removeChild(node);
          if (used > 0) {
            commitPage();
            newPage();
            continue;
          }
          body.appendChild(node);
          used = height;
          overflow = true;
        } else {
          used += height;
        }

        index += chunkLines.length;
        if (index < lines.length) {
          commitPage();
          newPage();
        }
      }

      return true;
    }

    newPage();

    for (const block of blocks) {
      if (trySplitCodeBlock(block)) continue;

      const node = block.cloneNode(true);
      body.appendChild(node);
      let height = blockHeight(node);

      if (body.children.length === 1) {
        used = height;
        if (height > PAGE.contentH + 0.5) overflow = true;
        continue;
      }

      if (used + height > PAGE.contentH + 0.75) {
        body.removeChild(node);
        commitPage();
        newPage();
        body.appendChild(node);
        height = blockHeight(node);
        used = height;
        if (height > PAGE.contentH + 0.5) overflow = true;
      } else {
        used += height;
      }
    }

    commitPage();
    return pages;
  }

  function blockHeight(node) {
    const rect = node.getBoundingClientRect();
    const computed = window.getComputedStyle(node);
    const marginBottom = parseFloat(computed.marginBottom) || 0;
    return rect.height + marginBottom;
  }

  function finalizePages() {
    const total = state.pages.length;
    state.pages.forEach((page, index) => {
      const title = page.el.querySelector('.footer-title');
      const num = page.el.querySelector('.footer-num');
      if (title) title.textContent = state.name;
      if (num) num.textContent = (index + 1) + ' / ' + total;
    });
  }

  function resetReader() {
    state.pages = [];
    state.current = 0;
    state.hits = [];
    state.hitIndex = -1;
    state.query = '';
    state.charCount = 0;
    state.scale = 1;
    state.layout = 'single';
    state.outline = [];
    state.outlineActive = -1;
    state.ignoreContinuousScroll = false;
    wheelAccum = 0;
    wheelDirection = 0;
    lastWheelTurn = 0;
    window.clearTimeout(wheelResetTimer);
    el.pageZoom.replaceChildren();
    el.measureHost.replaceChildren();
    el.thumbs.replaceChildren();
    el.outline.replaceChildren();
    el.continuousStack.replaceChildren();
    el.continuousStack.hidden = true;
    el.pageFrame.hidden = false;
    clearPrint();
    document.body.classList.remove('layout-continuous');
    updateSidebarCount();
    el.searchInput.value = '';
    el.searchCount.textContent = '';
    el.searchCount.hidden = true;
    el.searchClear.hidden = true;
    el.searchPrev.disabled = true;
    el.searchNext.disabled = true;
    clearHighlights();
  }

  /* ------------------------------------------------------------------------
     阅读界面
     ------------------------------------------------------------------------ */

  function showReadingUI() {
    document.body.classList.remove('is-empty');
    document.body.classList.remove('dragging');
    document.body.classList.toggle('sidebar-collapsed', state.collapsed);
    el.sidebar.hidden = state.collapsed;
    el.expandSidebar.hidden = !state.collapsed;
    el.emptyState.hidden = true;
    el.stageScroll.hidden = false;
    el.topbarControls.hidden = false;
    updateCollapseLabels();
  }

  function showEmptyUI() {
    state.pages = [];
    state.current = 0;
    state.hits = [];
    state.hitIndex = -1;
    state.query = '';
    state.charCount = 0;
    state.collapsed = false;
    state.layout = 'single';
    state.sidebarMode = 'pages';
    state.outline = [];
    state.outlineActive = -1;
    document.body.classList.add('is-empty');
    document.body.classList.remove('dragging');
    document.body.classList.remove('sidebar-collapsed');
    document.body.classList.remove('layout-continuous');
    el.sidebar.hidden = true;
    el.expandSidebar.hidden = true;
    el.emptyState.hidden = false;
    el.stageScroll.hidden = true;
    el.topbarControls.hidden = true;
    el.pageZoom.replaceChildren();
    el.measureHost.replaceChildren();
    el.thumbs.replaceChildren();
    el.outline.replaceChildren();
    el.continuousStack.replaceChildren();
    el.pageFrame.hidden = false;
    applySidebarMode();
    el.docTitle.textContent = '未打开文档';
    el.docTitle.removeAttribute('title');
    el.docBadge.textContent = 'Markdown';
    el.statusStats.textContent = '未打开文档';
    el.statusStats.removeAttribute('title');
    setStatusHint('Ctrl+O 打开文件 · 拖拽文件到窗口');
    document.title = 'Markdown 阅读器';
  }

  function setSidebarCollapsed(collapsed) {
    const next = !!collapsed;
    if (!next && state.layout === 'continuous') syncContinuousCurrent();
    state.collapsed = next;
    document.body.classList.toggle('sidebar-collapsed', next);
    document.body.classList.toggle('layout-continuous', next && state.layout === 'continuous');
    el.sidebar.hidden = next;
    el.expandSidebar.hidden = !next;
    updateCollapseLabels();

    if (!state.pages.length) return;
    applyLayoutMode();
    applyZoom();
    updateReadingHint();
    if (state.layout === 'continuous') {
      window.requestAnimationFrame(() => scrollContinuousToPage(state.current, false));
    }
  }

  function setSidebarMode(mode) {
    state.sidebarMode = mode === 'outline' ? 'outline' : 'pages';
    applySidebarMode();
    if (state.sidebarMode === 'outline') updateOutlineActive(true);
  }

  function applySidebarMode() {
    const pagesMode = state.sidebarMode !== 'outline';
    el.tabPages.classList.toggle('active', pagesMode);
    el.tabOutline.classList.toggle('active', !pagesMode);
    el.tabPages.setAttribute('aria-selected', String(pagesMode));
    el.tabOutline.setAttribute('aria-selected', String(!pagesMode));
    el.thumbs.hidden = !pagesMode;
    el.outline.hidden = pagesMode;
    updateSidebarCount();
    updateCollapseLabels();
  }

  function updateSidebarCount() {
    const count = state.sidebarMode === 'outline' ? state.outline.length : state.pages.length;
    el.sidebarCount.textContent = String(count);
    el.sidebarCount.title = state.sidebarMode === 'outline'
      ? count + ' 个标题'
      : count + ' 页';
  }

  function updateCollapseLabels() {
    const name = state.sidebarMode === 'outline' ? '文档大纲' : '页面预览';
    const collapseText = '收起' + name;
    const expandText = '展开' + name;
    el.collapseSidebar.title = collapseText;
    el.collapseSidebar.setAttribute('aria-label', collapseText);
    el.expandSidebar.title = expandText;
    el.expandSidebar.setAttribute('aria-label', expandText);
  }

  function applyLayoutMode() {
    if (!state.pages.length) return;
    if (state.collapsed) enterContinuous();
    else enterSingle();
  }

  function enterSingle() {
    state.layout = 'single';
    state.ignoreContinuousScroll = false;
    if (continuousSyncFrame) {
      window.cancelAnimationFrame(continuousSyncFrame);
      continuousSyncFrame = 0;
    }
    document.body.classList.remove('layout-continuous');
    el.continuousStack.hidden = true;
    el.pageFrame.hidden = false;

    for (const page of state.pages) el.measureHost.appendChild(page.el);
    el.continuousStack.replaceChildren();

    const page = state.pages[state.current];
    el.pageZoom.replaceChildren(page.el);
    page.body.scrollTop = page.scrollTop || 0;
    el.stageScroll.scrollTop = 0;
    el.stageScroll.scrollLeft = 0;

    updatePager();
    updateActiveThumb(true);
    updateOutlineActive(true);
    renderHighlights();
  }

  function enterContinuous() {
    const currentPage = state.pages[state.current];
    if (currentPage && currentPage.el.parentNode === el.pageZoom) {
      currentPage.scrollTop = currentPage.body.scrollTop;
    }

    state.layout = 'continuous';
    state.ignoreContinuousScroll = true;
    document.body.classList.add('layout-continuous');
    el.pageFrame.hidden = true;
    el.continuousStack.hidden = false;

    const fragment = document.createDocumentFragment();
    state.pages.forEach((page, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'continuous-page';
      wrap.dataset.page = String(index);

      const zoom = document.createElement('div');
      zoom.className = 'continuous-zoom';
      zoom.appendChild(page.el);
      wrap.appendChild(zoom);
      fragment.appendChild(wrap);
    });

    el.continuousStack.replaceChildren(fragment);
    el.pageZoom.replaceChildren();

    updatePager();
    updateActiveThumb(false);
    updateOutlineActive(false);
    renderHighlights();
  }

  function onStageScroll() {
    if (state.layout !== 'continuous' || state.ignoreContinuousScroll) return;
    if (continuousSyncFrame) return;
    continuousSyncFrame = window.requestAnimationFrame(() => {
      continuousSyncFrame = 0;
      syncContinuousCurrent();
    });
  }

  function syncContinuousCurrent() {
    if (state.layout !== 'continuous') return;
    const wraps = el.continuousStack.children;
    if (!wraps.length) return;

    const viewport = el.stageScroll.getBoundingClientRect();
    const center = viewport.top + el.stageScroll.clientHeight / 2;
    let best = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < wraps.length; i += 1) {
      const rect = wraps[i].getBoundingClientRect();
      const pageCenter = (rect.top + rect.bottom) / 2;
      const distance = Math.abs(pageCenter - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }

    if (best !== state.current) {
      state.current = best;
      updatePager();
      updateActiveThumb(false);
      updateOutlineActive(false);
    }
  }

  function scrollContinuousToPage(index, smooth) {
    if (state.layout !== 'continuous') return;
    const wrap = el.continuousStack.children[index];
    if (!wrap) return;

    state.ignoreContinuousScroll = true;
    const stageRect = el.stageScroll.getBoundingClientRect();
    const rect = wrap.getBoundingClientRect();
    const max = Math.max(0, el.stageScroll.scrollHeight - el.stageScroll.clientHeight);
    const target = clamp(
      el.stageScroll.scrollTop + rect.top - stageRect.top - 26,
      0,
      max
    );

    if (smooth) el.stageScroll.scrollTo({ top: target, behavior: 'smooth' });
    else el.stageScroll.scrollTop = target;

    window.requestAnimationFrame(() => {
      state.ignoreContinuousScroll = false;
    });
  }

  function updateReadingHint() {
    if (!state.pages.length) return;
    if (state.layout === 'continuous') {
      setStatusHint('连续滚动 · Ctrl+F 搜索 · 选中文本后 Ctrl+C 复制');
    } else {
      setStatusHint('← → 翻页 · 滚到底继续滚动可翻页 · Ctrl+F 搜索 · 选中文本后 Ctrl+C 复制');
    }
  }

  function buildThumbs() {
    const fragment = document.createDocumentFragment();
    state.pages.forEach((page, index) => {
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'thumb';
      thumb.dataset.page = String(index);
      thumb.setAttribute('aria-label', '第 ' + (index + 1) + ' 页');

      const frame = document.createElement('div');
      frame.className = 'thumb-frame';

      const zoom = document.createElement('div');
      zoom.className = 'thumb-zoom';

      const clone = page.el.cloneNode(true);
      for (const node of Array.from(clone.querySelectorAll('[id]'))) {
        node.removeAttribute('id');
      }
      const cloneBody = clone.querySelector('.page-body');
      if (cloneBody) cloneBody.scrollTop = 0;

      zoom.appendChild(clone);
      frame.appendChild(zoom);

      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = '第 ' + (index + 1) + ' 页';

      thumb.appendChild(frame);
      thumb.appendChild(label);
      thumb.addEventListener('click', () => goToPage(index));
      fragment.appendChild(thumb);
    });

    el.thumbs.replaceChildren(fragment);
    updateSidebarCount();
    rescaleThumbs();
    updateActiveThumb(false);
  }

  function rescaleThumbs() {
    const frames = el.thumbs.querySelectorAll('.thumb-frame');
    for (const frame of frames) {
      const zoom = frame.firstElementChild;
      if (zoom && PAGE.w) {
        zoom.style.transform = 'scale(' + (frame.clientWidth / PAGE.w) + ')';
      }
    }
  }

  function updateActiveThumb(scrollIntoView) {
    const items = el.thumbs.children;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const active = i === state.current;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
      if (active && scrollIntoView) {
        item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }

  /* ------------------------------------------------------------------------
     文档大纲
     ------------------------------------------------------------------------ */

  function buildOutline() {
    state.outline = [];
    state.outlineActive = -1;

    state.pages.forEach((page, pageIndex) => {
      const headings = page.body.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const heading of headings) {
        const text = heading.textContent.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        state.outline.push({
          level: Number(heading.tagName.charAt(1)),
          text,
          page: pageIndex,
          el: heading
        });
      }
    });

    renderOutline();
  }

  function renderOutline() {
    const fragment = document.createDocumentFragment();

    if (!state.outline.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = '本文档没有标题';
      fragment.appendChild(empty);
    } else {
      state.outline.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'outline-item level-' + Math.min(6, Math.max(1, item.level));
        button.dataset.index = String(index);
        button.dataset.page = String(item.page);
        button.title = item.text;

        const text = document.createElement('span');
        text.className = 'outline-text';
        text.textContent = item.text;

        const page = document.createElement('span');
        page.className = 'outline-page';
        page.textContent = 'P' + (item.page + 1);

        button.appendChild(text);
        button.appendChild(page);
        button.addEventListener('click', () => jumpToOutline(index));
        fragment.appendChild(button);
      });
    }

    el.outline.replaceChildren(fragment);
    updateSidebarCount();
    updateOutlineActive(false);
  }

  function jumpToOutline(index) {
    const item = state.outline[index];
    if (!item) return;
    state.outlineActive = index;
    goToPage(item.page);
    window.requestAnimationFrame(() => {
      if (state.layout === 'continuous') {
        revealElementInContinuous(item.page, item.el);
      } else {
        scrollBodyToElement(state.pages[item.page], item.el);
      }
    });
  }

  function updateOutlineActive(scrollIntoView) {
    if (!state.outline.length) {
      state.outlineActive = -1;
      return;
    }

    let active = -1;
    const override = state.outline[state.outlineActive];
    if (override && override.page === state.current) {
      active = state.outlineActive;
    } else {
      active = state.outline.findIndex((item) => item.page === state.current);
      if (active < 0) {
        for (let i = state.outline.length - 1; i >= 0; i -= 1) {
          if (state.outline[i].page < state.current) {
            active = i;
            break;
          }
        }
      }
    }

    state.outlineActive = active;
    const items = el.outline.querySelectorAll('.outline-item');
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const isActive = i === active;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
      if (isActive && scrollIntoView && state.sidebarMode === 'outline' && !state.collapsed) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function scrollBodyToElement(page, element) {
    if (!page || !element || !page.body.classList.contains('has-overflow')) return;
    const rect = element.getBoundingClientRect();
    const bodyRect = page.body.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const scale = state.scale || 1;
    const top = (rect.top - bodyRect.top) / scale;
    if (top < 0 || top > page.body.clientHeight - 40) {
      page.body.scrollTop += top - 12;
    }
  }

  function revealElementInContinuous(pageIndex, element) {
    const page = state.pages[pageIndex];
    if (!page || !element || state.layout !== 'continuous') return;
    scrollBodyToElement(page, element);
    const rect = element.getBoundingClientRect();
    const stageRect = el.stageScroll.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    el.stageScroll.scrollTop += rect.top - stageRect.top - 80;
  }

  function goToPage(index, options = {}) {
    if (!state.pages.length) return;
    const target = clamp(Math.round(index), 0, state.pages.length - 1);

    if (state.layout === 'continuous') {
      if (Number.isInteger(options.outlineIndex)) state.outlineActive = options.outlineIndex;
      state.current = target;
      updatePager();
      updateActiveThumb(false);
      updateOutlineActive(false);
      renderHighlights();
      scrollContinuousToPage(target, !!options.smooth);
      return;
    }

    const page = state.pages[target];

    if (el.pageZoom.firstElementChild === page.el) {
      updatePager();
      updateActiveThumb(true);
      updateOutlineActive(true);
      renderHighlights();
      return;
    }

    const previous = state.pages[state.current];
    if (previous && previous.el.parentNode === el.pageZoom) {
      previous.scrollTop = previous.body.scrollTop;
      el.measureHost.appendChild(previous.el);
    }

    state.current = target;
    el.pageZoom.replaceChildren(page.el);
    page.body.scrollTop = page.scrollTop || 0;
    el.stageScroll.scrollTop = 0;
    el.stageScroll.scrollLeft = 0;

    updatePager();
    updateActiveThumb(true);
    updateOutlineActive(true);
    renderHighlights();
  }

  function updatePager() {
    el.pageInput.value = String(state.current + 1);
    el.pageInput.max = String(state.pages.length);
    el.pageTotal.textContent = String(state.pages.length);
    el.prevPage.disabled = state.current <= 0;
    el.nextPage.disabled = state.current >= state.pages.length - 1;
  }

  function commitPageInput() {
    if (!state.pages.length) return;
    const value = parseInt(el.pageInput.value, 10);
    if (Number.isFinite(value)) goToPage(value - 1);
    else updatePager();
  }

  function updateStats() {
    const total = state.pages.length;
    const overflowPages = state.pages.filter((page) => page.overflow).length;
    let text = total + ' 页 · ' + state.charCount.toLocaleString('zh-CN') + ' 字';
    if (overflowPages) text += ' · ' + overflowPages + ' 页含长内容';
    el.statusStats.textContent = text;
    el.statusStats.title = overflowPages
      ? '标记「含长内容」的页面高于一页，可在页内滚动查看'
      : '';
    updateSidebarCount();
  }

  function setStatusHint(text) {
    el.statusHint.textContent = text;
  }

  /* ------------------------------------------------------------------------
     缩放
     ------------------------------------------------------------------------ */

  function fitScale() {
    const rect = el.stageScroll.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return 1;
    const availableWidth = Math.max(200, rect.width - 80);
    const availableHeight = Math.max(200, rect.height - 58);
    const fit = Math.min(availableWidth / PAGE.w, availableHeight / PAGE.h, FIT_MAX);
    return clamp(fit, MIN_ZOOM, MAX_ZOOM);
  }

  function applyZoom() {
    if (!state.pages.length) return;
    const scale = state.zoomMode === 'fit' ? fitScale() : clamp(state.zoomMode, MIN_ZOOM, MAX_ZOOM);
    state.scale = scale;
    const width = PAGE.w * scale;
    const height = PAGE.h * scale;

    el.pageFrame.style.width = width + 'px';
    el.pageFrame.style.height = height + 'px';
    el.pageZoom.style.transform = 'scale(' + scale + ')';

    if (state.layout === 'continuous') {
      el.continuousStack.style.width = width + 'px';
      const wraps = el.continuousStack.children;
      for (const wrap of wraps) {
        wrap.style.width = width + 'px';
        wrap.style.height = height + 'px';
        const zoom = wrap.firstElementChild;
        if (zoom) zoom.style.transform = 'scale(' + scale + ')';
      }
      const pageIndex = state.current;
      window.requestAnimationFrame(() => {
        if (state.layout === 'continuous' && state.pages.length) {
          scrollContinuousToPage(pageIndex, false);
        }
      });
    }

    const percent = Math.round(scale * 100);
    el.zoomLabel.textContent = percent + '%';
    el.zoomLabel.title = state.zoomMode === 'fit'
      ? '适应窗口（' + percent + '%），点击切换为手动缩放'
      : '当前为手动缩放，点击恢复适应窗口';
  }

  function stepZoom(delta) {
    if (!state.pages.length) return;
    const base = state.zoomMode === 'fit' ? state.scale : state.zoomMode;
    state.zoomMode = clamp(Math.round((base + delta) * 10) / 10, MIN_ZOOM, MAX_ZOOM);
    applyZoom();
  }

  /* ------------------------------------------------------------------------
     搜索
     ------------------------------------------------------------------------ */

  function runSearch(query) {
    state.query = String(query == null ? '' : query);
    state.hits = state.query.trim() ? findHits(state.query) : [];
    state.hitIndex = -1;
    updateSearchUI();
    renderHighlights();

    if (!state.hits.length) return;

    let preferred = state.hits.findIndex((hit) => hit.page === state.current);
    if (preferred < 0) preferred = 0;
    activateHit(preferred, true);
  }

  function findHits(query) {
    const needle = query.toLowerCase();
    const hits = [];

    for (let pageIndex = 0; pageIndex < state.pages.length; pageIndex += 1) {
      const body = state.pages[pageIndex].body;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let node = walker.nextNode();
      while (node) {
        const text = node.nodeValue.toLowerCase();
        let offset = 0;
        while (offset <= text.length) {
          const found = text.indexOf(needle, offset);
          if (found < 0) break;
          hits.push({ page: pageIndex, node, offset: found, length: query.length });
          if (hits.length >= MAX_HITS) return hits;
          offset = found + Math.max(1, query.length);
        }
        node = walker.nextNode();
      }
    }

    return hits;
  }

  function activateHit(index, jump) {
    const total = state.hits.length;
    if (!total) return;
    state.hitIndex = ((index % total) + total) % total;
    const hit = state.hits[state.hitIndex];

    if (state.layout === 'continuous') {
      if (jump) {
        state.current = hit.page;
        updatePager();
        updateActiveThumb(false);
        updateOutlineActive(false);
      }
      renderHighlights();
    } else if (jump && hit.page !== state.current) {
      goToPage(hit.page);
    } else {
      renderHighlights();
    }

    updateSearchUI();

    if (hit.page === state.current) {
      const range = makeRange(hit);
      if (range) {
        const hitIndex = state.hitIndex;
        window.requestAnimationFrame(() => {
          // 搜索后用户可能立刻翻页或清除搜索，过期的滚动请求不应把页面拉回去。
          if (state.hitIndex !== hitIndex) return;
          if (state.hits[hitIndex] !== hit) return;
          if (hit.page !== state.current) return;
          if (state.layout === 'continuous') revealRangeInContinuous(hit.page, range);
          else revealRange(range);
        });
      }
    }
  }

  function updateSearchUI() {
    const hasQuery = state.query.trim().length > 0;
    el.searchCount.hidden = !hasQuery;
    el.searchClear.hidden = !hasQuery;

    if (hasQuery) {
      const total = state.hits.length;
      const position = state.hitIndex >= 0 ? state.hitIndex + 1 : 0;
      el.searchCount.textContent = position + ' / ' + total;
      el.searchCount.classList.toggle('no-hit', total === 0);
      el.searchCount.title = total === 0 ? '没有找到匹配内容' : '当前命中 / 总命中';
    } else {
      el.searchCount.classList.remove('no-hit');
      el.searchCount.removeAttribute('title');
    }

    el.searchPrev.disabled = !state.hits.length;
    el.searchNext.disabled = !state.hits.length;
  }

  function clearSearch(focus) {
    state.query = '';
    state.hits = [];
    state.hitIndex = -1;
    el.searchInput.value = '';
    clearHighlights();
    updateSearchUI();
    if (focus) el.searchInput.focus();
  }

  function makeRange(hit) {
    if (!hit.node || typeof hit.node.nodeValue !== 'string') return null;
    if (hit.node.nodeValue.length < hit.offset + hit.length) return null;
    const range = document.createRange();
    range.setStart(hit.node, hit.offset);
    range.setEnd(hit.node, hit.offset + hit.length);
    return range;
  }

  function supportsHighlights() {
    return typeof Highlight === 'function' && !!window.CSS && !!window.CSS.highlights;
  }

  function clearHighlights() {
    if (!supportsHighlights()) return;
    window.CSS.highlights.delete(HIGHLIGHT_ALL);
    window.CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  }

  function renderHighlights() {
    if (!supportsHighlights()) return;
    clearHighlights();
    if (!state.query.trim() || !state.hits.length) return;

    const continuous = state.layout === 'continuous';
    const pageIndex = state.current;
    const active = state.hitIndex >= 0 ? state.hits[state.hitIndex] : null;
    const ranges = [];

    for (const hit of state.hits) {
      if (!continuous && hit.page !== pageIndex) continue;
      if (active && hit === active) continue;
      const range = makeRange(hit);
      if (range) ranges.push(range);
    }

    if (ranges.length) {
      window.CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
    }

    if (active && (continuous || active.page === pageIndex)) {
      const activeRange = makeRange(active);
      if (activeRange) {
        window.CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(activeRange));
      }
    }
  }

  function scrollBodyToRange(page, range) {
    if (!page || !page.body.classList.contains('has-overflow')) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const bodyRect = page.body.getBoundingClientRect();
    const scale = state.scale || 1;
    const top = (rect.top - bodyRect.top) / scale;
    const bottom = (rect.bottom - bodyRect.top) / scale;
    const visibleHeight = page.body.clientHeight;

    if (top < 0) {
      page.body.scrollTop += top - 12;
    } else if (bottom > visibleHeight) {
      page.body.scrollTop += bottom - visibleHeight + 12;
    }
  }

  function revealRange(range) {
    const page = state.pages[state.current];
    if (!page || page.el.parentNode !== el.pageZoom) return;
    scrollBodyToRange(page, range);
  }

  function revealRangeInContinuous(pageIndex, range) {
    const page = state.pages[pageIndex];
    if (!page || state.layout !== 'continuous') return;
    scrollBodyToRange(page, range);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const stageRect = el.stageScroll.getBoundingClientRect();
    el.stageScroll.scrollTop += rect.top - stageRect.top - 80;
  }

  /* ------------------------------------------------------------------------
     滚轮翻页（单页模式）
     ------------------------------------------------------------------------ */

  function onStageWheel(event) {
    if (!state.pages.length || state.layout === 'continuous' || event.ctrlKey) return;
    if (!event.deltaY) return;

    const direction = event.deltaY > 0 ? 1 : -1;
    const page = state.pages[state.current];
    const body = page.body;
    const delta = normalizeWheelDelta(event);

    if (body.classList.contains('has-overflow') && canScrollElement(body, direction)) {
      event.preventDefault();
      body.scrollTop += delta;
      return;
    }

    if (canScrollElement(el.stageScroll, direction)) return;

    event.preventDefault();
    const now = window.performance.now();
    if (now - lastWheelTurn < 800) return;

    if (direction !== wheelDirection) {
      wheelDirection = direction;
      wheelAccum = 0;
    }
    wheelAccum += delta;

    window.clearTimeout(wheelResetTimer);
    wheelResetTimer = window.setTimeout(() => {
      wheelAccum = 0;
      wheelDirection = 0;
    }, 350);

    if (Math.abs(wheelAccum) < 40) return;

    wheelAccum = 0;
    wheelDirection = 0;
    lastWheelTurn = now;
    goToPage(state.current + direction);
  }

  function normalizeWheelDelta(event) {
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= Math.max(1, el.stageScroll.clientHeight);
    return delta;
  }

  function canScrollElement(element, direction) {
    const max = element.scrollHeight - element.clientHeight;
    if (max <= 1) return false;
    return direction > 0 ? element.scrollTop < max - 1 : element.scrollTop > 1;
  }

  /* ------------------------------------------------------------------------
     键盘与拖拽
     ------------------------------------------------------------------------ */

  function onKeyDown(event) {
    const key = event.key;
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' ||
      (target && target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'f') {
      if (!state.pages.length) return;
      event.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'o') {
      event.preventDefault();
      el.fileInput.click();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'p') {
      if (!state.pages.length) return;
      event.preventDefault();
      printDocument();
      return;
    }

    if (typing) return;
    if (!state.pages.length) return;

    if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'PageUp' || key === 'PageDown') && hasTextSelection()) {
      return;
    }

    switch (key) {
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        goToPage(state.current + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        goToPage(state.current - 1);
        break;
      case 'Home':
        event.preventDefault();
        goToPage(0);
        break;
      case 'End':
        event.preventDefault();
        goToPage(state.pages.length - 1);
        break;
      case 'Escape':
        if (state.query) clearSearch(false);
        break;
      default:
        break;
    }
  }

  function hasTextSelection() {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
  }

  function hasFiles(event) {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    const types = transfer.types || [];
    for (const type of types) {
      if (type === 'Files') return true;
    }
    return false;
  }

  function onDragEnter(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add('dragging');
  }

  function onDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  }

  function onDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    resetDragState();
    if (file) openFile(file);
  }

  function resetDragState() {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }

  /* ------------------------------------------------------------------------
     打印
     ------------------------------------------------------------------------ */

  function preparePrint() {
    if (!state.pages.length) return false;
    if (el.printRoot.childElementCount) return true;

    const fragment = document.createDocumentFragment();
    state.pages.forEach((page) => {
      const sheet = document.createElement('div');
      sheet.className = 'print-sheet' + (page.overflow ? ' is-overflow' : '');

      const clone = page.el.cloneNode(true);
      for (const node of Array.from(clone.querySelectorAll('[id]'))) {
        node.removeAttribute('id');
      }
      const body = clone.querySelector('.page-body');
      if (body) {
        body.scrollTop = 0;
        body.scrollLeft = 0;
      }

      sheet.appendChild(clone);
      fragment.appendChild(sheet);
    });

    el.printRoot.replaceChildren(fragment);
    return true;
  }

  function clearPrint() {
    el.printRoot.replaceChildren();
  }

  function printDocument() {
    if (!state.pages.length) return;
    preparePrint();
    try {
      window.print();
    } catch (error) {
      clearPrint();
      toast('打印失败：' + errorMessage(error));
    }
  }

  /* ------------------------------------------------------------------------
     工具
     ------------------------------------------------------------------------ */

  function getDemoSource() {
    const node = document.getElementById('demoSource');
    return node ? node.textContent.trim() : '';
  }

  function extensionOf(name) {
    const match = /\.([a-z0-9]{1,6})$/i.exec(name || '');
    return match ? match[1].toUpperCase() : '';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.toast.classList.remove('show');
    }, 3200);
  }
})();
