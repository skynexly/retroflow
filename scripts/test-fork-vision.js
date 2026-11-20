/**
 * 下潜副本识图：轮次截断与状态归一化的验证脚本。
 *
 * 只测纯逻辑（buildVisionPrefix / findStaleVisionRecords / normalizeRestoredVisionState），
 * 不碰 IndexedDB 与 DOM。用 vm 沙箱把源文件里这两段函数抠出来跑，
 * 避免为测试在业务文件里加导出口。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const apiSrc = fs.readFileSync(path.join(ROOT, 'js/fork-run-api.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js/fork-run-ui.js'), 'utf8');

function slice(src, startMark, endMark) {
  const s = src.indexOf(startMark);
  if (s < 0) throw new Error(`找不到起点：${startMark}`);
  const e = src.indexOf(endMark, s);
  if (e < 0) throw new Error(`找不到终点：${endMark}`);
  return src.slice(s, e);
}

const apiChunk = slice(apiSrc, 'const VISION_KEEP_TURNS = 5;', '/**\n   * 组装行动关联的文件块前缀');
const normChunk = slice(uiSrc, 'function normalizeRestoredVisionState(raw)', '/** 就地重画一枚胶囊组');

const sandbox = {
  trimStr: (v) => (typeof v === 'string' ? v.trim() : ''),
  console
};
vm.createContext(sandbox);
vm.runInContext(`${apiChunk}\n${normChunk}\nthis.__x = { buildVisionPrefix, findStaleVisionRecords, normalizeRestoredVisionState };`, sandbox);
const { buildVisionPrefix, findStaleVisionRecords, normalizeRestoredVisionState } = sandbox.__x;

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}

console.log('\n[1] buildVisionPrefix 基本形态');
const rec = { id: 'R1', role: 'envoy', images: [{ galleryId: 'G1', visionDescription: '一名向导站在断桥前' }] };
const full = buildVisionPrefix(rec, false);
ok('带图片 ID', full.includes('图片 ID：G1'), full);
ok('带张数', full.includes('共 1 张'), full);
ok('全文保留', full.includes('一名向导站在断桥前'), full);
ok('无图返回空串', buildVisionPrefix({ id: 'R2', role: 'envoy' }, false) === '');

console.log('\n[2] 早期轮次压缩');
const longDesc = '甲'.repeat(300);
const longRec = { id: 'R3', role: 'envoy', images: [{ galleryId: 'G3', visionDescription: longDesc }] };
const staleText = buildVisionPrefix(longRec, true);
ok('摘要标注', staleText.includes('早期影像，仅留摘要'), staleText);
ok('截到 100 码点', Array.from(staleText.split('\n')[1].replace(/^\d+\. /, '')).join('').length <= 130);
ok('图片 ID 仍保留', staleText.includes('图片 ID：G3'), staleText);
ok('全文模式下不压缩', buildVisionPrefix(longRec, false).includes(longDesc));
// 短描述即使早期也不加省略号
const shortRec = { id: 'R4', role: 'envoy', images: [{ galleryId: 'G4', visionDescription: '很短' }] };
ok('短描述不压缩', !buildVisionPrefix(shortRec, true).includes('仅留摘要'));
// emoji 代理对不被切坏
const emojiRec = { id: 'R5', role: 'envoy', images: [{ galleryId: 'G5', visionDescription: '🌊'.repeat(200) }] };
const emojiText = buildVisionPrefix(emojiRec, true);
ok('emoji 未被切成半个', !emojiText.includes('\ufffd') && emojiText.split('\n')[1].includes('🌊'), emojiText.slice(0, 60));
ok('识别失败仍报数并带 ID', buildVisionPrefix({ id: 'R6', role: 'envoy', images: [{ galleryId: 'G6' }] }, false).includes('未能解析'));

console.log('\n[3] findStaleVisionRecords 轮次判定');
// 6 轮：第 1 轮应被标为早期
const records = [];
for (let i = 1; i <= 6; i += 1) {
  records.push({ id: `E${i}`, role: 'envoy', content: `行动${i}`, images: [{ galleryId: `G${i}`, visionDescription: 'x'.repeat(200) }] });
  records.push({ id: `N${i}`, role: 'narration', content: `叙事${i}` });
}
const stale = findStaleVisionRecords(records);
ok('第 1 轮被标为早期', stale.has('E1'), [...stale].join(','));
ok('第 2 轮起不标', !stale.has('E2') && !stale.has('E6'), [...stale].join(','));
// 整轮（行动 + 紧随的叙事）一起算早期；叙事没有图，标了也不影响输出
ok('第 1 轮整轮被标', stale.size === 2 && stale.has('N1'), [...stale].join(','));

console.log('\n[4] 开场首帧不占轮号');
const withOpening = [{ id: 'N0', role: 'narration', content: '开场' }];
for (let i = 1; i <= 5; i += 1) {
  withOpening.push({ id: `E${i}`, role: 'envoy', content: `行动${i}` });
  withOpening.push({ id: `N${i}`, role: 'narration', content: `叙事${i}` });
}
const stale2 = findStaleVisionRecords(withOpening);
ok('5 轮内无早期', stale2.size === 0, [...stale2].join(','));
withOpening.push({ id: 'E6', role: 'envoy', content: '行动6' });
const stale3 = findStaleVisionRecords(withOpening);
ok('第 6 轮时第 1 轮变早期', stale3.has('E1') && !stale3.has('N0'), [...stale3].join(','));

console.log('\n[5] 恢复时状态归一化');
ok('pending -> failed', normalizeRestoredVisionState('pending') === 'failed');
ok('failed 保持', normalizeRestoredVisionState('failed') === 'failed');
ok('done 保持', normalizeRestoredVisionState('done') === 'done');
ok('缺省为空', normalizeRestoredVisionState(undefined) === '');
ok('空串为空', normalizeRestoredVisionState('  ') === '');

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);