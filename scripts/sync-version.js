#!/usr/bin/env node
/**
 * 溯流计划 · 版本同步脚本
 *
 * 从 scripts/version.js（唯一事实源）把版本数字写入各消费方：
 *   1. android/version.properties  —— gradle 构建时读取（versionCode / versionName / signing）
 *   2. sw.js                       —— 缓存名 retroflow-shell-v{build}
 *
 * 并做三项守卫，任一不通过即中止（非零退出），不写出任何文件：
 *   · 回退守卫：build / versionCode 不得小于当前已提交值（缓存戳回退 = 线上用户永远读旧缓存）
 *   · 格式守卫：version 必须是 MAJOR.MINOR.PATCH 三段数字
 *   · 一致守卫：sw.js 里的缓存戳必须能被本脚本接管（认得 retroflow-shell-v{N} 形态）
 *
 * 用法：node scripts/sync-version.js [--check]
 *   --check  只校验不写入（CI / 构建前自检用）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const V = require('./version.js');

const PROPS = path.join(ROOT, 'android', 'version.properties');
const SW = path.join(ROOT, 'sw.js');
// 运行时版本：页面里要显示「当前版本」，必须有同步可读的来源。
// 生成而非硬写，是为了让它永远和 version.js 一致，并受同样的漂移守卫管辖。
const APPVER = path.join(ROOT, 'js', 'app-version.js');
const CHECK_ONLY = process.argv.includes('--check');

const fail = (msg) => {
  console.error(`[sync-version] 中止：${msg}`);
  process.exit(1);
};

/* ---------------- 守卫 1：格式 ---------------- */

if (!/^\d+\.\d+\.\d+$/.test(String(V.version))) {
  fail(`version 必须是 MAJOR.MINOR.PATCH 三段数字，实际为 ${V.version}`);
}
if (!Number.isInteger(V.build) || V.build <= 0) {
  fail(`build 必须是正整数，实际为 ${V.build}`);
}
if (!Number.isInteger(V.versionCode) || V.versionCode <= 0) {
  fail(`versionCode 必须是正整数，实际为 ${V.versionCode}`);
}

/* ---------------- 守卫 2：回退 ---------------- */

function readProps() {
  // 优先从 git HEAD 读：工作区文件可能已被本次运行改过，那样就永远查不出回退。
  // HEAD 里还没有这个文件时（首次运行），退回读工作区，保证守卫从第一次 sync
  // 之后就生效，而不是要等文件入库才开始起作用。
  const parse = (text) => {
    const map = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
      if (m) map[m[1]] = m[2].trim();
    }
    return map;
  };
  try {
    const out = execFileSync('git', ['show', 'HEAD:android/version.properties'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return { src: 'HEAD', map: parse(out) };
  } catch (e) {
    if (fs.existsSync(PROPS)) {
      return { src: 'worktree', map: parse(fs.readFileSync(PROPS, 'utf8')) };
    }
    return null;
  }
}

const prev = readProps();
if (prev) {
  const prevBuild = Number(prev.map.build);
  const prevCode = Number(prev.map.versionCode);
  if (Number.isFinite(prevBuild) && V.build < prevBuild) {
    fail(`build 回退：${prevBuild} -> ${V.build}（来源 ${prev.src}；缓存戳回退会让线上用户永远读旧资源）`);
  }
  if (Number.isFinite(prevCode) && V.versionCode < prevCode) {
    fail(`versionCode 回退：${prevCode} -> ${V.versionCode}（来源 ${prev.src}；Android 拒绝降级覆盖安装）`);
  }
}

/* ---------------- 守卫 3：sw.js 可接管 ---------------- */

const swSrc = fs.existsSync(SW) ? fs.readFileSync(SW, 'utf8') : '';
if (!swSrc) fail(`找不到 sw.js：${SW}`);
const SW_RE = /const CACHE_NAME = 'retroflow-shell-v(\d+)';/;
if (!SW_RE.test(swSrc)) {
  fail("sw.js 里没有形如 const CACHE_NAME = 'retroflow-shell-v1234'; 的行，无法接管缓存戳");
}
const swBuildNow = Number(swSrc.match(SW_RE)[1]);
if (swBuildNow > V.build) {
  fail(`sw.js 缓存戳(v${swBuildNow})已高于 version.js 的 build(${V.build})，两者已漂移`);
}

/* ---------------- 守卫 4：运行时版本文件可接管 ---------------- */

// js/app-version.js 由本脚本生成。若它已存在且 build 更高，说明有人手改过
// 或 version.js 被回退了 —— 同样必须中止，否则页面显示的版本会与壳不一致。
const APPVER_RE = /build:\s*(\d+)/;
const appVerSrc = fs.existsSync(APPVER) ? fs.readFileSync(APPVER, 'utf8') : '';
if (appVerSrc) {
  const m = appVerSrc.match(APPVER_RE);
  if (!m) {
    fail('js/app-version.js 里找不到 build: N 字段，无法接管（文件可能已被手改）');
  }
  const appVerBuild = Number(m[1]);
  if (appVerBuild > V.build) {
    fail(`js/app-version.js 的 build(${appVerBuild})已高于 version.js 的 build(${V.build})，两者已漂移`);
  }
}

/* ---------------- 写出 ---------------- */

const propsOut = [
  '# 本文件由 scripts/sync-version.js 自动生成，请勿手改。',
  '# 唯一事实源是 scripts/version.js —— 改版本请改那里，然后重跑本脚本。',
  `version=${V.version}`,
  `build=${V.build}`,
  `versionCode=${V.versionCode}`,
  `storeFile=${V.signing.storeFile}`,
  `storeType=${V.signing.storeType}`,
  `keyAlias=${V.signing.alias}`,
  ''
].join('\n');

const swOut = swSrc.replace(SW_RE, `const CACHE_NAME = 'retroflow-shell-v${V.build}';`);

// 运行时版本文件：页面显示「当前版本」、OTA 自报版本都读这里。
// 三个数字与 version.js 同源，且带 minBinary 语义说明，避免后来者误用。
const appVerOut = `/**
 * 溯流计划 · 运行时版本（自动生成，请勿手改）
 *
 * 由 scripts/sync-version.js 从 scripts/version.js 生成。
 * 手改会在下一次 sync 被守卫拦截或直接覆盖。
 *
 * 消费方：
 *   · 设置 → 终端配置 → UPDATE 块显示「当前版本」
 *   · OTA 检查更新时作为客户端自报版本，与远端清单比对
 */
'use strict';

window.RetroflowVersion = {
  /** 功能版本，给人看 */
  version: '${V.version}',
  /** 资源构建号，热更比对基线 */
  build: ${V.build},
  /** 原生壳版本（Android versionCode），热更 minBinary 门槛比对用 */
  versionCode: ${V.versionCode},
  /** 便于界面直接展示的短形态，如 v1.2.0 (b1275) */
  label: 'v${V.version} (b${V.build})'
};
`;

if (CHECK_ONLY) {
  console.log(`[sync-version] CHECK_OK version=${V.version} build=${V.build} versionCode=${V.versionCode}`);
  console.log(`[sync-version] sw.js 缓存戳 v${swBuildNow} -> v${V.build}${swBuildNow === V.build ? '（无变化）' : ''}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(PROPS), { recursive: true });
fs.writeFileSync(PROPS, propsOut, 'utf8');
if (swOut !== swSrc) fs.writeFileSync(SW, swOut, 'utf8');
fs.mkdirSync(path.dirname(APPVER), { recursive: true });
const appVerChanged = appVerSrc !== appVerOut;
fs.writeFileSync(APPVER, appVerOut, 'utf8');

console.log(`[sync-version] SYNCED version=${V.version} build=${V.build} versionCode=${V.versionCode}`);
console.log(`[sync-version]   -> ${path.relative(ROOT, PROPS)}`);
console.log(`[sync-version]   -> sw.js CACHE_NAME=retroflow-shell-v${V.build}${swBuildNow === V.build ? ' (unchanged)' : ` (was v${swBuildNow})`}`);
console.log(`[sync-version]   -> ${path.relative(ROOT, APPVER)}${appVerChanged ? '' : ' (unchanged)'}`);
