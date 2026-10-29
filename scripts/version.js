/**
 * ============================================================================
 * 溯流计划 · 版本事实源（SINGLE SOURCE OF TRUTH）
 * ============================================================================
 *
 * 全项目所有版本数字只允许从这里读取，禁止在别处硬编码。
 * 消费方：
 *   · scripts/sync-version.js  -> android/version.properties（gradle 读取）
 *   · scripts/build-www.js     -> www 构建戳 / OTA 清单基线
 *   · sw.js                    -> 缓存名 retroflow-shell-v{build}
 *   · scripts/publish-ota.js   -> ota/version.json（热更清单，后续接入）
 *
 * 三个数字各自的语义与递增规则（重要，别混用）：
 *
 *   version      给人看的功能版本，语义化三段式 MAJOR.MINOR.PATCH。
 *                · 破坏性变更 / 大功能上线        -> MAJOR
 *                · 新功能（如记忆库、OTA 热更）    -> MINOR，PATCH 归零
 *                · bug 修复                        -> PATCH
 *
 *   build        资源构建号，单调递增，永不回退、永不复用。
 *                延续历史 sw.js 缓存戳序列（...v1273 -> v1274 -> v1275）。
 *                规则：只要改了任何随包下发的 Web 资源（html/css/js/data），
 *                就 +1。它决定客户端缓存是否失效，也是热更比对的基线。
 *
 *   versionCode  Android 原生壳版本，单调递增。
 *                规则：只有改动原生工程时才 +1 —— 新增/升级 Capacitor 插件、
 *                换签名、改权限、改 minSdk/targetSdk。纯 Web 资源更新（热更）
 *                绝不碰它。热更清单里的 minBinary 就是拿它做门槛：
 *                APK 的 versionCode < minBinary 时拒绝热更，提示重装。
 *
 * 为什么必须分开：热更只换 Web 资源，不换壳。若把三者绑成一个数字，
 * 就会出现「发了个热更结果 versionCode 也涨了」，导致 minBinary 门槛失效、
 * 用户被反复提示重装 APK。
 * ============================================================================
 */
'use strict';

module.exports = {
  /** 功能版本（展示用） */
  version: '1.2.0',

  /** 资源构建号（缓存戳 / 热更基线），单调递增 */
  build: 1282,

  /** Android versionCode（原生壳版本），单调递增 */
  versionCode: 5,

  /** 签名证书主体信息，与 keystore 生成参数保持一致 */
  signing: {
    alias: 'retroflow',
    storeFile: 'release.keystore',
    storeType: 'PKCS12',
    validityDays: 10950,
    dname: 'CN=Retroflow, OU=Release, O=Retroflow, C=CN'
  }
};
