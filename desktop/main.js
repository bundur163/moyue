'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');

app.setName('墨阅');

let mainWindow = null;
let isPrinting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    title: '墨阅',
    backgroundColor: '#e8e4dc',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('墨阅');
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  buildMenu();
}

function runInRenderer(script) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: '墨阅',
      submenu: [
        { role: 'about', label: '关于墨阅' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏墨阅' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出墨阅' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开 Markdown…',
          accelerator: 'CmdOrCtrl+O',
          click: () => runInRenderer('document.getElementById("fileInput").click()')
        },
        {
          label: '打印…',
          accelerator: 'CmdOrCtrl+P',
          click: () => runInRenderer('window.MDV && window.MDV.printDocument()')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('moyue:print', (event) => {
  if (isPrinting) return { success: false, reason: 'busy' };
  isPrinting = true;

  return new Promise((resolve) => {
    event.sender.print(
      {
        silent: false,
        printBackground: true,
        pageSize: 'A4',
        landscape: false
      },
      (success, failureReason) => {
        isPrinting = false;
        resolve({ success, reason: failureReason || '' });
      }
    );
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
