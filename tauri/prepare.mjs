#!/usr/bin/env node
/**
 * 把单文件阅读器复制为 Tauri 前端产物。
 * 阅读器源码仍是唯一事实来源。
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '..', 'Markdown阅读器.html');
const TARGET = path.join(HERE, 'ui', 'index.html');

await mkdir(path.dirname(TARGET), { recursive: true });
await copyFile(SOURCE, TARGET);

const info = await stat(TARGET);
console.log('已同步阅读器：' + path.relative(path.resolve(HERE, '..'), TARGET) + '（' + info.size + ' 字节）');
