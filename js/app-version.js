/**
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
  version: '1.2.0',
  /** 资源构建号，热更比对基线 */
  build: 1281,
  /** 原生壳版本（Android versionCode），热更 minBinary 门槛比对用 */
  versionCode: 5,
  /** 便于界面直接展示的短形态，如 v1.2.0 (b1275) */
  label: 'v1.2.0 (b1281)'
};
