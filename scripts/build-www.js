#!/usr/bin/env node
/**
 * 溯流计划 · www 打包脚本（纯 Node，零系统依赖）
 *
 * 把 Web 资产同步到 www/（Capacitor 的 webDir），排除壳工程与开发产物。
 * 每次全量重建：先清空 www/ 再复制，避免删掉的文件残留在包里。
 *
 * 后续 OTA 热更的资源包也走这份白/黑名单，保证「装机版」与「热更版」内容口径一致。
 *
 * 用法：node scripts/build-www.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// 白名单：只有明确列出的 Web 资产才进包。
// 不用黑名单的原因：根目录会出现工作区备份（.backup，含聊天记录）、工具元数据（.operit）、
// 设计文档（design / _design）等，黑名单漏一个就会把隐私数据或上 GB 的垃圾打进 APK。
// 新增顶层 Web 资源目录时，在这里登记即可。
const INCLUDE_TOP = [
  'index.html',
  'diagnose.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'assets',
  'icons',
  'data'
];

// 任意层级都排除的文件（含隐藏文件）
const EXCLUDE_ANY = new Set(['.DS_Store', 'Thumbs.db']);
const isHidden = (name) => name.startsWith('.');

let fileCount = 0;
let byteCount = 0;

function copyFile(s, d) {
  fs.copyFileSync(s, d);
  fileCount += 1;
  byteCount += fs.statSync(s).size;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE_ANY.has(entry.name) || isHidden(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      copyFile(s, d);
    }
  }
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const name of INCLUDE_TOP) {
    const s = path.join(ROOT, name);
    if (!fs.existsSync(s)) {
      console.warn(`[build-www] 白名单条目不存在，跳过：${name}`);
      continue;
    }
    const d = path.join(OUT, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDir(s, d);
    } else if (stat.isFile()) {
      copyFile(s, d);
    }
  }

  // 入口文件兜底校验：没有 index.html 的包装进 APK 只会白屏
  if (!fs.existsSync(path.join(OUT, 'index.html'))) {
    console.error('[build-www] 缺少 index.html，打包中止');
    process.exit(1);
  }

  const mb = (byteCount / 1024 / 1024).toFixed(1);
  console.log(`[build-www] WWW_BUILT files=${fileCount} size=${mb}MB -> ${path.relative(ROOT, OUT)}/`);
}

main();