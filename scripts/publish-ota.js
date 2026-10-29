#!/usr/bin/env node
/**
 * ============================================================================
 * 溯流计划 · OTA 热更发布脚本（一条命令发完，用户端只需点「拉取新版本」）
 * ============================================================================
 *
 * 职责：把当前 www 资源打成一个热更包，挂到 GitHub Release，回填 ota/version.json，
 * 提交推送，清 CDN 缓存。全程无需人工到网页上点任何按钮。
 *
 * 「字体常驻 + 其余热更」策略（与原生 RetroflowRouteProcessor 对应）：
 *   更新包【排除 www/assets/fonts/】。字体（42MB 级）留在 APK 内置 assets 里，
 *   客户端覆盖层没有字体文件时，路由处理器自动回退到内置那份。于是热更包只有 ~1.7MB。
 *   代价：字体本身若要改，只能随新 APK（versionCode+1）下发，不能热更。这是刻意的取舍。
 *
 * 安全：GitHub token 从 ~/.git-credentials 读取，绝不写入仓库、绝不打印明文。
 *
 * 用法：
 *   node scripts/publish-ota.js --min-binary 5 --notes "第一条" --notes "第二条"
 *   node scripts/publish-ota.js --min-binary 5 --notes-file /tmp/notes.txt
 *   node scripts/publish-ota.js --min-binary 5 --notes "..." --dry-run   # 只打包算哈希，不上传不推送
 *
 * 参数：
 *   --min-binary N   必填。本次热更要求的最低原生壳 versionCode。
 *                    纯 Web 改动填当前壳版本；若新代码用到新原生能力则填新壳版本。
 *                    不设默认值——宁可漏发也不误发（漏了顶多不提示，误填会让旧壳热更后崩）。
 *   --notes "..."    可重复。更新说明，每条一行，展示在客户端「发现新版本」下。
 *   --notes-file P   从文件读更新说明，一行一条（与 --notes 二选一）。
 *   --dry-run        演练：构建、打包、算哈希、打印将写入的清单，但不建 Release、不推送。
 *   --force          允许对已存在的 tag 重新发布（默认拒绝，防止覆盖历史包）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const V = require('./version.js');
const REPO = 'skynexly/retroflow';
const [OWNER, REPO_NAME] = REPO.split('/');
const MANIFEST = path.join(ROOT, 'ota', 'version.json');
const WWW = path.join(ROOT, 'www');
const FONT_DIR_REL = path.join('assets', 'fonts'); // 相对 www，打包时排除
const JSDELIVR_PURGE = `https://purge.jsdelivr.net/gh/${REPO}@main/ota/version.json`;
const RAW_MANIFEST = `https://raw.githubusercontent.com/${REPO}/main/ota/version.json`;

// 体积守卫上限：不含字体的 www 压缩后实测约 1.7MB。超过 8MB 说明字体或垃圾被打进来了。
const MAX_ZIP_BYTES = 8 * 1024 * 1024;

const log = (...a) => console.log('[publish-ota]', ...a);
const die = (msg) => { console.error(`[publish-ota] 中止：${msg}`); process.exit(1); };

/* ------------------------------- 参数解析 ------------------------------- */
function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { minBinary: null, notes: [], dryRun: false, force: false, notesFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-binary') opts.minBinary = parseInt(argv[++i], 10);
    else if (a === '--notes') opts.notes.push(argv[++i]);
    else if (a === '--notes-file') opts.notesFile = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else die(`未知参数：${a}`);
  }
  if (opts.notesFile) {
    const lines = fs.readFileSync(opts.notesFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    opts.notes = opts.notes.concat(lines);
  }
  return opts;
}

/* ------------------------------- GitHub token ------------------------------- */
function readToken() {
  const envTok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envTok) return envTok.trim();
  const f = path.join(os.homedir(), '.git-credentials');
  if (!fs.existsSync(f)) die('未找到 GITHUB_TOKEN 环境变量，也没有 ~/.git-credentials');
  const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.includes('github.com'));
  if (!line) die('~/.git-credentials 里没有 github.com 条目');
  const m = line.match(/https:\/\/[^:]+:([^@]+)@github\.com/);
  if (!m) die('无法从 ~/.git-credentials 解析出 token');
  return m[1].trim();
}

async function gh(url, token, init = {}) {
  const headers = Object.assign({
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'retroflow-publish-ota'
  }, init.headers || {});
  const resp = await fetch(url, Object.assign({}, init, { headers }));
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!resp.ok) {
    const msg = (body && body.message) ? body.message : `HTTP ${resp.status}`;
    throw new Error(`${url} -> ${msg}`);
  }
  return body;
}

/* ------------------------------- 构建 www ------------------------------- */
function buildWww() {
  log('构建 www（sync-version + build-www）…');
  execFileSync('node', [path.join(ROOT, 'scripts', 'sync-version.js')], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-www.js')], { cwd: ROOT, stdio: 'inherit' });
  if (!fs.existsSync(path.join(WWW, 'index.html'))) die('www 构建后缺少 index.html');
}

/* ------------------------------- 打包（python3 zipfile，排除字体） ------------------------------- */
function makeZip(outZip) {
  log(`打包热更 zip（排除 ${FONT_DIR_REL}/）…`);
  const py = `
import zipfile, os, sys
www = sys.argv[1]; out = sys.argv[2]; fontRel = sys.argv[3]
fontAbs = os.path.join(www, fontRel)
n = 0; skipped = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(www):
        # 跳过字体目录（常驻 APK，不热更）
        if os.path.abspath(root) == os.path.abspath(fontAbs) or os.path.abspath(root).startswith(os.path.abspath(fontAbs) + os.sep):
            skipped += len(files); continue
        for fn in files:
            if fn.startswith('.'): continue
            full = os.path.join(root, fn)
            arc = os.path.relpath(full, www)
            z.write(full, arc); n += 1
print('ZIP_FILES=%d ZIP_SKIPPED_FONTS=%d' % (n, skipped))
`;
  const res = execFileSync('python3', ['-c', py, WWW, outZip, FONT_DIR_REL], { cwd: ROOT, encoding: 'utf8' });
  log(res.trim());
  if (!fs.existsSync(outZip)) die('zip 未生成');
}

function sha256File(f) {
  const buf = fs.readFileSync(f);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* ------------------------------- 远端清单守卫 ------------------------------- */
async function fetchRemoteBuild() {
  try {
    const r = await fetch(`${RAW_MANIFEST}?_t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.latest && Number.isFinite(j.latest.build)) ? j.latest.build : null;
  } catch (e) {
    return null; // 拉不到不阻断（可能首次发布或网络问题），仅失去单调守卫
  }
}

/* ------------------------------- 主流程 ------------------------------- */
async function main() {
  const opts = parseArgs();

  // 参数校验
  if (!Number.isInteger(opts.minBinary) || opts.minBinary <= 0) {
    die('必须用 --min-binary 显式指定最低原生壳 versionCode（无默认值，防止误发）');
  }
  if (opts.minBinary > V.versionCode) {
    die(`--min-binary(${opts.minBinary}) 高于当前壳 versionCode(${V.versionCode})：` +
        '说明要求的壳还没发布，先把带新壳的 APK 发出去再热更');
  }
  if (!opts.notes.length) die('至少要有一条更新说明（--notes 或 --notes-file）');
  if (!Number.isInteger(V.build) || V.build <= 0) die(`version.js 的 build 非法：${V.build}`);

  const tag = `ota-b${V.build}`;
  const assetName = `retroflow-ota-full-b${V.build}.zip`;
  const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;

  log(`目标：version=${V.version} build=${V.build} minBinary=${opts.minBinary} tag=${tag}`);

  // build 单调守卫：本地 build 必须大于远端清单，否则「发了也没人拉到」
  const remoteBuild = await fetchRemoteBuild();
  if (remoteBuild !== null && V.build <= remoteBuild && !opts.force) {
    die(`本地 build(${V.build}) 不大于远端清单 build(${remoteBuild})。` +
        '先在 scripts/version.js 里把 build +1 再发布，或用 --force 覆盖。');
  }

  // 构建 + 打包
  buildWww();
  const tmpZip = path.join(os.tmpdir(), assetName);
  makeZip(tmpZip);
  const zipBytes = fs.statSync(tmpZip).size;
  const zipSha = sha256File(tmpZip);
  log(`zip 体积=${(zipBytes / 1048576).toFixed(2)}MB sha256=${zipSha}`);

  // 体积守卫：字体若被打进来，体积会暴涨到 20MB+
  if (zipBytes > MAX_ZIP_BYTES) {
    fs.rmSync(tmpZip, { force: true });
    die(`zip 体积 ${(zipBytes / 1048576).toFixed(1)}MB 超过上限 ${(MAX_ZIP_BYTES / 1048576).toFixed(0)}MB，` +
        '疑似字体或大文件被误打进包，已中止（未上传）');
  }

  // 组装新清单
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  manifest.latest.version = V.version;
  manifest.latest.build = V.build;
  manifest.latest.minBinary = opts.minBinary;
  manifest.latest.releasedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  manifest.latest.notes = opts.notes.slice();
  manifest.latest.packages.full.url = downloadUrl;
  manifest.latest.packages.full.sha256 = zipSha;
  manifest.latest.packages.full.size = zipBytes;
  // patch 暂不实现（阶段 2 只发全量包）：保持占位，客户端拿不到 patch.url 会自动用 full
  manifest.latest.packages.patch = { sinceBuild: 0, url: '', sha256: '', size: 0 };
  manifest._status = `已发布 build ${V.build}（全量包，字体常驻不打包）。patch 差分留待后续。`;

  if (opts.dryRun) {
    log('--- DRY RUN：以下为将写入的清单 latest 段 ---');
    console.log(JSON.stringify(manifest.latest, null, 2));
    log(`演练结束，未上传、未推送。临时包在 ${tmpZip}`);
    return;
  }

  // 建 Release + 上传附件
  const token = readToken();
  log('创建 GitHub Release…');
  let release;
  try {
    release = await gh(`https://api.github.com/repos/${REPO}/releases`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `OTA 热更包 b${V.build}`,
        body: opts.notes.map((n) => `- ${n}`).join('\n'),
        draft: false,
        prerelease: false
      })
    });
  } catch (e) {
    if (String(e.message).includes('already_exists') && opts.force) {
      log('tag 已存在，--force：取现有 Release 覆盖上传');
      release = await gh(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, token);
    } else {
      fs.rmSync(tmpZip, { force: true });
      die(`创建 Release 失败：${e.message}（tag 已存在？加 --force 覆盖）`);
    }
  }
  const releaseId = release.id;

  log(`上传附件 ${assetName}（${(zipBytes / 1048576).toFixed(2)}MB）…`);
  const zipBuf = fs.readFileSync(tmpZip);
  await gh(
    `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
    token,
    { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zipBuf }
  );
  fs.rmSync(tmpZip, { force: true });
  log('附件上传完成');

  // 回填清单并落盘
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  log('已回填 ota/version.json');

  // 提交推送（只提交清单；zip 不入库）
  log('提交并推送清单…');
  execFileSync('git', ['add', 'ota/version.json'], { cwd: ROOT, stdio: 'inherit' });
  const commitMsg = `ota: 发布热更包 b${V.build}（minBinary ${opts.minBinary}）\n\n` +
    opts.notes.map((n) => `- ${n}`).join('\n') +
    `\n\n全量包（字体常驻不打包）sha256 ${zipSha.slice(0, 12)}… size ${(zipBytes / 1048576).toFixed(2)}MB`;
  execFileSync('git', ['commit', '-m', commitMsg], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: ROOT, stdio: 'inherit' });

  // 清 jsDelivr 缓存（raw 由客户端 _t 参数穿透，jsDelivr 需显式 purge）
  log('清 jsDelivr 缓存…');
  try {
    const p = await fetch(JSDELIVR_PURGE);
    log(`purge -> HTTP ${p.status}`);
  } catch (e) {
    log(`purge 失败（不影响 raw 源）：${e.message}`);
  }

  log('');
  log('========== 发布完成 ==========');
  log(`tag        : ${tag}`);
  log(`下载       : ${downloadUrl}`);
  log(`build      : ${V.build}  minBinary: ${opts.minBinary}`);
  log(`sha256     : ${zipSha}`);
  log(`size       : ${(zipBytes / 1048576).toFixed(2)}MB`);
  log('客户端现在点「拉取新版本」即可收到本次更新。');
}

main().catch((e) => {
  console.error('[publish-ota] 未捕获错误：', e && e.stack ? e.stack : e);
  process.exit(1);
});