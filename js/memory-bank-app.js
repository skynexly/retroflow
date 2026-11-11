/**
 * ============================================================================
 * 溯流计划 · 数据归档 // 记忆库 (MemoryBankApp)
 * 桌面 02「02 数据归档 MEMORY BANK // 记忆库」全屏应用
 *
 * 形态：两层。
 *   外层 = 卷宗格墙：一个副本一张档案卡（封面作证据照 + 等级 + 记忆条数）
 *   内层 = 单本卷宗：认定分支的记忆平铺，其余分支折叠在「其他分支」里
 *
 * 与副本库的关系：副本库把世界装裱成油画供观赏，数据归档把发生过的事
 * 归档成卷宗供查证。两者共用同一份 fork 索引与封面资产，语汇刻意不同。
 *
 * 数据来源全部为真：
 *   副本清单   Store.fork.index（编纂器维护）
 *   分支与认定 ForkRunStore.getIndex / listRuns（canonicalRunId 指针）
 *   记忆本体   MemoryStore.listCandidates（IndexedDB memories）
 *   在场角色名 Store.roster（characters / npcs 现取，不存快照）
 *
 * 规范：零 Emoji、零分割线、纯矢量 SVG、iOS 灵动岛保护、
 *       配色一律走主题变量、接 history 栈支持系统返回手势逐级退。
 * ============================================================================
 */
const MemoryBankApp = (() => {
  'use strict';

  /* ---------------- 等级字典（与副本库同源，水相七档） ---------------- */
  const LEVEL_MAP = {
    'E': { letter: 'E', name: '静水', enName: 'STILL' },
    'D': { letter: 'D', name: '流深', enName: 'DEPTH' },
    'C': { letter: 'C', name: '清源', enName: 'SPRING' },
    'B': { letter: 'B', name: '狂澜', enName: 'SURGE' },
    'A': { letter: 'A', name: '潮汐', enName: 'TIDE' },
    'S': { letter: 'S', name: '深渊', enName: 'ABYSS' },
    'S+': { letter: 'S+', name: '归墟', enName: 'VOID' }
  };

  const LEVEL_SVGS = {
    'E': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'D': `<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'C': `<svg viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    'B': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'A': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    'S': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    'S+': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  /* ---------------- SVG 图标（零 Emoji，返回键 100% 对齐个人档案 / 全局顶栏） ---------------- */
  const ICONS = {
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
    seal: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M7.9 12.3l2.8 2.8 5.4-5.8"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
    witness: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 12s3.9-6.6 10.2-6.6S22.2 12 22.2 12s-3.9 6.6-10.2 6.6S1.8 12 1.8 12z"/><circle cx="12" cy="12" r="2.7"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
    clear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    emptyBox: `<svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 18h32v20a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V18z"/><path d="M5 12h38v6H5z"/><path d="M20 25h8"/></svg>`,
    /* Lucide pen-line / trash (ISC)；仅将线宽由 2 调整为 1.6，以适配 14px 显示。 */
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    /* Lucide star / pin (ISC)，线宽对齐卡片上的编辑、删除图标。 */
    rankImportant: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    rankPinned: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-6.5a5 5 0 0 0-3.2-3.6L14 4.5V2H10v2.5l-.3 2.4a5 5 0 0 0-3.2 3.6Z"/></svg>`,
    searchLine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    /* 向量化：三个节点互连，线宽与搜索、新增图标一致 */
    vectorize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.2 6h9.6M6.1 7.9l4.8 8.2M17.9 7.9l-4.8 8.2"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 7"/></svg>`,
    /* Lucide list-checks (ISC)，线宽与搜索、新增保持一致。 */
    listChecks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 5 2 2 4-4"/><path d="m3 12 2 2 4-4"/><path d="m3 19 2 2 4-4"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    chevronsRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`
  };

  /* ---------------- 助手记忆 · 对你的记忆（7个右侧书签分组定义） ---------------- */
  const OPERATOR_GROUPS = [
    {
      id: 'info', name: '信息', seq: '01',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
    },
    {
      id: 'habit', name: '习惯', seq: '02',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    },
    {
      id: 'like', name: '喜好', seq: '03',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
    },
    {
      id: 'dislike', name: '讨厌', seq: '04',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
    },
    {
      id: 'relationship', name: '人际', fullName: '人际关系', seq: '05',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    },
    {
      id: 'daily_piece', name: '日常', fullName: '日常碎片', seq: '06',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
    },
    {
      id: 'recent_status', name: '近期', fullName: '近期状况', seq: '07', maxLimit: 50,
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`
    }
  ];

  /* ---------------- 助手记忆 · 自我认知（5个右侧书签分组定义） ---------------- */
  const SELF_GROUPS = [
    {
      id: 'understanding', name: '理解', seq: '01',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>`
    },
    {
      id: 'desire', name: '渴望', seq: '02',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22c4.2 0 7-2.8 7-6.6 0-3.1-1.8-5.7-4.8-8.8.1 2.4-1.1 3.8-2.2 4.4.2-3.8-1.8-6.8-4-9-.2 3.8-3 6.3-3 10.3C5 17.8 7.8 22 12 22Z"/><path d="M9.5 17.2c0 1.5 1.1 2.8 2.5 2.8s2.5-1.3 2.5-2.8c0-1.2-.7-2.2-1.8-3.4-.2 1.1-.8 1.7-1.4 2-.1-1-.5-1.8-1-2.4-.5 1.2-.8 2.3-.8 3.8Z"/></svg>`
    },
    {
      id: 'shadow', name: '阴影', seq: '03',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5 8.8 8.8 0 1 0 20.5 14.2Z"/><path d="M16.5 3.5v4M14.5 5.5h4"/></svg>`
    },
    {
      id: 'wish', name: '心愿', seq: '04',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/><path d="M4 3 2.5 1.5M20 21l1.5 1.5"/></svg>`
    },
    {
      id: 'emotion', name: '情绪', seq: '05',
      iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 5.8a5.1 5.1 0 0 0-7.2 0L12 7.4l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 21l8.8-8a5.1 5.1 0 0 0 0-7.2Z"/><path d="M5 12h3l1.5-2.5L12 15l2-4 1.2 1H19"/></svg>`
    }
  ];

  const ASSISTANT_GROUPS = {
    operator: OPERATOR_GROUPS,
    self: SELF_GROUPS
  };

  const DAILY_ICONS = {
    prismFrame: `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="12" y="12" width="76" height="76" rx="4" stroke="currentColor" stroke-width="1.25"/></svg>`,
    prismCore: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true"><path d="M24 3C24 15 25.5 24 37.5 24C25.5 24 24 33 24 45C24 33 22.5 24 10.5 24C22.5 24 24 15 24 3Z" stroke-width="1" opacity="0.55" fill="rgba(var(--primary-color-rgb), 0.03)"/></svg>`
  };

  /* 助手记忆索引：只描述分类，不模拟条数或伪造已落库的数据。 */
  const MEMORY_ICONS = {
    operator: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M30 10C30 23 32 28 45 30C32 32 30 37 30 50C30 37 28 32 15 30C28 28 30 23 30 10Z" stroke-width="1.05" opacity=".8" fill="currentColor" fill-opacity=".035"/><path d="M48 11C48 15 49 16 53 17C49 18 48 19 48 23C48 19 47 18 43 17C47 16 48 15 48 11Z" fill="currentColor" stroke="none" opacity=".65"/></svg>`,
    self: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><circle cx="32" cy="32" r="13" opacity=".72"/><path d="M32 9a23 23 0 0 1 23 23M55 32a23 23 0 0 1-23 23M32 55A23 23 0 0 1 9 32M9 32A23 23 0 0 1 32 9" stroke-dasharray="26 10" opacity=".42"/></svg>`,
    bond: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" aria-hidden="true"><circle cx="24" cy="32" r="15"/><circle cx="40" cy="32" r="15" opacity=".58"/></svg>`,
    events: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" aria-hidden="true"><path d="M32 10v44" opacity=".38"/><circle cx="32" cy="14" r="4"/><circle cx="32" cy="32" r="4" opacity=".72"/><circle cx="32" cy="50" r="4" opacity=".42"/><path d="M40 14h10M14 32h10M40 50h10" opacity=".32"/></svg>`,
    forks: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" aria-hidden="true"><path d="M20 12h32v32" opacity=".32"/><path d="M12 20h32v32H12Z"/><path d="m28 29 7 7-7 7-7-7Z" opacity=".48"/></svg>`,
    pending: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M50 31v15a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5V18a5 5 0 0 1 5-5h21"/><path d="m36 28 14-14" opacity=".42"/><path d="M45 14h5v5" opacity=".72"/></svg>`,
    knowledge: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 20c-7-5-14-6-21-5v29c7-1 14 0 21 5 7-5 14-6 21-5V15c-7-1-14 0-21 5Z"/><path d="M32 20v29" opacity=".38"/></svg>`
  };

  /* 七类分类定义。记录本体存于 AssistantMemoryStore（IndexedDB assistantMemories），所有助手共用一份。 */
  const MEMORY_CATEGORIES = [
    {
      id: 'operator', number: '01', name: '对你的记忆', en: 'OPERATOR', icon: 'operator',
      caption: '我记得的你，连同日常里那些微小的变化。'
    },
    {
      id: 'self', number: '02', name: '自我认知', en: 'SELF', icon: 'self',
      caption: '理解、欲望与阴影<br>理想，以及未言明的情绪'
    },
    {
      id: 'bond', number: '03', name: '情感羁绊', en: 'BOND', icon: 'bond',
      caption: '关系转变与情感记录<br>只关于我和你'
    },
    {
      id: 'events', number: '04', name: '事件记录', en: 'EVENTS', icon: 'events',
      caption: '我们做了什么<br>每一次共同经历'
    },
    {
      id: 'forks', number: '05', name: '副本记忆', en: 'WORLDS', icon: 'forks',
      caption: '不同副本里<br>属于我的主观记忆'
    },
    {
      id: 'pending', number: '06', name: '未完事项', en: 'PROMISES', icon: 'pending',
      caption: '承诺与约定<br>和还没有做完的事'
    },
    {
      id: 'knowledge', number: '07', name: '知识库', en: 'LEXICON', icon: 'knowledge',
      caption: '名词、作品与设定<br>我们的独有解释'
    }
  ];

  /* ---------------- 运行态 ---------------- */
  let containerEl = null;
  let viewportEl = null;
  let headerEl = null;
  let tabBarEl = null;
  let marginNoteEl = null;
  let searchWrapEl = null;
  let searchInputEl = null;
  let searchClearEl = null;
  let searchQuery = '';
  let wallRenderSeq = 0;
  let isOpened = false;
  let pendingProgrammaticBack = false;
  /** 当前展开的副本 id；空串 = 停在卷宗格墙 */
  let currentForkId = '';
  /** 日常页是否展开「助手记忆」分类索引 */
  let isAssistantMemory = false;
  /** 当前展开的助手记忆分类 id；空串 = 停在助手记忆索引 */
  let currentAssistantCategory = '';
  /** 各分类独立记住当前书签；未访问过的分类取自身首组（信息 / 理解）。 */
  const assistantCurrentGroups = {};
  /** 右侧索引轨折叠状态，在两类分组页之间复用同一套版式。 */
  let assistantRailCollapsed = false;
  /** 书签轨对齐用的尺寸监听，每次重绘详情页时重建 */
  let assistantRailObserver = null;
  /** 助手记忆读取状态：idle | loading | ready | error。记录本体由 AssistantMemoryStore 持有。 */
  let assistantLoadState = 'idle';
  let assistantSearchOpen = false;
  let assistantSearchQuery = '';
  let assistantSelectionMode = false;
  const assistantSelectedIds = new Set();
  let assistantEditorOpen = false;
  let assistantEditorEntryId = '';
  /** entry = 新增 / 编辑原记录；completion = 未完事项的完成记录。 */
  let assistantEditorMode = 'entry';
  let assistantEditorReturnFocus = null;
  let assistantOverlayReturnFocus = null;
  /** 编辑面板打开时的表单快照，用于判断是否有未保存的修改 */
  let assistantEditorSnapshot = '';
  let assistantConfirmBusy = false;
  /** 编辑面板的 visualViewport 监听卸载函数 */
  let assistantKeyboardCleanup = null;
  /** 当前选中的 Tab：daily | fork | char */
  let currentTab = 'fork';
  /** 「其他分支」是否展开 */
  let othersExpanded = false;
  /** 本次持有的封面 objectURL，重绘或关页统一释放 */
  let coverUrls = [];

  /** 早期版本会往库里播种 4 条演示记忆，这里一次性清掉，之后不再播种 */
  const DEMO_PURGE_FLAG = 'retroflow_memory_demo_purged_v1';

  async function purgeDemoOnce() {
    try {
      if (localStorage.getItem(DEMO_PURGE_FLAG)) return;
      if (window.MemoryStore && typeof MemoryStore.purgeDemoMemories === 'function') {
        await MemoryStore.purgeDemoMemories();
      }
      localStorage.setItem(DEMO_PURGE_FLAG, '1');
    } catch (_) { /* 清不掉也不挡页面 */ }
  }

  /* ---------------- 数据读取 ---------------- */

  /** 副本清单：与副本库同源，按创建序号升序，无号的老数据沉底 */
  function readForkIndex() {
    if (!window.Store || !Store.fork || !Array.isArray(Store.fork.index)) return [];
    const seqOf = (it) => {
      const n = Number(it && it.seq);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    return Store.fork.index
      .filter(Boolean)
      .slice()
      .sort((a, b) => {
        const sa = seqOf(a);
        const sb = seqOf(b);
        if (sa && sb) return sa - sb;
        if (sa) return -1;
        if (sb) return 1;
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      });
  }

  /** 一次取全量记忆，按 forkId 汇总条数（避免逐副本各查一次全表） */
  async function collectCounts() {
    const map = new Map();
    if (!window.Storage || typeof Storage.getAllMemories !== 'function') return map;
    try {
      const all = await Storage.getAllMemories();
      all.forEach((m) => {
        if (!m || m.memKind !== 'event') return;
        const k = String(m.forkId || '');
        if (!k) return;
        map.set(k, (map.get(k) || 0) + 1);
      });
    } catch (_) { /* 读不到就按 0 条呈现 */ }
    return map;
  }

  /** 在场角色名：roster 是权威源，记忆里只存 ID */
  function rosterName(id) {
    const key = String(id || '').trim();
    if (!key) return '';
    const roster = (window.Store && Store.roster) || {};
    const chars = Array.isArray(roster.characters) ? roster.characters : [];
    const npcs = Array.isArray(roster.npcs) ? roster.npcs : [];
    const hit = chars.find((c) => c && c.id === key) || npcs.find((n) => n && n.id === key);
    return (hit && hit.name) ? String(hit.name) : key;
  }

  function levelOf(item) {
    return LEVEL_MAP[(item && item.levelKey) || 'C'] || LEVEL_MAP['C'];
  }

  function forkCode(item) {
    if (item && item.code) return String(item.code);
    const seq = Number(item && item.seq);
    return Number.isFinite(seq) && seq > 0 ? `FORK-${String(seq).padStart(2, '0')}` : 'FORK-待归档';
  }

  /* ---------------- DOM 装配 ---------------- */

  function ensureDOM() {
    if (containerEl) return;
    containerEl = document.createElement('div');
    containerEl.id = 'memoryBankApp';
    containerEl.className = 'mem-app';
    containerEl.setAttribute('role', 'dialog');
    containerEl.setAttribute('aria-label', '数据归档记忆库');
    containerEl.setAttribute('aria-modal', 'true');
    containerEl.innerHTML = `
      <div class="mem-app-inner">
        <header class="mem-header" id="memHeader"></header>
        <div class="mem-search" id="memSearch" role="search" hidden>
          <span class="mem-search-icon">${ICONS.search}</span>
          <input class="mem-search-input" id="memSearchInput" type="search"
                 placeholder="搜索副本名称" aria-label="搜索副本名称"
                 aria-controls="memViewport" autocomplete="off" spellcheck="false"
                 enterkeyhint="search" />
          <button class="mem-search-clear" id="memSearchClear" type="button"
                  aria-label="清空搜索" hidden>${ICONS.clear}</button>
        </div>
        <main class="mem-viewport" id="memViewport"></main>
        <div class="mem-list-manage-bar" id="memListManageBar" hidden></div>
        <div class="mem-entry-editor" id="memEntryEditor" hidden></div>
        <svg class="mem-margin-note" id="memMarginNote" viewBox="0 0 30 620" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false" hidden>
          <text transform="translate(15 12) rotate(90)" textLength="596" lengthAdjust="spacing">WE FOLLOW THE CURRENT BACKWARD, UNTIL EVERY MEMORY FINDS ITS WAY HOME.</text>
        </svg>
        <div class="mem-tab-bar" id="memTabBar">
          <button class="mem-tab-btn ${currentTab === 'daily' ? 'is-active' : ''}" data-tab="daily">
            <span class="mem-tab-text">
              <span class="mem-tab-en">01 DAILY</span>
              <span class="mem-tab-zh">日常</span>
            </span>
          </button>
          <button class="mem-tab-btn ${currentTab === 'fork' ? 'is-active' : ''}" data-tab="fork">
            <span class="mem-tab-text">
              <span class="mem-tab-en">02 FORK</span>
              <span class="mem-tab-zh">副本</span>
            </span>
          </button>
          <button class="mem-tab-btn ${currentTab === 'char' ? 'is-active' : ''}" data-tab="char">
            <span class="mem-tab-text">
              <span class="mem-tab-en">03 ROLE</span>
              <span class="mem-tab-zh">角色</span>
            </span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(containerEl);
    headerEl = containerEl.querySelector('#memHeader');
    viewportEl = containerEl.querySelector('#memViewport');
    tabBarEl = containerEl.querySelector('#memTabBar');
    marginNoteEl = containerEl.querySelector('#memMarginNote');
    searchWrapEl = containerEl.querySelector('#memSearch');
    searchInputEl = containerEl.querySelector('#memSearchInput');
    searchClearEl = containerEl.querySelector('#memSearchClear');

    searchInputEl.addEventListener('input', () => {
      searchQuery = searchInputEl.value;
      syncSearchUI();
      viewportEl.scrollTop = 0;
      renderWall();
    });
    searchInputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    });
    searchClearEl.addEventListener('click', () => {
      clearSearch();
      searchInputEl.focus();
    });

    tabBarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.mem-tab-btn');
      if (btn) switchTab(btn.getAttribute('data-tab'));
    });

    bindAssistantOverlayEvents();
  }

  function setMarginNoteVisible(visible) {
    if (marginNoteEl) marginNoteEl.toggleAttribute('hidden', !visible);
  }

  function setSearchVisible(visible) {
    if (!searchWrapEl) return;
    searchWrapEl.toggleAttribute('hidden', !visible);
    if (!visible && document.activeElement === searchInputEl) searchInputEl.blur();
  }

  function syncSearchUI() {
    if (!searchInputEl || !searchClearEl) return;
    if (searchInputEl.value !== searchQuery) searchInputEl.value = searchQuery;
    searchClearEl.toggleAttribute('hidden', !searchQuery);
  }

  function clearSearch() {
    if (!searchQuery && (!searchInputEl || !searchInputEl.value)) return;
    searchQuery = '';
    syncSearchUI();
    viewportEl.scrollTop = 0;
    renderWall();
  }

  function switchTab(tabId) {
    if (currentTab === tabId && !isAssistantMemory) return;
    resetAssistantListTools();
    const fromMemoryIndex = isAssistantMemory;
    currentTab = tabId;
    isAssistantMemory = false;
    currentAssistantCategory = '';
    currentForkId = '';
    if (fromMemoryIndex && ((window.location.hash || '').indexOf('#memory-bank/assistant-memory') === 0)) {
      try {
        window.history.replaceState({ rfPage: 'memory-bank' }, '', '#memory-bank');
      } catch (_) {}
    }
    wallRenderSeq++;
    setSearchVisible(false);
    setMarginNoteVisible(false);
    releaseCovers();
    tabBarEl.querySelectorAll('.mem-tab-btn').forEach(b => {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tabId);
    });
    if (currentTab === 'fork') renderWall();
    else if (currentTab === 'daily') renderDaily();
    else {
      renderHeader('wall');
      viewportEl.innerHTML = `<div class="mem-empty">${emptyBoxHtml('WIP', '正在开发中...')}</div>`;
    }
  }

/* ---------------- 日常：目的地入口与助手记忆索引 ---------------- */

  function renderDaily() {
    if (!viewportEl) return;
    resetAssistantListTools();
    wallRenderSeq++;
    currentTab = 'daily';
    currentForkId = '';
    isAssistantMemory = false;
    currentAssistantCategory = '';
    releaseCovers();
    setSearchVisible(false);
    setMarginNoteVisible(false);
    renderHeader('wall');
    tabBarEl.querySelectorAll('.mem-tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === 'daily');
    });

    viewportEl.innerHTML = `
      <div class="mem-daily mem-view-in">
        <div class="mem-daily-entries">
          <button type="button" class="mem-daily-entry is-prism" data-daily-entry="assistant-memory" aria-label="进入助手记忆">
            <span class="mem-daily-prism-window" aria-hidden="true">
              <span class="mem-daily-prism-frame is-back">${DAILY_ICONS.prismFrame}</span>
              <span class="mem-daily-prism-frame is-middle">${DAILY_ICONS.prismFrame}</span>
              <span class="mem-daily-prism-frame is-front">${DAILY_ICONS.prismFrame}</span>
              <span class="mem-daily-prism-core">${DAILY_ICONS.prismCore}</span>
            </span>
            <span class="mem-daily-entry-copy">
              <span class="mem-daily-entry-code">01 / MEMORY PRISM</span>
              <span class="mem-daily-entry-title">助手记忆</span>
              <span class="mem-daily-entry-caption">留存的另一种形状</span>
            </span>
          </button>

          <button type="button" class="mem-daily-entry is-space" data-daily-entry="retroflow-space" aria-label="溯流空间，静态入口预览" aria-disabled="true">
            <span class="mem-daily-space-word" aria-hidden="true">PRIVATE<br>SPACE</span>
            <svg class="mem-daily-door" viewBox="0 0 180 220" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true">
              <path class="mem-daily-door-plane" d="M46 190 102 171V50L46 69Z"/>
              <path d="M29 202V48L123 16v154L29 202Z" stroke-width="1.3"/>
              <path d="M46 190 102 171V50L46 69Z" stroke-width="1.3"/>
              <path d="M46 69 29 48M102 50l21-34M102 171l21-1" stroke-width="1" opacity=".55"/>
              <path d="M66 115 76 111.6V121.6L66 125Z" stroke-width="1.1"/>
              <path d="m18 213 115-42 28 12-116 43Z" stroke-width="1" opacity=".4"/>
            </svg>
            <span class="mem-daily-entry-copy">
              <span class="mem-daily-entry-code">02 / THE WAY HOME</span>
              <span class="mem-daily-entry-title">溯流空间</span>
              <span class="mem-daily-entry-caption">副本之外，回到自己的所在</span>
            </span>
          </button>

          <button type="button" class="mem-daily-entry is-event" data-daily-entry="other-events" aria-label="其他事件，静态入口预览" aria-disabled="true">
            <svg class="mem-daily-coordinates" viewBox="0 0 130 110" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
              <path d="M10 24h44M10 24v44M76 92h44M120 48v44" opacity=".22"/>
              <path d="M30 54h70M65 19v70" stroke-dasharray="2 6" opacity=".25"/>
              <circle cx="65" cy="54" r="26" opacity=".25"/>
              <path d="M65 33c-10 0-18 8-18 18 0 13 18 29 18 29s18-16 18-29c0-10-8-18-18-18Z" stroke-width="1.3"/>
              <circle cx="65" cy="51" r="5" stroke-width="1.3"/>
              <path d="m13 17 7 7-7 7M110 85l7 7-7 7" opacity=".45"/>
            </svg>
            <span class="mem-daily-entry-copy">
              <span class="mem-daily-entry-code">03 / EVENT COORDINATES</span>
              <span class="mem-daily-entry-title">其他事件</span>
              <span class="mem-daily-entry-caption">日常由此留下坐标</span>
            </span>
          </button>
        </div>
      </div>
    `;

    const entry = viewportEl.querySelector('[data-daily-entry="assistant-memory"]');
    if (entry) entry.addEventListener('click', openAssistantMemory);
  }

  function openAssistantMemory() {
    if (isAssistantMemory && !currentAssistantCategory) return;
    isAssistantMemory = true;
    currentAssistantCategory = '';
    try {
      window.history.pushState({ rfPage: 'memory-bank', memoryIndex: true }, '', '#memory-bank/assistant-memory');
    } catch (_) {}
    renderAssistantMemory();
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  function getAssistantCategory(catId) {
    const key = String(catId || '').trim();
    return MEMORY_CATEGORIES.find((c) => c.id === key) || MEMORY_CATEGORIES[0];
  }

  function assistantStore() {
    return window.AssistantMemoryStore || null;
  }

  function assistantMemoryReady() {
    const store = assistantStore();
    return Boolean(store && store.isLoaded());
  }

  /** 分类记录（新在前）。返回存储模块的缓存数组，页面只读不改，写入一律走 commitAssistantChanges。 */
  function getAssistantEntries(cat) {
    const store = assistantStore();
    return store && store.isLoaded() ? store.list(cat.id) : [];
  }

  /** 首次进入分类详情时读取记忆库；读完后如仍停在详情页，就地刷新列表。 */
  function ensureAssistantMemoryLoaded() {
    const store = assistantStore();
    if (!store) {
      assistantLoadState = 'error';
      return;
    }
    if (store.isLoaded()) {
      assistantLoadState = 'ready';
      return;
    }
    if (assistantLoadState === 'loading') return;
    assistantLoadState = 'loading';
    store.load().then(() => {
      assistantLoadState = 'ready';
    }).catch((err) => {
      assistantLoadState = 'error';
      console.warn('[MemoryBank] 助手记忆读取失败：', err);
    }).then(() => {
      if (isOpened && currentAssistantCategory) updateAssistantList();
    });
  }

  /** 写库：成功后缓存才会变化；失败抛错，由调用方提示，界面保持原状。 */
  async function commitAssistantChanges(ops) {
    const store = assistantStore();
    if (!store || !store.isLoaded()) throw new Error('记忆库尚未读取完成');
    return store.commit(ops);
  }

  function assistantToolState(tool, entryId) {
    return {
      rfPage: 'memory-bank',
      assistantCategory: currentAssistantCategory,
      memTool: tool,
      entryId: entryId || ''
    };
  }

  function pushAssistantToolState(tool, entryId) {
    try {
      window.history.pushState(
        assistantToolState(tool, entryId),
        '',
        `#memory-bank/assistant-memory/${currentAssistantCategory}`
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function setAssistantBackgroundInert(inert) {
    [headerEl, viewportEl, tabBarEl].forEach((el) => {
      if (!el) return;
      if (inert) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function restoreAssistantFocus(target, fallbackSelector) {
    window.setTimeout(() => {
      const fallback = fallbackSelector && viewportEl ? viewportEl.querySelector(fallbackSelector) : null;
      const el = target && target.isConnected ? target : fallback;
      if (el && typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
      }
    }, 0);
  }

  function resetAssistantListTools() {
    detachAssistantKeyboard();
    assistantSearchOpen = false;
    assistantSearchQuery = '';
    assistantSelectionMode = false;
    assistantSelectedIds.clear();
    assistantEditorOpen = false;
    assistantEditorEntryId = '';
    assistantEditorMode = 'entry';
    assistantEditorReturnFocus = null;
    assistantOverlayReturnFocus = null;
    assistantEditorSnapshot = '';
    setAssistantBackgroundInert(false);
    const manageBar = containerEl && containerEl.querySelector('#memListManageBar');
    const editor = containerEl && containerEl.querySelector('#memEntryEditor');
    if (manageBar) {
      manageBar.hidden = true;
      manageBar.innerHTML = '';
    }
    if (editor) {
      editor.hidden = true;
      editor.innerHTML = '';
    }
    if (tabBarEl) tabBarEl.hidden = false;
  }

  function closeAssistantSearch() {
    const returnFocus = assistantOverlayReturnFocus;
    assistantOverlayReturnFocus = null;
    assistantSearchOpen = false;
    assistantSearchQuery = '';
    renderAssistantCategory(currentAssistantCategory, { preserveTools: true });
    restoreAssistantFocus(returnFocus, '[data-assistant-tool="search"]');
  }

  function openAssistantSearch() {
    if (assistantSearchOpen || assistantSelectionMode || assistantEditorOpen) return;
    assistantOverlayReturnFocus = document.activeElement;
    assistantSearchOpen = true;
    assistantSearchQuery = '';
    renderAssistantCategory(currentAssistantCategory, { preserveTools: true });
    // 同步聚焦，iOS 才会在这次点击里弹出键盘
    const input = viewportEl && viewportEl.querySelector('#memAssistantSearchInput');
    if (input) {
      try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    }
  }

  function clearAssistantSearchQuery(input) {
    assistantSearchQuery = '';
    if (input) input.value = '';
    updateAssistantList();
    if (input) input.focus();
  }

  function enterAssistantSelection(fromHistory) {
    if (assistantEditorOpen || assistantSelectionMode) return;
    const cat = getAssistantCategory(currentAssistantCategory);
    // 与按钮、全选共用当前组口径，避免 history 恢复空组时进入无记录多选
    if (!assistantCurrentGroupEntries(cat, getAssistantEntries(cat)).length) return;
    assistantOverlayReturnFocus = document.activeElement;
    assistantSearchOpen = false;
    assistantSearchQuery = '';
    assistantSelectionMode = true;
    assistantSelectedIds.clear();
    if (!fromHistory) pushAssistantToolState('select');
    renderAssistantCategory(currentAssistantCategory, { preserveTools: true });
    // 触发按钮已随重绘移除，把焦点交给操作条，键盘与读屏用户不会丢失位置
    const done = containerEl && containerEl.querySelector('[data-manage="done"]');
    if (done) {
      try { done.focus({ preventScroll: true }); } catch (_) { done.focus(); }
    }
  }

  function toggleAssistantSelected(card) {
    const id = card && card.getAttribute('data-entry-id');
    if (!id) return;
    if (assistantSelectedIds.has(id)) assistantSelectedIds.delete(id);
    else assistantSelectedIds.add(id);
    const on = assistantSelectedIds.has(id);
    card.classList.toggle('is-selected', on);
    card.setAttribute('aria-checked', on ? 'true' : 'false');
    const allBtn = viewportEl && viewportEl.querySelector('[data-assistant-tool="select-all"]');
    if (allBtn) {
      const cat = getAssistantCategory(currentAssistantCategory);
      const entries = assistantCurrentGroupEntries(cat, getAssistantEntries(cat));
      const all = entries.length > 0 && entries.every((e) => assistantSelectedIds.has(e.id));
      allBtn.textContent = all ? '取消全选' : '全选';
    }
    syncAssistantManageBar();
  }

  /** 多选时由操作条替代底部 Tab；退出多选再把 Tab 交还。 */
  function syncAssistantManageBar() {
    const bar = containerEl && containerEl.querySelector('#memListManageBar');
    if (!bar) return;
    if (!assistantSelectionMode) {
      bar.hidden = true;
      bar.innerHTML = '';
      if (tabBarEl) tabBarEl.hidden = false;
      return;
    }
    if (tabBarEl) tabBarEl.hidden = true;
    if (!bar.firstElementChild) {
      bar.innerHTML = `
        <span class="mem-manage-count" data-manage-count aria-live="polite"></span>
        <button type="button" class="mem-manage-btn" data-manage="delete">${ICONS.trash}<span>删除</span></button>
        <button type="button" class="mem-manage-btn is-done" data-manage="done">完成</button>
      `;
    }
    bar.hidden = false;
    const n = assistantSelectedIds.size;
    const countEl = bar.querySelector('[data-manage-count]');
    if (countEl) countEl.textContent = n ? `已选 ${n} 项` : '未选择';
    const del = bar.querySelector('[data-manage="delete"]');
    if (del) {
      del.disabled = !n;
      del.setAttribute('aria-label', n ? `删除已选的 ${n} 项` : '删除，尚未选择');
    }
  }

  /** 项目确认弹窗；模块缺席时退回原生 confirm，保证危险操作一定有确认。 */
  async function confirmAssistantAction(options) {
    if (window.RetroModal && typeof window.RetroModal.confirm === 'function') {
      try { return await window.RetroModal.confirm(options); } catch (_) { /* 落到原生兜底 */ }
    }
    try {
      return window.confirm(`${options.message}\n${options.detail || ''}`);
    } catch (_) {
      return false;
    }
  }

  function assistantToast(message, detail) {
    if (!window.RetroToast || typeof window.RetroToast.show !== 'function') return;
    try {
      window.RetroToast.show({ tag: 'MEMORY // 已保存', message, detail, type: 'success' });
    } catch (_) {}
  }

  function assistantErrorToast(message, err) {
    const detail = (err && err.message) || '写入本机记忆库失败，请重试。';
    if (!window.RetroToast || typeof window.RetroToast.show !== 'function') return;
    try {
      window.RetroToast.show({ tag: 'MEMORY // 写入失败', message, detail, type: 'error' });
    } catch (_) {}
  }

  async function deleteAssistantEntry(id) {
    if (assistantConfirmBusy || assistantSelectionMode || assistantEditorOpen) return;
    const catId = currentAssistantCategory;
    const entries = getAssistantEntries(getAssistantCategory(catId));
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    assistantConfirmBusy = true;
    let ok = false;
    try {
      ok = await confirmAssistantAction({
        message: `删除「${entry.title || '无题记忆'}」？`,
        detail: '删除后无法恢复。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      });
    } finally {
      assistantConfirmBusy = false;
    }
    if (!ok || !isOpened || currentAssistantCategory !== catId || assistantSelectionMode || assistantEditorOpen) return;
    if (entries.findIndex((e) => e.id === id) === -1) return;
    assistantConfirmBusy = true;
    try {
      await commitAssistantChanges({ remove: [id] });
    } catch (err) {
      assistantErrorToast('删除失败，记录仍然保留', err);
      return;
    } finally {
      assistantConfirmBusy = false;
    }
    if (!isOpened || currentAssistantCategory !== catId) return;
    updateAssistantList();
    const visibleEntries = assistantCurrentGroupEntries(getAssistantCategory(catId), entries);
    const next = visibleEntries.find((e) => e.id !== id) || visibleEntries[0];
    restoreAssistantFocus(
      next && viewportEl ? viewportEl.querySelector(`[data-entry-id="${next.id}"] [data-entry-action="delete"]`) : null,
      '[data-assistant-tool="add"]'
    );
    assistantToast('已删除 1 条记录');
  }

  async function deleteAssistantSelected() {
    if (assistantConfirmBusy || !assistantSelectionMode) return;
    const n = assistantSelectedIds.size;
    if (!n) return;
    const catId = currentAssistantCategory;
    assistantConfirmBusy = true;
    let ok = false;
    try {
      ok = await confirmAssistantAction({
        message: `删除已选的 ${n} 条记录？`,
        detail: '删除后无法恢复。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      });
    } finally {
      assistantConfirmBusy = false;
    }
    if (!ok || !isOpened || !assistantSelectionMode || currentAssistantCategory !== catId) return;
    const ids = Array.from(assistantSelectedIds);
    assistantConfirmBusy = true;
    try {
      await commitAssistantChanges({ remove: ids });
    } catch (err) {
      assistantErrorToast('删除失败，记录仍然保留', err);
      return;
    } finally {
      assistantConfirmBusy = false;
    }
    if (!isOpened || currentAssistantCategory !== catId) return;
    assistantSelectedIds.clear();
    if (assistantSelectionMode) requestCloseAssistantLayer();
    else updateAssistantList();
    assistantToast(`已删除 ${ids.length} 条记录`);
  }
  /* ---------- 新增 / 编辑底部面板 ---------- */


  /** iOS 键盘不缩视口，用 visualViewport 算出被遮住的高度；安卓缩视口时结果约为 0。 */
  function attachAssistantKeyboard(editor) {
    detachAssistantKeyboard();
    const vv = window.visualViewport;
    if (!vv || !editor) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      editor.style.setProperty('--mem-kb-inset', `${Math.round(inset)}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    assistantKeyboardCleanup = () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      editor.style.removeProperty('--mem-kb-inset');
    };
  }

  function detachAssistantKeyboard() {
    if (!assistantKeyboardCleanup) return;
    const fn = assistantKeyboardCleanup;
    assistantKeyboardCleanup = null;
    fn();
  }

  function getAssistantEditorForm() {
    return containerEl ? containerEl.querySelector('#memEntryEditor form') : null;
  }

  function assistantEditorField(form, name) {
    return form && form.elements ? form.elements.namedItem(name) : null;
  }

  function assistantEditorSnapshotOf(form) {
    return JSON.stringify(['group', 'title', 'keywords', 'primary', 'time', 'rank', 'body', 'completedDate', 'completionNote'].map((name) => {
      const el = assistantEditorField(form, name);
      return el ? el.value : '';
    }));
  }

  /** 完成态只追加完成日期与说明；原目标的标题、正文和记录时间均不改动。 */
  function assistantEntryCompleted(entry) {
    return Boolean(entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.completedDate || ''));
  }

  function assistantLocalDateInput(raw) {
    const d = raw ? new Date(raw) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function formatAssistantCompletionDate(raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || ''));
    return m ? `${m[1]}.${m[2]}.${m[3]}` : String(raw || '日期不详');
  }

  /** 展示层排序，原数组保持原样，多选与删除继续使用稳定的 ID。 */
  function assistantDisplayEntries(cat, entries) {
    if (cat.id !== 'pending') return entries;
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
      const completed = Number(assistantEntryCompleted(a.entry)) - Number(assistantEntryCompleted(b.entry));
      if (completed) return completed;
      if (assistantEntryCompleted(a.entry)) {
        const dateOrder = b.entry.completedDate.localeCompare(a.entry.completedDate);
        return dateOrder || (b.index - a.index);
      }
      return a.index - b.index;
    }).map((item) => item.entry);
  }

  /** 记录时间 → datetime-local 输入值（本地时区，精确到分钟）；无效时间返回空串 */
  function toAssistantTimeInput(raw) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 只有明确配置了分组的分类使用书签；其余分类始终平铺。 */
  function assistantGroupsOf(catOrId) {
    const catId = typeof catOrId === 'string' ? catOrId : catOrId && catOrId.id;
    return ASSISTANT_GROUPS[catId] || null;
  }

  function assistantGroupMeta(catOrId, groupId) {
    const groups = assistantGroupsOf(catOrId);
    return groups ? groups.find((g) => g.id === groupId) || null : null;
  }

  function assistantCurrentGroup(catOrId) {
    const groups = assistantGroupsOf(catOrId);
    if (!groups || !groups.length) return '';
    const catId = typeof catOrId === 'string' ? catOrId : catOrId.id;
    return assistantGroupMeta(catId, assistantCurrentGroups[catId])
      ? assistantCurrentGroups[catId]
      : groups[0].id;
  }

  function setAssistantCurrentGroup(catId, groupId) {
    if (assistantGroupMeta(catId, groupId)) assistantCurrentGroups[catId] = groupId;
  }

  /** 未知或缺失的 groupId 回退到该分类首组，避免旧预览记录消失。 */
  function assistantGroupOf(catOrId, entry) {
    const groups = assistantGroupsOf(catOrId);
    if (!groups || !groups.length) return '';
    const groupId = entry && entry.groupId;
    return groups.some((g) => g.id === groupId) ? groupId : groups[0].id;
  }

  /** 搜索、多选、删除和焦点恢复共用同一分组口径。 */
  function assistantCurrentGroupEntries(cat, entries) {
    if (!assistantGroupsOf(cat)) return entries;
    const currentGroup = assistantCurrentGroup(cat);
    return entries.filter((e) => assistantGroupOf(cat, e) === currentGroup);
  }

  function operatorGroupMeta(groupId) {
    return assistantGroupMeta('operator', groupId);
  }

  function operatorGroupOf(entry) {
    return assistantGroupOf('operator', entry);
  }

  /* ---------------- 记忆权重：三档单选，全库 20 条永久上限 ---------------- */
  const MEMORY_RANKS = [
    { value: 'normal', label: '普通' },
    { value: 'important', label: '重要' },
    { value: 'pinned', label: '永久' }
  ];
  const MEMORY_RANK_LIMIT = 20;

  /** 权重归一：未知值一律按普通处理，旧数据不带 rank 也不受影响 */
  function memoryRankOf(entry) {
    const r = entry && entry.rank;
    return r === 'important' || r === 'pinned' ? r : 'normal';
  }

  /** 全库永久条数（七分类共用额度） */
  function countPinnedEntries() {
    const store = assistantStore();
    return store && store.isLoaded() ? store.countPinned() : 0;
  }

  /** 保存时兜底校验：编辑中把旧永久改成其他档位会释放一个名额 */
  function pinnedQuotaAvailable(changingId) {
    const store = assistantStore();
    if (!store || !store.isLoaded()) return false;
    return store.countPinned(changingId) < MEMORY_RANK_LIMIT;
  }

  /** 越早越靠前：先比记录时间，再比创建时间。 */
  function assistantOldestFirst(a, b) {
    const store = assistantStore();
    if (store) return store.oldestFirst(a, b);
    return (Date.parse(a && a.time) || 0) - (Date.parse(b && b.time) || 0);
  }

  /** 编辑面板里选中满额分组时，提前说明保存后会删掉哪一条。 */
  function syncAssistantPoolHint(form) {
    const hint = form && form.querySelector('[data-pool-hint]');
    if (!hint) return;
    const groupField = assistantEditorField(form, 'group');
    const groupId = groupField ? groupField.value : '';
    const cat = getAssistantCategory(currentAssistantCategory);
    const meta = cat.id === 'operator' ? operatorGroupMeta(groupId) : null;
    const entries = getAssistantEntries(cat);
    const editing = assistantEditorEntryId ? entries.find((e) => e.id === assistantEditorEntryId) : null;
    const alreadyIn = editing && operatorGroupOf(editing) === groupId;
    const pool = cat.id === 'operator'
      ? entries.filter((e) => operatorGroupOf(e) === groupId && e.id !== assistantEditorEntryId)
      : [];
    if (!meta || !meta.maxLimit || alreadyIn || pool.length < meta.maxLimit) {
      hint.hidden = true;
      hint.textContent = '';
      return;
    }
    // 永久记忆不会被淘汰，提示只点名最早会被删的非永久记录
    const oldest = pool.filter((e) => memoryRankOf(e) !== 'pinned').sort(assistantOldestFirst)[0];
    if (!oldest) {
      hint.textContent = `「${meta.name}」已满 ${meta.maxLimit} 条，且全部是永久记忆，请先改组或取消部分永久标记。`;
    } else {
      hint.textContent = `「${meta.name}」已满 ${meta.maxLimit} 条，保存后会删除时间最早的「${oldest.title || '无题记忆'}」（${formatAssistantTime(oldest.time)}）。永久记忆不会被删除。`;
    }
    hint.hidden = false;
  }

  /** 记忆权重三档单选 + 永久额度显示；额度满时永久选项置灰。 */
  function syncAssistantRankUi(form) {
    const pinnedEl = form && form.querySelector('[data-rank-pinned]');
    const hint = form && form.querySelector('[data-rank-hint]');
    if (!pinnedEl) return;
    const editing = assistantEditorEntryId;
    const available = pinnedQuotaAvailable(editing);
    pinnedEl.querySelector('input').disabled = !available;
    pinnedEl.classList.toggle('is-full', !available);
    if (hint) {
      hint.textContent = `永久 已用 ${countPinnedEntries()}/${MEMORY_RANK_LIMIT} 条，全局共用。永久记忆不会被近期池淘汰。`;
    }
  }

  function parseAssistantKeywords(raw) {
    const seen = new Set();
    return String(raw || '')
      .split(/[,，、;；\n]+/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s || seen.has(s)) return false;
        seen.add(s);
        return true;
      })
      .slice(0, 12);
  }

  function openAssistantEditor(entryId, mode) {
    if (assistantEditorOpen || assistantSelectionMode || assistantConfirmBusy) return;
    if (!assistantMemoryReady()) return;
    const editor = containerEl && containerEl.querySelector('#memEntryEditor');
    if (!editor) return;
    const cat = getAssistantCategory(currentAssistantCategory);
    const entry = entryId ? getAssistantEntries(cat).find((e) => e.id === entryId) : null;
    if (entryId && !entry) return;
    if (mode === 'completion' && (cat.id !== 'pending' || !entry)) return;
    assistantEditorMode = mode === 'completion' ? 'completion' : 'entry';
    if (assistantEditorMode === 'completion') {
      openAssistantCompletionEditor(entry, editor);
      return;
    }
    const isEdit = Boolean(entry);
    const groups = assistantGroupsOf(cat);
    const editGroup = groups
      ? (isEdit ? assistantGroupOf(cat, entry) : assistantCurrentGroup(cat))
      : '';
    const editRank = isEdit ? memoryRankOf(entry) : 'normal';

    assistantEditorReturnFocus = document.activeElement;
    assistantEditorOpen = true;
    assistantEditorEntryId = isEdit ? entry.id : '';

    const groupFieldHtml = groups ? `
          <div class="mem-editor-field" role="radiogroup" aria-labelledby="memEditorGroupLabel">
            <span class="mem-editor-label" id="memEditorGroupLabel">分组</span>
            <div class="mem-editor-groups">
              ${groups.map((g) => `
                <label class="mem-editor-group-chip">
                  <input type="radio" name="group" value="${g.id}" ${g.id === editGroup ? 'checked' : ''}>
                  <span>${escapeHtml(g.fullName || g.name)}</span>
                </label>
              `).join('')}
            </div>
            <p class="mem-editor-pool-hint" data-pool-hint role="status" hidden></p>
          </div>
    ` : '';

    editor.innerHTML = `
      <div class="mem-editor-backdrop" data-editor-dismiss aria-hidden="true"></div>
      <form class="mem-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="memEditorTitle" novalidate>
        <div class="mem-editor-head">
          <div class="mem-editor-heading">
            <span class="mem-editor-code">${escapeHtml(cat.number)} / ${escapeHtml(cat.en)} · ${isEdit ? 'EDIT' : 'NEW ENTRY'}</span>
            <h3 class="mem-editor-title" id="memEditorTitle" tabindex="-1">${isEdit ? '编辑记录' : `新增到「${escapeHtml(cat.name)}」`}</h3>
          </div>
          <button type="button" class="mem-editor-close" data-editor-dismiss aria-label="关闭面板">${ICONS.close}</button>
        </div>
        <div class="mem-editor-body">
          ${groupFieldHtml}
          <label class="mem-editor-field">
            <span class="mem-editor-label">标题</span>
            <input class="mem-editor-input" name="title" type="text" maxlength="40" autocomplete="off" placeholder="给这条记录起个名字" enterkeyhint="next" required>
          </label>
          <label class="mem-editor-field">
            <span class="mem-editor-label">关键词<span class="mem-editor-hint">用逗号或顿号分隔</span></span>
            <input class="mem-editor-input" name="keywords" type="text" maxlength="120" autocomplete="off" placeholder="例如：雨夜、玄关、热牛奶" enterkeyhint="next">
          </label>
          <label class="mem-editor-field">
            <span class="mem-editor-label">主要关键词<span class="mem-editor-hint">留空则取第一个关键词</span></span>
            <input class="mem-editor-input" name="primary" type="text" maxlength="20" autocomplete="off" enterkeyhint="next">
          </label>
          <label class="mem-editor-field">
            <span class="mem-editor-label">时间<span class="mem-editor-hint">记录发生的时间</span></span>
            <input class="mem-editor-input mem-editor-time" name="time" type="datetime-local" step="60" required>
          </label>
          <div class="mem-editor-field" role="radiogroup" aria-labelledby="memEditorRankLabel">
            <span class="mem-editor-label" id="memEditorRankLabel">记忆权重<span class="mem-editor-hint" data-rank-hint></span></span>
            <div class="mem-editor-groups">
              ${MEMORY_RANKS.map((r) => `
                <label class="mem-editor-group-chip" ${r.value === 'pinned' ? 'data-rank-pinned' : ''}>
                  <input type="radio" name="rank" value="${r.value}" ${r.value === editRank ? 'checked' : ''}>
                  <span>${r.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <label class="mem-editor-field">
            <span class="mem-editor-label">正文</span>
            <textarea class="mem-editor-textarea" name="body" rows="6" maxlength="2000" placeholder="写下当时发生了什么" required></textarea>
          </label>
          <p class="mem-editor-error" role="alert" hidden></p>
        </div>
        <div class="mem-editor-foot">
          <p class="mem-editor-note">保存到本机记忆库，所有助手共用。</p>
          <div class="mem-editor-actions">
            <button type="button" class="mem-editor-btn is-ghost" data-editor-dismiss>取消</button>
            <button type="submit" class="mem-editor-btn is-primary">保存</button>
          </div>
        </div>
      </form>
    `;

    const form = editor.querySelector('form');
    if (isEdit) {
      assistantEditorField(form, 'title').value = entry.title || '';
      assistantEditorField(form, 'keywords').value = (entry.keywords || []).join('、');
      assistantEditorField(form, 'primary').value = entry.primaryKeyword || '';
      assistantEditorField(form, 'body').value = entry.body || '';
    }
    assistantEditorField(form, 'time').value = toAssistantTimeInput(isEdit ? entry.time : new Date());
    form.dataset.initialTime = assistantEditorField(form, 'time').value;
    syncAssistantPoolHint(form);
    syncAssistantRankUi(form);
    assistantEditorSnapshot = assistantEditorSnapshotOf(form);

    editor.hidden = false;
    setAssistantBackgroundInert(true);
    pushAssistantToolState('edit', assistantEditorEntryId);
    attachAssistantKeyboard(editor);
    // 先挂到下一帧再加 is-open，让面板的进入过渡生效
    window.requestAnimationFrame(() => {
      if (assistantEditorOpen) editor.classList.add('is-open');
    });

    // 新增直接进标题输入；编辑先停在面板标题，不主动弹键盘
    const focusTarget = isEdit ? editor.querySelector('#memEditorTitle') : assistantEditorField(form, 'title');
    if (focusTarget) {
      try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus(); }
    }
  }

  function openAssistantCompletionEditor(entry, editor) {
    const wasCompleted = assistantEntryCompleted(entry);
    const title = wasCompleted ? '完成记录' : '记录完成';
    assistantEditorReturnFocus = document.activeElement;
    assistantEditorOpen = true;
    assistantEditorEntryId = entry.id;
    editor.innerHTML = `
      <div class="mem-editor-backdrop" data-editor-dismiss aria-hidden="true"></div>
      <form class="mem-editor-sheet mem-completion-sheet" role="dialog" aria-modal="true" aria-labelledby="memEditorTitle" novalidate>
        <div class="mem-editor-head">
          <div class="mem-editor-heading">
            <span class="mem-editor-code">06 / PROMISES · ${wasCompleted ? 'FULFILLED' : 'RECORD COMPLETION'}</span>
            <h3 class="mem-editor-title" id="memEditorTitle" tabindex="-1">${title}</h3>
            <p class="mem-completion-target">「${escapeHtml(entry.title || '无题记忆')}」</p>
          </div>
          <button type="button" class="mem-editor-close" data-editor-dismiss aria-label="关闭面板">${ICONS.close}</button>
        </div>
        <div class="mem-editor-body">
          <label class="mem-editor-field">
            <span class="mem-editor-label">完成日期</span>
            <input class="mem-editor-input mem-editor-time" name="completedDate" type="date" enterkeyhint="next" required>
          </label>
          <label class="mem-editor-field">
            <span class="mem-editor-label">完成说明</span>
            <textarea class="mem-editor-textarea mem-completion-note" name="completionNote" rows="3" maxlength="160" placeholder="这个目标被实现了" required></textarea>
          </label>
          <p class="mem-editor-error" role="alert" hidden></p>
        </div>
        <div class="mem-editor-foot">
          <p class="mem-editor-note">原目标会保留，完成记录保存到本机记忆库。</p>
          <div class="mem-editor-actions">
            <button type="button" class="mem-editor-btn is-ghost" data-editor-dismiss>取消</button>
            <button type="submit" class="mem-editor-btn is-primary">${wasCompleted ? '保存修改' : '标记为已完成'}</button>
          </div>
        </div>
      </form>
    `;
    const form = editor.querySelector('form');
    assistantEditorField(form, 'completedDate').value = wasCompleted ? entry.completedDate : assistantLocalDateInput();
    assistantEditorField(form, 'completionNote').value = wasCompleted
      ? String(entry.completionNote || '这个目标被实现了')
      : '这个目标被实现了';
    assistantEditorSnapshot = assistantEditorSnapshotOf(form);
    editor.hidden = false;
    setAssistantBackgroundInert(true);
    pushAssistantToolState('edit', assistantEditorEntryId);
    attachAssistantKeyboard(editor);
    window.requestAnimationFrame(() => {
      if (assistantEditorOpen) editor.classList.add('is-open');
    });
    const focusTarget = editor.querySelector('#memEditorTitle');
    if (focusTarget) {
      try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus(); }
    }
  }

  function showAssistantEditorError(form, fieldName, message) {
    const err = form.querySelector('.mem-editor-error');
    if (err) {
      err.textContent = message;
      err.hidden = false;
    }
    const field = assistantEditorField(form, fieldName);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  /** 防止连点保存时重复写库 */
  let assistantSaving = false;

  async function saveAssistantEditor(form) {
    if (!assistantEditorOpen || !form || assistantSaving) return;
    const store = assistantStore();
    if (!store || !store.isLoaded()) {
      showAssistantEditorError(form, assistantEditorMode === 'completion' ? 'completionNote' : 'title', '记忆库尚未读取完成，暂时不能保存。');
      return;
    }
    if (assistantEditorMode === 'completion') {
      const completedDate = assistantEditorField(form, 'completedDate').value.trim();
      const completionNote = assistantEditorField(form, 'completionNote').value.trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(completedDate) ? new Date(`${completedDate}T12:00:00`) : null;
      if (!date || Number.isNaN(date.getTime()) || assistantLocalDateInput(date) !== completedDate) {
        showAssistantEditorError(form, 'completedDate', '请选择有效的完成日期。');
        return;
      }
      if (!completionNote) {
        showAssistantEditorError(form, 'completionNote', '请留下一句完成说明。');
        return;
      }
      if (currentAssistantCategory !== 'pending') return;
      const entry = getAssistantEntries(getAssistantCategory('pending')).find((e) => e.id === assistantEditorEntryId);
      if (!entry) {
        showAssistantEditorError(form, 'completionNote', '这个目标已不在列表中，无法保存。');
        return;
      }
      const wasCompleted = assistantEntryCompleted(entry);
      const record = store.normalize(Object.assign({}, entry, { completedDate, completionNote }));
      assistantSaving = true;
      try {
        await commitAssistantChanges({ put: [record] });
      } catch (err) {
        showAssistantEditorError(form, 'completionNote', `保存失败：${(err && err.message) || '写入本机记忆库失败'}，请重试。`);
        return;
      } finally {
        assistantSaving = false;
      }
      if (!assistantEditorOpen) return;
      assistantEditorSnapshot = assistantEditorSnapshotOf(form);
      requestCloseAssistantLayer();
      assistantToast(wasCompleted ? '完成记录已更新' : '目标已标记为已完成', '原目标已保留。');
      return;
    }
    const title = assistantEditorField(form, 'title').value.trim();
    const body = assistantEditorField(form, 'body').value.trim();
    if (!title) {
      showAssistantEditorError(form, 'title', '请填写标题。');
      return;
    }
    if (!body) {
      showAssistantEditorError(form, 'body', '请填写正文。');
      return;
    }
    const keywords = parseAssistantKeywords(assistantEditorField(form, 'keywords').value);
    let primary = assistantEditorField(form, 'primary').value.trim();
    // 主要关键词必须出现在关键词里，高亮规则才会生效
    if (primary && keywords.indexOf(primary) === -1) keywords.unshift(primary);
    if (!primary && keywords.length) primary = keywords[0];

    const cat = getAssistantCategory(currentAssistantCategory);
    const entries = getAssistantEntries(cat);
    const isEdit = Boolean(assistantEditorEntryId);
    const groups = assistantGroupsOf(cat);

    const timeField = assistantEditorField(form, 'time');
    const timeRaw = timeField ? timeField.value.trim() : '';
    const timeDate = timeRaw ? new Date(timeRaw) : null;
    if (!timeDate || Number.isNaN(timeDate.getTime())) {
      showAssistantEditorError(form, 'time', '请填写时间。');
      return;
    }
    const existing = isEdit ? entries.find((e) => e.id === assistantEditorEntryId) : null;
    if (isEdit && !existing) {
      showAssistantEditorError(form, 'title', '这条记录已不在列表中，无法保存。');
      return;
    }
    const groupField = assistantEditorField(form, 'group');
    const groupId = groups
      ? (groupField && assistantGroupMeta(cat, groupField.value)
        ? groupField.value
        : (isEdit ? assistantGroupOf(cat, existing) : assistantCurrentGroup(cat)))
      : '';

    const rankField = assistantEditorField(form, 'rank');
    const rankRaw = rankField && rankField.value ? rankField.value : 'normal';
    const rank = rankRaw === 'important' || rankRaw === 'pinned' ? rankRaw : 'normal';
    // 永久额度兜底：编辑自己那条不占用额外名额，改档位会即时释放
    if (rank === 'pinned' && !pinnedQuotaAvailable(isEdit ? assistantEditorEntryId : '')) {
      showAssistantEditorError(form, 'rank', `永久记忆最多 ${MEMORY_RANK_LIMIT} 条（全局共用），请先取消一条再设永久。`);
      return;
    }

    // 时间框只精确到分钟；没改动时保留原值，避免秒数被抹掉
    const time = isEdit && timeRaw === form.dataset.initialTime ? existing.time : timeDate.toISOString();
    const fields = { category: cat.id, title, keywords, primaryKeyword: primary, time, body, rank };
    if (groups) fields.groupId = groupId;
    // 编辑沿用原 id、来源、创建时间与原文依据；新增由存储模块生成 id，来源记为手动
    const record = store.normalize(isEdit
      ? Object.assign({}, existing, fields)
      : Object.assign({}, fields, { source: 'manual' }));
    const movedIn = Boolean(groups) && (!isEdit || assistantGroupOf(cat, existing) !== groupId);

    // 只有「对你的记忆」的近期组有容量上限，自我认知不会触发淘汰
    const removed = cat.id === 'operator' && movedIn
      ? store.planGroupTrim(cat.id, groupId, [record], [record.id])
      : [];

    assistantSaving = true;
    try {
      await commitAssistantChanges({ put: [record], remove: removed.map((r) => r.id) });
    } catch (err) {
      showAssistantEditorError(form, 'title', `保存失败：${(err && err.message) || '写入本机记忆库失败'}，请重试。`);
      return;
    } finally {
      assistantSaving = false;
    }
    if (!assistantEditorOpen) return;
    assistantEditorEntryId = record.id;

    // 保存到别的分组后，列表跟着切过去，让用户看到这条记录；书签状态在列表重绘时同步
    if (groups) setAssistantCurrentGroup(cat.id, groupId);

    assistantEditorSnapshot = assistantEditorSnapshotOf(form);
    requestCloseAssistantLayer();
    if (removed.length) {
      const meta = operatorGroupMeta(groupId);
      assistantToast(
        isEdit ? '修改已保存' : '已新增 1 条记录',
        `「${meta ? meta.name : ''}」已满 ${meta ? meta.maxLimit : ''} 条，已删除最早的「${removed[0].title || '无题记忆'}」${removed.length > 1 ? `等 ${removed.length} 条` : ''}。`
      );
    } else {
      assistantToast(isEdit ? '修改已保存' : '已新增 1 条记录');
    }
  }

  /** 只同步书签选中态与近期计数，不重绘整页（保留滚动与焦点）。 */
  function syncAssistantRail() {
    if (!viewportEl) return;
    const cat = getAssistantCategory(currentAssistantCategory);
    const groups = assistantGroupsOf(cat);
    if (!groups) return;
    const rail = viewportEl.querySelector('#memOperatorRail');
    if (!rail) return;
    const currentGroup = assistantCurrentGroup(cat);
    const entries = getAssistantEntries(cat);
    rail.querySelectorAll('.mem-operator-bookmark').forEach((b) => {
      const gid = b.getAttribute('data-operator-group');
      const active = gid === currentGroup;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      const badge = b.querySelector('.mem-operator-bookmark-badge');
      const meta = cat.id === 'operator' ? operatorGroupMeta(gid) : null;
      if (badge && meta && meta.maxLimit) {
        badge.textContent = `${entries.filter((e) => operatorGroupOf(e) === gid).length}/${meta.maxLimit}`;
      }
    });
  }

  function closeAssistantEditor(restoreFocus) {
    if (!assistantEditorOpen) return;
    const editor = containerEl && containerEl.querySelector('#memEntryEditor');
    const returnFocus = assistantEditorReturnFocus;
    const entryId = assistantEditorEntryId;
    const wasCompletion = assistantEditorMode === 'completion';
    assistantEditorOpen = false;
    assistantEditorEntryId = '';
    assistantEditorMode = 'entry';
    assistantEditorReturnFocus = null;
    assistantEditorSnapshot = '';
    detachAssistantKeyboard();
    setAssistantBackgroundInert(false);
    if (editor) {
      editor.classList.remove('is-open');
      editor.hidden = true;
      editor.innerHTML = '';
    }
    updateAssistantList();
    if (restoreFocus) {
      restoreAssistantFocus(
        returnFocus,
        entryId ? `[data-entry-id="${entryId}"] [data-entry-action="${wasCompletion ? 'complete' : 'edit'}"]` : '[data-assistant-tool="add"]'
      );
    }
  }

  /** 用户主动关闭面板：有未保存内容时先确认。 */
  async function requestCloseAssistantEditor() {
    if (!assistantEditorOpen || assistantConfirmBusy) return;
    const form = getAssistantEditorForm();
    if (form && assistantEditorSnapshotOf(form) !== assistantEditorSnapshot) {
      assistantConfirmBusy = true;
      let ok = false;
      try {
        ok = await confirmAssistantAction({
          message: '放弃这次填写的内容？',
          detail: '关闭面板后，未保存的内容不会保留。',
          confirmText: '放弃',
          cancelText: '继续编辑',
          danger: true
        });
      } finally {
        assistantConfirmBusy = false;
      }
      if (!assistantEditorOpen) return;
      if (!ok) {
        const title = form.querySelector('#memEditorTitle');
        if (title) title.focus();
        return;
      }
      assistantEditorSnapshot = assistantEditorSnapshotOf(form);
    }
    requestCloseAssistantLayer();
  }

  /** 操作条与编辑面板的委托事件，只在 ensureDOM 时绑定一次。 */
  function bindAssistantOverlayEvents() {
    const bar = containerEl.querySelector('#memListManageBar');
    const editor = containerEl.querySelector('#memEntryEditor');
    if (bar) {
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '多选操作');
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-manage]');
        if (!btn || btn.disabled) return;
        const act = btn.getAttribute('data-manage');
        if (act === 'delete') deleteAssistantSelected();
        else if (act === 'done') requestCloseAssistantLayer();
      });
    }
    if (editor) {
      editor.addEventListener('click', (e) => {
        if (!e.target.closest('[data-editor-dismiss]')) return;
        e.preventDefault();
        requestCloseAssistantEditor();
      });
      editor.addEventListener('submit', (e) => {
        e.preventDefault();
        saveAssistantEditor(e.target.closest('form'));
      });
      editor.addEventListener('keydown', (e) => {
        // 确认弹窗在上层时，把按键留给弹窗自己处理
        if (assistantConfirmBusy) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          requestCloseAssistantEditor();
          return;
        }
        // 单行输入框回车只跳下一项，避免误触直接保存；输入法组字中的回车不拦
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && e.target.matches('input.mem-editor-input')) {
          e.preventDefault();
          const order = assistantEditorMode === 'completion'
            ? ['completedDate', 'completionNote']
            : ['title', 'keywords', 'primary', 'time', 'body'];
          const next = assistantEditorField(e.target.form, order[order.indexOf(e.target.name) + 1]);
          if (next) next.focus();
        }
      });
      editor.addEventListener('input', (e) => {
        if (!e.target.matches('input, textarea')) return;
        e.target.removeAttribute('aria-invalid');
        const err = editor.querySelector('.mem-editor-error');
        if (err && !err.hidden) {
          err.hidden = true;
          err.textContent = '';
        }
      });
      editor.addEventListener('change', (e) => {
        if (e.target.name === 'group') syncAssistantPoolHint(e.target.form);
      });
      editor.addEventListener('focusin', (e) => {
        if (!e.target.matches('input, textarea')) return;
        const field = e.target;
        window.setTimeout(() => {
          if (!field.isConnected) return;
          try { field.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        }, 280);
      });
    }
    containerEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !assistantSelectionMode || assistantEditorOpen || assistantConfirmBusy) return;
      e.preventDefault();
      requestCloseAssistantLayer();
    });
  }

  function exitAssistantSelection(restoreFocus) {
    const returnFocus = assistantOverlayReturnFocus;
    assistantOverlayReturnFocus = null;
    assistantSelectionMode = false;
    assistantSelectedIds.clear();
    const bar = containerEl && containerEl.querySelector('#memListManageBar');
    if (bar) {
      bar.hidden = true;
      bar.innerHTML = '';
    }
    if (tabBarEl) tabBarEl.hidden = false;
    renderAssistantCategory(currentAssistantCategory, { preserveTools: true });
    if (restoreFocus) restoreAssistantFocus(returnFocus, '[data-assistant-tool="select"]');
  }

  function requestCloseAssistantLayer() {
    if (!assistantEditorOpen && !assistantSelectionMode) return;
    let state = null;
    try { state = window.history.state; } catch (_) {}
    const closeDirect = () => {
      if (assistantEditorOpen) closeAssistantEditor(true);
      else if (assistantSelectionMode) exitAssistantSelection(true);
    };
    if (state && state.memTool) {
      pendingProgrammaticBack = true;
      try {
        window.history.back();
      } catch (_) {
        pendingProgrammaticBack = false;
        closeDirect();
        return;
      }
      // popstate 没有如期到达时，自己收起这一层
      window.setTimeout(() => {
        if (!pendingProgrammaticBack) return;
        pendingProgrammaticBack = false;
        closeDirect();
      }, 320);
      return;
    }
    closeDirect();
  }

  /**
   * 分类 hash 上的 popstate。返回 true 表示已就地处理，不必重绘整页。
   * @param {string} tool 落点 state 上的 memTool（select | edit | 空）
   * @param {boolean} programmatic 是否由页面自己调用 history.back 触发
   */
  function handleAssistantToolPop(tool, programmatic) {
    if (assistantEditorOpen) {
      if (tool === 'edit') return true;
      const form = getAssistantEditorForm();
      const dirty = !programmatic && form && assistantEditorSnapshotOf(form) !== assistantEditorSnapshot;
      if (dirty || assistantConfirmBusy) {
        // 系统返回已经出栈，先补回这一层，再走未保存确认
        pushAssistantToolState('edit', assistantEditorEntryId);
        if (!assistantConfirmBusy) requestCloseAssistantEditor();
        return true;
      }
      closeAssistantEditor(true);
      return true;
    }
    if (assistantSelectionMode) {
      if (tool === 'select') return true;
      if (assistantConfirmBusy) {
        pushAssistantToolState('select');
        return true;
      }
      exitAssistantSelection(true);
      return true;
    }
    if (tool === 'select') {
      enterAssistantSelection(true);
      return true;
    }
    if (tool === 'edit') {
      // 浏览器前进回到已关闭的面板：草稿已不在，改回普通详情的状态
      try {
        window.history.replaceState(
          { rfPage: 'memory-bank', assistantCategory: currentAssistantCategory },
          '',
          `#memory-bank/assistant-memory/${currentAssistantCategory}`
        );
      } catch (_) {}
      return true;
    }
    return false;
  }

  function openAssistantCategory(catId) {
    const cat = getAssistantCategory(catId);
    if (!cat) return;
    isAssistantMemory = true;
    currentAssistantCategory = cat.id;
    try {
      window.history.pushState(
        { rfPage: 'memory-bank', assistantCategory: cat.id },
        '',
        `#memory-bank/assistant-memory/${cat.id}`
      );
    } catch (_) {}
    renderAssistantCategory(cat.id);
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  function memoryCategoryHtml(number, name, en, icon, caption, id) {
    return `
      <button type="button" class="mem-memory-card mem-memory-card-btn" data-assistant-cat="${escapeHtml(id || '')}" role="listitem" aria-label="查看 ${name} 详情">
        <span class="mem-memory-card-top">
          <span class="mem-memory-card-code">${number} / ${en}</span>
          <span class="mem-memory-card-icon">${MEMORY_ICONS[icon]}</span>
        </span>
        <span class="mem-memory-card-title">${name}</span>
        <span class="mem-memory-card-caption">${caption}</span>
      </button>
    `;
  }

  function renderAssistantMemory() {
    if (!viewportEl) return;
    resetAssistantListTools();
    wallRenderSeq++;
    currentTab = 'daily';
    currentForkId = '';
    isAssistantMemory = true;
    currentAssistantCategory = '';
    releaseCovers();
    setSearchVisible(false);
    setMarginNoteVisible(false);
    renderHeader('assistant-memory');
    tabBarEl.querySelectorAll('.mem-tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === 'daily');
    });

    const lead = MEMORY_CATEGORIES[0];
    const subCats = MEMORY_CATEGORIES.slice(1);

    viewportEl.innerHTML = `
      <div class="mem-memory-index mem-view-in">
        <div class="mem-memory-intro">
          <span class="mem-memory-intro-code">SEVEN LAYERS OF REMEMBERING</span>
          <p>关于你，关于我，以及只有我们知道的事。</p>
        </div>
        <div class="mem-memory-collection" role="list" aria-label="助手记忆的七个分类">
          <button type="button" class="mem-memory-lead mem-memory-lead-btn" data-assistant-cat="${escapeHtml(lead.id)}" role="listitem" aria-label="查看 对你的记忆 详情">
            <span class="mem-memory-lead-icon">${MEMORY_ICONS[lead.icon]}</span>
            <span class="mem-memory-lead-head">
              <span class="mem-memory-card-code">${lead.number} / ${lead.en}</span>
              <span class="mem-memory-lead-title">${lead.name}</span>
              <span class="mem-memory-lead-caption">${lead.caption}</span>
            </span>
          </button>
          <div class="mem-memory-grid">
            ${subCats.map((c) => memoryCategoryHtml(c.number, c.name, c.en, c.icon, c.caption, c.id)).join('')}
          </div>
        </div>
      </div>
    `;

    viewportEl.querySelectorAll('[data-assistant-cat]').forEach((el) => {
      el.addEventListener('click', () => {
        openAssistantCategory(el.getAttribute('data-assistant-cat'));
      });
    });
  }

  /**
   * 七分类共用详情框架。
   * operator（对你的记忆）与 self（自我认知）共用右侧实体索引书签轨，其他分类保持单列档案卡。
   * 零 Emoji、纯 SVG、零物理分割线。
   */
  function renderAssistantCategory(catId, opts) {
    if (!viewportEl) return;
    const preserveTools = Boolean(opts && opts.preserveTools);
    const keepScroll = preserveTools ? viewportEl.scrollTop : 0;
    wallRenderSeq++;
    const cat = getAssistantCategory(catId);
    // 换分类或从外部进入时清掉上一轮的搜索、多选与面板
    if (!preserveTools || currentAssistantCategory !== cat.id) resetAssistantListTools();
    currentTab = 'daily';
    currentForkId = '';
    isAssistantMemory = true;
    currentAssistantCategory = cat.id;
    releaseCovers();
    setSearchVisible(false);
    setMarginNoteVisible(false);
    renderHeader('assistant-category', cat);
    tabBarEl.querySelectorAll('.mem-tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === 'daily');
    });

    if (assistantRailObserver) {
      assistantRailObserver.disconnect();
      assistantRailObserver = null;
    }
    ensureAssistantMemoryLoaded();
    const groups = assistantGroupsOf(cat);
    const entries = getAssistantEntries(cat);
    const currentGroup = assistantCurrentGroup(cat);

    // 配置了分组的分类共用实体书签轨，其余分类仍保持单列档案卡
    let railHtml = '';
    if (groups) {
      const notchNum = String(groups.length).padStart(2, '0');
      const bookmarksHtml = groups.map((g) => {
        const isActive = g.id === currentGroup;
        const gCount = entries.filter((e) => assistantGroupOf(cat, e) === g.id).length;
        const badgeText = g.maxLimit ? `${gCount}/${g.maxLimit}` : '';
        return `
          <button class="index-bookmark mem-operator-bookmark ${isActive ? 'active' : ''}" type="button" data-operator-group="${g.id}" title="${escapeHtml(g.name)}" aria-label="${escapeHtml(g.name)} 分组">
            <span class="bookmark-indicator"></span>
            ${g.iconSvg}
            <span class="bookmark-text">${escapeHtml(g.name)}</span>
            ${badgeText ? `<span class="mem-operator-bookmark-badge">${badgeText}</span>` : ''}
          </button>
        `;
      }).join('');

      railHtml = `
        <aside class="mem-operator-rail ${assistantRailCollapsed ? 'is-collapsed' : ''}" id="memOperatorRail" aria-label="${escapeHtml(cat.name)}分类索引">
          <div class="mem-operator-rail-stack">
          <button class="rail-notch-toggle-btn mem-operator-rail-toggle" type="button" aria-expanded="${assistantRailCollapsed ? 'false' : 'true'}" title="收起/展开分类索引" aria-label="收起或展开分类导轨">
            <svg class="rail-notch-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="13 17 18 12 13 7"/>
              <polyline points="6 17 11 12 6 7"/>
            </svg>
            <span class="rail-notch-num">${notchNum}</span>
          </button>
          <div class="mem-operator-rail-tabs">${bookmarksHtml}</div>
          </div>
        </aside>
      `;
    }

    viewportEl.innerHTML = `
      <div class="mem-detail-page ${groups ? 'mem-detail-with-rail' : ''} ${groups && assistantRailCollapsed ? 'rail-collapsed' : ''} ${preserveTools ? '' : 'mem-view-in'} ${assistantSelectionMode ? 'is-selecting' : ''}" role="region" aria-label="${escapeHtml(cat.name)} 分类记忆">
        <div class="mem-detail-main">
          <div class="mem-detail-hero">
            <span class="mem-detail-code">${escapeHtml(cat.number)} / ${escapeHtml(cat.en)}</span>
            <h2 class="mem-detail-title">${escapeHtml(cat.name)}</h2>
            <p class="mem-detail-desc">${escapeHtml(cat.caption.replace(/<br\s*\/?\s*>/gi, ' '))}</p>
          </div>
          <div class="mem-detail-tools" role="toolbar" aria-label="记录列表工具">
            <span class="mem-detail-count" data-assistant-count aria-live="polite"></span>
            <div class="mem-detail-tool-group">${assistantToolButtonsHtml()}</div>
          </div>
          ${assistantSearchOpen ? `
            <div class="mem-detail-search" role="search">
              <span class="mem-detail-search-icon">${ICONS.searchLine}</span>
              <input class="mem-detail-search-input" id="memAssistantSearchInput" type="search"
                     placeholder="${cat.id === 'pending' ? '搜索标题、关键词、正文或完成说明' : '搜索标题、关键词或正文'}" aria-label="在${escapeHtml(cat.name)}中搜索"
                     aria-controls="memAssistantList" autocomplete="off" spellcheck="false" enterkeyhint="search"
                     value="${escapeHtml(assistantSearchQuery)}">
              <button type="button" class="mem-detail-search-clear" data-assistant-search="clear" aria-label="清空搜索" ${assistantSearchQuery ? '' : 'hidden'}>${ICONS.close}</button>
              <button type="button" class="mem-detail-search-cancel" data-assistant-search="close">收起</button>
            </div>
          ` : ''}
          <div class="mem-detail-list" id="memAssistantList"></div>
          <div class="mem-detail-empty" data-assistant-empty role="status" hidden></div>
        </div>
        ${railHtml}
      </div>
    `;

    bindAssistantDetailEvents();
    updateAssistantList();
    syncAssistantManageBar();
    if (groups) watchAssistantRail();
    if (preserveTools) viewportEl.scrollTop = keepScroll;
  }

  /**
   * 书签轨对齐：收起按钮与分类标题同一行居中，第一个书签顶端对齐工具行。
   * 整组书签吸顶时，按钮随标题滚出，书签停在视口顶部 12px。
   */
  function layoutAssistantRail() {
    if (!viewportEl) return;
    const page = viewportEl.querySelector('.mem-detail-page.mem-detail-with-rail');
    if (!page) return;
    const rail = page.querySelector('#memOperatorRail');
    const toggle = page.querySelector('.mem-operator-rail-toggle');
    const tabs = page.querySelector('.mem-operator-rail-tabs');
    const title = page.querySelector('.mem-detail-title');
    const tools = page.querySelector('.mem-detail-tools');
    if (!rail || !toggle || !tabs || !title || !tools) return;
    const pageTop = page.getBoundingClientRect().top;
    const titleRect = title.getBoundingClientRect();
    const toggleH = toggle.offsetHeight || 36;
    const toggleTop = Math.max(0, Math.round(titleRect.top - pageTop + (titleRect.height - toggleH) / 2));
    const tabsTop = Math.round(tools.getBoundingClientRect().top - pageTop);
    const tabsGap = Math.max(0, tabsTop - toggleTop - toggleH);
    rail.style.setProperty('--rail-toggle-top', `${toggleTop}px`);
    rail.style.setProperty('--rail-tabs-gap', `${tabsGap}px`);
    rail.style.setProperty('--rail-sticky-top', `${12 - (tabsTop - toggleTop)}px`);
    // 记录很少时页面也要够高，书签列才不会被截断
    page.style.minHeight = `${tabsTop + tabs.offsetHeight + 24}px`;
  }

  function watchAssistantRail() {
    layoutAssistantRail();
    if (typeof window.ResizeObserver !== 'function' || !viewportEl) return;
    const hero = viewportEl.querySelector('.mem-detail-hero');
    if (!hero) return;
    assistantRailObserver = new window.ResizeObserver(() => layoutAssistantRail());
    assistantRailObserver.observe(hero);
  }

  function assistantToolButtonsHtml() {
    if (assistantSelectionMode) {
      return `<span class="mem-detail-select-hint">点按记录即可选择</span>
        <button type="button" class="mem-detail-tool-text" data-assistant-tool="select-all">全选</button>`;
    }
    return `
      ${assistantSearchOpen ? '' : `<button type="button" class="mem-detail-tool-btn" data-assistant-tool="search" aria-label="搜索记录">${ICONS.searchLine}</button>`}
      <button type="button" class="mem-detail-tool-btn" data-assistant-tool="add" aria-label="新增记录">${ICONS.plus}</button>
      <button type="button" class="mem-detail-tool-text" data-assistant-tool="select">${ICONS.listChecks}<span>多选</span></button>
    `;
  }

  function assistantEntryMatches(entry, query) {
    if (!query) return true;
    const hay = [entry.title, (entry.keywords || []).join(' '), entry.body, entry.completionNote]
      .join('\n')
      .toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  /** 只重绘列表、计数和空状态；搜索框保持原样，输入法与光标不受影响。 */
  function updateAssistantList() {
    if (!viewportEl || !currentAssistantCategory) return;
    const page = viewportEl.querySelector('.mem-detail-page');
    const list = viewportEl.querySelector('#memAssistantList');
    if (!page || !list) return;
    const cat = getAssistantCategory(currentAssistantCategory);
    const allEntries = getAssistantEntries(cat);
    const groups = assistantGroupsOf(cat);
    const currentGroup = assistantCurrentGroup(cat);
    const currentGroupMeta = groups ? assistantGroupMeta(cat, currentGroup) : null;

    // 分组分类只显示当前书签；其余分类保持全量平铺
    const groupEntries = assistantCurrentGroupEntries(cat, allEntries);

    const rawQuery = assistantSearchOpen ? assistantSearchQuery.trim() : '';
    const query = rawQuery.toLowerCase();
    const shown = assistantDisplayEntries(cat, groupEntries.filter((e) => assistantEntryMatches(e, query)));

    // 被删掉或不可见组的条目不能残留在已选集合里
    const visibleIds = new Set(groupEntries.map((e) => e.id));
    Array.from(assistantSelectedIds).forEach((id) => { if (!visibleIds.has(id)) assistantSelectedIds.delete(id); });

    if (assistantSelectionMode) {
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', '选择要删除的记录');
    } else {
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', `${cat.name} 记忆列表`);
    }
    list.innerHTML = shown.map((entry) => assistantEntryCardHtml(entry, groupEntries.indexOf(entry), cat)).join('');

    const countEl = page.querySelector('[data-assistant-count]');
    if (countEl) {
      if (groups) {
        const groupName = currentGroupMeta ? currentGroupMeta.name : '当前分组';
        countEl.textContent = rawQuery
          ? `[${groupName}] 匹配 ${shown.length} / ${groupEntries.length} 条`
          : `[${groupName}] 共 ${groupEntries.length} 条`;
      } else {
        countEl.textContent = rawQuery ? `匹配 ${shown.length} / ${groupEntries.length} 条` : `共 ${groupEntries.length} 条`;
      }
    }

    const ready = assistantMemoryReady();
    const selectBtn = page.querySelector('[data-assistant-tool="select"]');
    if (selectBtn) selectBtn.disabled = !ready || !groupEntries.length;
    const addBtn = page.querySelector('[data-assistant-tool="add"]');
    if (addBtn) addBtn.disabled = !ready;
    const allBtn = page.querySelector('[data-assistant-tool="select-all"]');
    if (allBtn) {
      const all = groupEntries.length > 0 && groupEntries.every((e) => assistantSelectedIds.has(e.id));
      allBtn.textContent = all ? '取消全选' : '全选';
    }

    const empty = page.querySelector('[data-assistant-empty]');
    if (empty) {
      if (!ready) {
        const failed = assistantLoadState === 'error';
        empty.innerHTML = failed
          ? `<span class="mem-detail-empty-title">记忆库读取失败</span>
            <span class="mem-detail-empty-text">本机记忆库暂时无法打开，已有记录没有丢失。请关闭其他溯流计划页面后重新进入。</span>
            <button type="button" class="mem-detail-tool-text mem-detail-retry" data-assistant-tool="retry-load">重新读取</button>`
          : `<span class="mem-detail-empty-title">正在读取记忆库</span>`;
        empty.hidden = false;
      } else if (!groupEntries.length) {
        if (groups) {
          const groupName = currentGroupMeta ? currentGroupMeta.name : '该分类';
          empty.innerHTML = `
            <span class="mem-detail-empty-icon">${currentGroupMeta ? currentGroupMeta.iconSvg : ICONS.emptyBox}</span>
            <span class="mem-detail-empty-title">「${escapeHtml(groupName)}」暂无记录</span>
            <span class="mem-detail-empty-text">可以用上方的新增按钮为这一组添加一条。</span>
          `;
        } else {
          empty.innerHTML = `<span class="mem-detail-empty-title">这里还没有记录</span>
            <span class="mem-detail-empty-text">可以用上方的新增按钮添加一条。</span>`;
        }
        empty.hidden = false;
      } else if (!shown.length) {
        empty.innerHTML = `<span class="mem-detail-empty-title">没有找到匹配的记录</span>
          <span class="mem-detail-empty-text">「${escapeHtml(rawQuery)}」未出现在当前记录的标题、关键词、正文${cat.id === 'pending' ? '或完成说明' : ''}中。</span>`;
        empty.hidden = false;
      } else {
        empty.hidden = true;
        empty.innerHTML = '';
      }
    }
    if (groups) syncAssistantRail();
    if (assistantSelectionMode) syncAssistantManageBar();
  }

  function toggleAssistantSelectAll() {
    if (!assistantSelectionMode) return;
    const cat = getAssistantCategory(currentAssistantCategory);
    const entries = assistantCurrentGroupEntries(cat, getAssistantEntries(cat));
    const all = entries.length > 0 && entries.every((e) => assistantSelectedIds.has(e.id));
    assistantSelectedIds.clear();
    if (!all) entries.forEach((e) => assistantSelectedIds.add(e.id));
    updateAssistantList();
  }

  function assistantEntryCardHtml(entry, index, cat) {
    const seq = String(index + 1).padStart(3, '0');
    const title = escapeHtml(entry.title || '无题记忆');
    const timeText = escapeHtml(formatAssistantTime(entry.time));
    const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [];
    const primaryKw = String(entry.primaryKeyword || '').trim();
    const rawBody = String(entry.body || '').trim();
    const isLong = rawBody.length > 96 || rawBody.indexOf('\n') !== -1;
    const bodyHtml = escapeHtml(rawBody).replace(/\n/g, '<br>');
    const id = escapeHtml(entry.id || '');
    const selecting = assistantSelectionMode;
    const selected = selecting && assistantSelectedIds.has(entry.id);
    const cardAttrs = selecting
      ? `role="checkbox" tabindex="0" aria-checked="${selected ? 'true' : 'false'}"`
      : 'role="listitem"';
    const rank = memoryRankOf(entry);
    const rankBadge = !selecting && rank !== 'normal'
      ? `<span class="mem-record-rank is-${rank}" aria-label="${rank === 'pinned' ? '永久记忆' : '重要记忆'}">${rank === 'pinned' ? ICONS.rankPinned : ICONS.rankImportant}</span>`
      : '';
    const completed = cat.id === 'pending' && assistantEntryCompleted(entry);
    const completionLabel = completed ? '查看或修改完成记录' : '记录完成';
    const completionDate = escapeHtml(formatAssistantCompletionDate(entry.completedDate));
    const completionNote = escapeHtml(String(entry.completionNote || '').trim()).replace(/\n/g, '<br>');

    return `
      <article class="mem-record-card ${selecting ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''} ${completed ? 'is-completed' : ''}" data-entry-id="${id}" ${cardAttrs} aria-label="${title}${completed ? '，已完成' : ''}">
        <div class="mem-record-meta">
          <span class="mem-record-seq">ENTRY ${seq}</span>
          <time class="mem-record-time" datetime="${escapeHtml(entry.time || '')}">${timeText}</time>
        </div>
        <h3 class="mem-record-title">${title}</h3>
        ${keywords.length ? `
          <div class="mem-record-tags" aria-label="关键词">
            ${keywords.map((k) => {
              const isPrimary = primaryKw && k.trim() === primaryKw;
              return `<span class="mem-record-tag ${isPrimary ? 'is-primary' : ''}">${escapeHtml(k)}</span>`;
            }).join('')}
          </div>
        ` : ''}
        <div class="mem-record-body ${isLong ? 'is-clamp' : ''}">
          <div class="mem-record-text">${bodyHtml}</div>
        </div>
        ${completed ? `
          <div class="mem-record-completion">
            <div class="mem-record-completion-meta">
              <span class="mem-record-completion-status">${ICONS.check}<span>已完成</span></span>
              <time class="mem-record-completion-date" datetime="${escapeHtml(entry.completedDate)}">${completionDate}</time>
            </div>
            <p class="mem-record-completion-note">${completionNote}</p>
          </div>
        ` : ''}
        <div class="mem-record-foot">
          ${selecting ? `
            <span class="mem-record-check" aria-hidden="true">${ICONS.check}</span>
          ` : `
            ${isLong ? `
              <button type="button" class="mem-record-toggle" aria-expanded="false">
                <span class="mem-record-toggle-text">展开全文</span>
              </button>
            ` : ''}
            <div class="mem-record-actions">
              ${rankBadge}
              ${cat.id === 'pending' ? `<button type="button" class="mem-record-action-btn mem-record-complete-btn ${completed ? 'is-completed' : ''}" data-entry-action="complete" aria-label="${completionLabel}「${title}」" title="${completionLabel}">${ICONS.check}</button>` : ''}
              <button type="button" class="mem-record-action-btn" data-entry-action="edit" aria-label="编辑「${title}」">${ICONS.edit}</button>
              <button type="button" class="mem-record-action-btn" data-entry-action="delete" aria-label="删除「${title}」">${ICONS.trash}</button>
            </div>
          `}
        </div>
      </article>
    `;
  }

  /** 详情页整体委托；每次重绘换的是新根节点，旧监听随节点一起回收。 */
  function bindAssistantDetailEvents() {
    if (!viewportEl) return;
    const page = viewportEl.querySelector('.mem-detail-page');
    if (!page) return;

    page.addEventListener('click', (e) => {
      // 1. 书签轨折叠/展开
      const railToggle = e.target.closest('.mem-operator-rail-toggle');
      if (railToggle) {
        assistantRailCollapsed = !assistantRailCollapsed;
        railToggle.setAttribute('aria-expanded', assistantRailCollapsed ? 'false' : 'true');
        const rail = page.querySelector('#memOperatorRail');
        if (rail) rail.classList.toggle('is-collapsed', assistantRailCollapsed);
        page.classList.toggle('rail-collapsed', assistantRailCollapsed);
        return;
      }

      // 2. 书签项点击切换分组
      const bookmark = e.target.closest('.mem-operator-bookmark');
      if (bookmark) {
        const cat = getAssistantCategory(currentAssistantCategory);
        const targetGroup = bookmark.getAttribute('data-operator-group');
        if (assistantGroupMeta(cat, targetGroup) && targetGroup !== assistantCurrentGroup(cat)) {
          setAssistantCurrentGroup(cat.id, targetGroup);
          // 先退出多选，重绘后统一同步书签，避免跨组误删或操作已移除的旧节点
          if (assistantSelectionMode) {
            exitAssistantSelection(false);
          } else {
            updateAssistantList();
          }
        }
        return;
      }

      const tool = e.target.closest('[data-assistant-tool]');
      if (tool) {
        if (tool.disabled) return;
        const t = tool.getAttribute('data-assistant-tool');
        if (t === 'search') openAssistantSearch();
        else if (t === 'add') openAssistantEditor('');
        else if (t === 'select') enterAssistantSelection(false);
        else if (t === 'select-all') toggleAssistantSelectAll();
        else if (t === 'retry-load') {
          assistantLoadState = 'idle';
          ensureAssistantMemoryLoaded();
          updateAssistantList();
        }
        return;
      }
      const searchBtn = e.target.closest('[data-assistant-search]');
      if (searchBtn) {
        if (searchBtn.getAttribute('data-assistant-search') === 'clear') {
          clearAssistantSearchQuery(page.querySelector('#memAssistantSearchInput'));
          searchBtn.hidden = true;
        } else {
          closeAssistantSearch();
        }
        return;
      }
      const card = e.target.closest('.mem-record-card');
      if (!card) return;
      if (assistantSelectionMode) {
        toggleAssistantSelected(card);
        return;
      }
      const action = e.target.closest('[data-entry-action]');
      if (action) {
        const id = card.getAttribute('data-entry-id');
        const act = action.getAttribute('data-entry-action');
        const cat = getAssistantCategory(currentAssistantCategory);
        const entry = getAssistantEntries(cat).find((item) => item.id === id);
        if (!entry) return;
        if (act === 'edit') openAssistantEditor(id);
        else if (act === 'complete' && cat.id === 'pending') openAssistantEditor(id, 'completion');
        else if (act === 'delete') deleteAssistantEntry(id);
        return;
      }
      const toggle = e.target.closest('.mem-record-toggle');
      const body = card.querySelector('.mem-record-body');
      if (!toggle || !body) return;
      const expanded = body.classList.toggle('is-expanded');
      body.classList.toggle('is-clamp', !expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const text = toggle.querySelector('.mem-record-toggle-text');
      if (text) text.textContent = expanded ? '收起全文' : '展开全文';
    });

    page.addEventListener('keydown', (e) => {
      if (assistantSelectionMode && (e.key === ' ' || e.key === 'Enter')) {
        const card = e.target.closest('.mem-record-card.is-selectable');
        if (card && e.target === card) {
          e.preventDefault();
          toggleAssistantSelected(card);
        }
        return;
      }
      if (e.key === 'Escape' && e.target.id === 'memAssistantSearchInput') {
        e.preventDefault();
        e.stopPropagation();
        closeAssistantSearch();
      }
    });

    const input = page.querySelector('#memAssistantSearchInput');
    if (input) {
      input.addEventListener('input', () => {
        assistantSearchQuery = input.value;
        const clear = page.querySelector('[data-assistant-search="clear"]');
        if (clear) clear.hidden = !input.value;
        updateAssistantList();
      });
      input.addEventListener('keydown', (e) => {
        // 键盘上的“搜索”键只收起键盘，结果已实时更新
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          input.blur();
        }
      });
    }
  }

  function formatAssistantTime(raw) {
    if (!raw) return '时间不详';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ---------------- 记忆向量化总按钮 ---------------- */

  function vectorToast(opts) {
    if (!window.RetroToast || typeof window.RetroToast.show !== 'function') return;
    try { window.RetroToast.show(Object.assign({ tag: 'MEMORY // 向量化' }, opts)); } catch (_) {}
  }

  /** 只更新按钮状态，不重绘顶栏（用户可能已经切走）；进度在 toast 中展示 */
  function syncVectorizeBtn(busy) {
    const btn = headerEl && headerEl.querySelector('#memVectorizeBtn');
    if (!btn) return;
    btn.classList.toggle('is-busy', busy);
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  async function runVectorizeAll() {
    const mv = window.MemoryVectors;
    if (!mv || typeof mv.fillAll !== 'function') {
      vectorToast({ type: 'danger', message: '向量模块未加载', detail: '请刷新页面后再试。' });
      return;
    }
    if (mv.isFilling()) {
      vectorToast({ type: 'info', message: '正在向量化', detail: '请等这一轮完成。' });
      return;
    }
    if (!mv.isConfigured()) {
      vectorToast({
        type: 'warn',
        message: '还没有设置向量模型',
        detail: '请到「设置 · API 设置 · 功能模型配置 · 向量模型」里设置。没有设置时，记忆只按关键词召回。',
        duration: 5000
      });
      return;
    }

    syncVectorizeBtn(true);
    vectorToast({ type: 'info', message: '正在检查记忆的向量', detail: '只补没有向量、换了模型或改过内容的记录。', duration: 60000 });
    const res = await mv.fillAll({
      onProgress: (done, total) => {
        if (!total) return;
        syncVectorizeBtn(true);
        vectorToast({ type: 'info', message: `正在向量化 ${done} / ${total}`, detail: '可以离开记忆库，完成后会提示。', duration: 60000 });
      }
    });
    syncVectorizeBtn(false);

    if (res.ok) {
      const cleaned = res.removed ? `，清理了 ${res.removed} 条失效向量` : '';
      if (!res.pending) {
        vectorToast({ type: 'success', message: '所有记忆都已向量化', detail: `共 ${res.total} 条，无需补算${cleaned}。` });
      } else {
        vectorToast({ type: 'success', message: `已向量化 ${res.generated} 条记忆`, detail: `共 ${res.total} 条${cleaned}。` });
      }
      return;
    }
    if (res.reason === 'busy') {
      vectorToast({ type: 'info', message: '正在向量化', detail: '请等这一轮完成。' });
      return;
    }
    const progress = res.pending ? `已完成 ${res.generated} / ${res.pending} 条。` : '';
    vectorToast({
      type: 'danger',
      message: res.reason === 'api' ? '向量接口请求失败，已停止' : '读取记忆失败，已停止',
      detail: `${progress}${res.error || ''} 已生成的向量会保留，再点一次会从未完成的记录继续。`,
      duration: 6000
    });
  }

  function renderHeader(mode, fork) {
    if (!headerEl) return;
    headerEl.className = 'settings-header mem-header';

    if (mode === 'detail') {
      const lvl = levelOf(fork);
      headerEl.innerHTML = `
        <button class="settings-back-btn" id="memBackBtn" type="button" aria-label="返回卷宗墙">${ICONS.back}</button>
        <div class="settings-header-title">
          <span class="settings-title-en">${escapeHtml(forkCode(fork))}</span>
          <span class="settings-title-slash">//</span>
          <span class="settings-title-zh">${escapeHtml((fork && fork.title) || '未命名副本')}</span>
          <span class="mem-header-level-tag">${lvl.letter} ${lvl.name}</span>
        </div>
      `;
    } else if (mode === 'assistant-memory') {
      headerEl.innerHTML = `
        <button class="settings-back-btn" id="memBackBtn" type="button" aria-label="返回日常">${ICONS.back}</button>
        <div class="settings-header-title">
          <span class="settings-title-en">MEMORY PRISM</span>
          <span class="settings-title-slash">//</span>
          <span class="settings-title-zh">助手记忆</span>
        </div>
        <button class="mem-audit-btn" id="memAuditBtn" type="button"
          aria-label="记忆巡检：分析并合并重复、矛盾的记忆" title="记忆巡检">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3"/>
            <rect x="2" y="5" width="11" height="16" rx="2"/>
            <path d="M5.5 9h4M5.5 12h3"/>
            <circle cx="17" cy="16" r="4"/>
            <path d="m19.8 18.8 2.2 2.2"/>
          </svg>
        </button>
      `;
      const auditBtn = headerEl.querySelector('#memAuditBtn');
      if (auditBtn) {
        auditBtn.addEventListener('click', () => {
          if (window.MemoryAuditModal && typeof window.MemoryAuditModal.open === 'function') {
            window.MemoryAuditModal.open();
          }
        });
      }
    } else if (mode === 'assistant-category') {
      const cat = fork || MEMORY_CATEGORIES[0];
      headerEl.innerHTML = `
        <button class="settings-back-btn" id="memBackBtn" type="button" aria-label="返回助手记忆">${ICONS.back}</button>
        <div class="settings-header-title">
          <span class="settings-title-en">${escapeHtml(cat.number)} / ${escapeHtml(cat.en)}</span>
          <span class="settings-title-slash">//</span>
          <span class="settings-title-zh">${escapeHtml(cat.name)}</span>
        </div>
      `;
    } else {
      // 最外层（日常 / 副本 / 角色共用）：右侧放记忆向量化总按钮，进入下一层后不显示
      const busy = Boolean(window.MemoryVectors && window.MemoryVectors.isFilling && window.MemoryVectors.isFilling());
      headerEl.innerHTML = `
        <button class="settings-back-btn" id="memBackBtn" type="button" aria-label="返回桌面">${ICONS.back}</button>
        <div class="settings-header-title">
          <span class="settings-title-en">MEMORY BANK</span>
          <span class="settings-title-slash">//</span>
          <span class="settings-title-zh">数据归档</span>
        </div>
        <button class="mem-vectorize-btn${busy ? ' is-busy' : ''}" id="memVectorizeBtn" type="button"
          aria-label="向量化全部记忆，只补缺少或过期的向量" title="向量化全部记忆"${busy ? ' aria-busy="true"' : ''}>
          ${ICONS.vectorize}
        </button>
      `;
      const vecBtn = headerEl.querySelector('#memVectorizeBtn');
      if (vecBtn) vecBtn.addEventListener('click', runVectorizeAll);
    }
    const btn = headerEl.querySelector('#memBackBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (mode === 'assistant-category') {
          // 多选中的返回先退出多选，与系统返回一致
          if (assistantSelectionMode) requestCloseAssistantLayer();
          else backToAssistantMemory();
        }
        else if (mode === 'assistant-memory') backToDaily();
        else if (currentForkId) backToWall();
        else close();
      });
    }
  }

  /* ---------------- 外层：卷宗格墙 ---------------- */

  function cardHtml(item, count) {
    const lvl = levelOf(item);
    const lvlSvg = LEVEL_SVGS[lvl.letter] || LEVEL_SVGS['C'];
    const title = (item && item.title) || '未命名副本';
    const fid = escapeHtml(item.id);
    return `
      <button type="button" class="mem-card" data-fork-id="${fid}" aria-label="${escapeHtml(title)} 的记忆卷宗">
        <span class="mem-card-photo" data-fork-id="${fid}">
          <span class="mem-card-totem">${lvlSvg}</span>
          <span class="mem-card-level" title="副本等级：${lvl.letter} / ${lvl.name}">
            <span class="mem-card-level-icon">${lvlSvg}</span>
            <span class="mem-card-level-letter">${lvl.letter}</span>
          </span>
          <span class="mem-card-body">
            <span class="mem-card-code">${escapeHtml(forkCode(item))}</span>
            <span class="mem-card-title">${escapeHtml(title)}</span>
          </span>
        </span>
      </button>
    `;
  }

  async function renderWall() {
    if (!viewportEl) return;
    resetAssistantListTools();
    const seq = ++wallRenderSeq;
    currentTab = 'fork';
    currentForkId = '';
    isAssistantMemory = false;
    tabBarEl.querySelectorAll('.mem-tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === 'fork');
    });
    releaseCovers();
    setSearchVisible(true);
    syncSearchUI();
    setMarginNoteVisible(false);
    renderHeader('wall');

    const forks = readForkIndex();
    const query = searchQuery.trim().toLowerCase();
    const visibleForks = query
      ? forks.filter((item) => String((item && item.title) || '未命名副本').toLowerCase().includes(query))
      : forks;
    const counts = await collectCounts();
    if (seq !== wallRenderSeq || currentForkId || currentTab !== 'fork' || !isOpened) return;
    setMarginNoteVisible(visibleForks.length > 0);

    if (!forks.length) {
      viewportEl.innerHTML = `<div class="mem-wall mem-view-in">${emptyBoxHtml('ARCHIVE EMPTY', '副本库里还没有卷宗，先去编纂一个副本')}</div>`;
      return;
    }
    if (!visibleForks.length) {
      viewportEl.innerHTML = `<div class="mem-wall mem-view-in">${emptyBoxHtml('NO MATCH', '未找到相关副本')}</div>`;
      return;
    }

    viewportEl.innerHTML = `
      <div class="mem-wall mem-view-in">
        <div class="mem-grid">
          ${visibleForks.map((f) => cardHtml(f, counts.get(f.id) || 0)).join('')}
        </div>
      </div>
    `;

    viewportEl.querySelectorAll('.mem-card').forEach((card) => {
      card.addEventListener('click', () => {
        const fid = card.getAttribute('data-fork-id');
        if (fid) openFork(fid);
      });
    });

    hydrateCovers(visibleForks, seq);
  }

  /** 结构先落地，封面异步补挂；没有封面的卡片保留水相图腾占位 */
  async function hydrateCovers(items, seq) {
    if (!viewportEl || !window.Storage || typeof Storage.getAssetSrc !== 'function') return;
    for (const item of items) {
      if (seq !== wallRenderSeq || !isOpened || currentTab !== 'fork' || currentForkId) return;
      if (!item || !item.hasCover) continue;
      const key = window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.forkCover === 'function'
        ? DataRegistry.key.forkCover(item.id)
        : `fork/cover.${item.id}`;
      let src = '';
      try { src = await Storage.getAssetSrc(key); } catch (_) { continue; }
      if (!src) continue;
      // 搜索重绘、切 Tab、进详情或关页后，旧请求不得再挂载封面。
      if (seq !== wallRenderSeq || !isOpened || currentTab !== 'fork' || currentForkId) {
        try { Storage.revokeAssetSrc(src); } catch (_) {}
        return;
      }
      const photo = viewportEl.querySelector(`.mem-card-photo[data-fork-id="${item.id}"]`);
      if (!photo) {
        try { Storage.revokeAssetSrc(src); } catch (_) {}
        continue;
      }
      coverUrls.push(src);
      const img = document.createElement('img');
      img.className = 'mem-card-img';
      img.src = src;
      img.alt = item.title || '副本封面';
      img.loading = 'lazy';
      photo.insertBefore(img, photo.firstChild);
      photo.classList.add('has-cover');
    }
  }

  function releaseCovers() {
    if (!coverUrls.length) return;
    coverUrls.forEach((u) => {
      try { Storage.revokeAssetSrc(u); } catch (_) {}
    });
    coverUrls = [];
  }

  /* ---------------- 内层：单本卷宗 ---------------- */

  async function openFork(forkId) {
    currentForkId = forkId;
    othersExpanded = false;
    try {
      window.history.pushState({ rfPage: 'memory-bank', forkId }, '', `#memory-bank/${forkId}`);
    } catch (_) {}
    await renderDetail(forkId);
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  async function renderDetail(forkId) {
    if (!viewportEl) return;
    wallRenderSeq++;
    currentForkId = String(forkId || '');
    isAssistantMemory = false;
    setSearchVisible(false);
    setMarginNoteVisible(false);
    releaseCovers();
    const forks = readForkIndex();
    const fork = forks.find((f) => f && f.id === forkId) || { id: forkId };
    renderHeader('detail', fork);

    let index = { canonicalRunId: '' };
    let runs = [];
    let memories = [];
    try { index = await ForkRunStore.getIndex(forkId); } catch (_) {}
    try { runs = await ForkRunStore.listRuns(forkId); } catch (_) {}
    try { memories = await MemoryStore.listCandidates(forkId); } catch (_) {}

    if (!memories.length) {
      viewportEl.innerHTML = `<div class="mem-detail mem-view-in">${emptyBoxHtml('NO RECORD', '这个副本还没有归档任何记忆')}</div>`;
      return;
    }

    // 按分支归组；组内按发生时间正序
    const byRun = new Map();
    memories.forEach((m) => {
      const k = String(m.runId || '');
      if (!byRun.has(k)) byRun.set(k, []);
      byRun.get(k).push(m);
    });
    byRun.forEach((list) => list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));

    const adoptedId = index && index.canonicalRunId ? index.canonicalRunId : '';
    const adopted = adoptedId ? (byRun.get(adoptedId) || []) : [];
    const otherKeys = Array.from(byRun.keys()).filter((k) => k !== adoptedId);
    const otherCount = otherKeys.reduce((n, k) => n + byRun.get(k).length, 0);

    const runLabel = (runId) => {
      const run = runs.find((r) => r && r.id === runId);
      if (run && window.ForkRunStore && typeof ForkRunStore.getRunDisplayLabel === 'function') {
        return ForkRunStore.getRunDisplayLabel(run, runs);
      }
      return '未归档分支';
    };

    let html = `<div class="mem-detail mem-view-in">`;

    // 认定分支
    if (adopted.length) {
      html += `
        <section class="mem-run-block is-adopted">
          <div class="mem-run-head">
            <span class="mem-run-label">${escapeHtml(runLabel(adoptedId))}</span>
            <span class="mem-run-badge">${ICONS.seal}<span>已认定</span></span>
          </div>
          ${adopted.map((m) => slipHtml(m)).join('')}
        </section>
      `;
    } else {
      html += `
        <section class="mem-run-block">
          <div class="mem-run-head">
            <span class="mem-run-label">尚未认定分支</span>
          </div>
          <p class="mem-run-hint">这个副本还没有认定任何分支。认定之后，那条分支的记忆会平铺在这里，助手与角色也只引用它。</p>
        </section>
      `;
    }

    // 其他分支（默认折叠）
    if (otherCount > 0) {
      html += `
        <button type="button" class="mem-other-toggle ${othersExpanded ? 'is-open' : ''}" id="memOtherToggle"
                aria-expanded="${othersExpanded ? 'true' : 'false'}">
          <span>其他分支 · ${otherCount} 条</span>
          <span class="mem-other-chevron">${ICONS.chevron}</span>
        </button>
        <div class="mem-others ${othersExpanded ? 'is-open' : ''}" id="memOthers">
          ${otherKeys.map((k) => `
            <section class="mem-run-block is-other">
              <div class="mem-run-head">
                <span class="mem-run-label">${escapeHtml(runLabel(k))}</span>
              </div>
              ${byRun.get(k).map((m) => slipHtml(m)).join('')}
            </section>
          `).join('')}
        </div>
      `;
    }

    html += `</div>`;
    viewportEl.innerHTML = html;

    const toggle = viewportEl.querySelector('#memOtherToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        othersExpanded = !othersExpanded;
        toggle.classList.toggle('is-open', othersExpanded);
        toggle.setAttribute('aria-expanded', othersExpanded ? 'true' : 'false');
        const box = viewportEl.querySelector('#memOthers');
        if (box) box.classList.toggle('is-open', othersExpanded);
      });
    }
  }

  /** 一条记忆 = 一张档案条：正文为主，脚注一行交代时间与在场者 */
  function slipHtml(m) {
    const witnesses = (m.witnessIds || []).map(rosterName).filter(Boolean);
    return `
      <article class="mem-slip">
        <p class="mem-slip-text">${escapeHtml(m.summary || '')}</p>
        <div class="mem-slip-foot">
          <span class="mem-slip-meta">${ICONS.clock}${escapeHtml(formatTimeAgo(m.createdAt))}</span>
          ${witnesses.length ? `<span class="mem-slip-meta">${ICONS.witness}${escapeHtml(witnesses.join('、'))}</span>` : ''}
        </div>
      </article>
    `;
  }

  function emptyBoxHtml(code, text) {
    return `
      <div class="mem-empty">
        <span class="mem-empty-icon">${ICONS.emptyBox}</span>
        <div class="mem-empty-code">${escapeHtml(code)}</div>
        <div class="mem-empty-text">${escapeHtml(text)}</div>
      </div>
    `;
  }

  /* ---------------- 开关与路由 ---------------- */

  async function open() {
    ensureDOM();
    await purgeDemoOnce();
    isOpened = true;
    othersExpanded = false;
    currentForkId = '';
    isAssistantMemory = false;
    currentAssistantCategory = '';
    containerEl.classList.add('is-open');
    if ((window.location.hash || '') !== '#memory-bank') {
      try {
        window.history.pushState({ rfPage: 'memory-bank' }, '', '#memory-bank');
      } catch (_) {}
    }
    await renderWall();
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  /**
   * @param {boolean} silent 为 true 时只收视图、不动 history（popstate 复用）
   */
  function close(silent) {
    if (!containerEl || !isOpened) return;
    isOpened = false;
    resetAssistantListTools();
    currentForkId = '';
    isAssistantMemory = false;
    currentAssistantCategory = '';
    wallRenderSeq++;
    searchQuery = '';
    syncSearchUI();
    setSearchVisible(false);
    setMarginNoteVisible(false);
    releaseCovers();
    containerEl.classList.remove('is-open');
    if (silent) return;
    const hash = window.location.hash || '';
    if (hash === '#memory-bank' || hash.indexOf('#memory-bank/') === 0) {
      pendingProgrammaticBack = true;
      try { window.history.back(); } catch (_) { pendingProgrammaticBack = false; }
      setTimeout(() => { pendingProgrammaticBack = false; }, 320);
    }
  }

  /** 从分类详情退回助手记忆索引 */
  function backToAssistantMemory() {
    const hash = window.location.hash || '';
    if (hash.indexOf('#memory-bank/assistant-memory/') !== 0) {
      currentAssistantCategory = '';
      renderAssistantMemory();
      if (viewportEl) viewportEl.scrollTop = 0;
      return;
    }
    pendingProgrammaticBack = true;
    try {
      window.history.back();
    } catch (_) {
      pendingProgrammaticBack = false;
      currentAssistantCategory = '';
      try { window.history.replaceState({ rfPage: 'memory-bank', memoryIndex: true }, '', '#memory-bank/assistant-memory'); } catch (_) {}
      renderAssistantMemory();
      return;
    }
    setTimeout(() => {
      if (!pendingProgrammaticBack || (window.location.hash || '').indexOf('#memory-bank/assistant-memory/') === -1) return;
      pendingProgrammaticBack = false;
      currentAssistantCategory = '';
      try { window.history.replaceState({ rfPage: 'memory-bank', memoryIndex: true }, '', '#memory-bank/assistant-memory'); } catch (_) {}
      renderAssistantMemory();
      if (viewportEl) viewportEl.scrollTop = 0;
    }, 320);
  }

  /** 从助手记忆索引退回日常：优先退栈，栈异常时校正地址并重绘。 */
  function backToDaily() {
    const memoryHash = '#memory-bank/assistant-memory';
    if ((window.location.hash || '') !== memoryHash) {
      isAssistantMemory = false;
      renderDaily();
      if (viewportEl) viewportEl.scrollTop = 0;
      return;
    }
    pendingProgrammaticBack = true;
    try {
      window.history.back();
    } catch (_) {
      pendingProgrammaticBack = false;
      isAssistantMemory = false;
      try { window.history.replaceState({ rfPage: 'memory-bank' }, '', '#memory-bank'); } catch (_) {}
      renderDaily();
      return;
    }
    setTimeout(() => {
      if (!pendingProgrammaticBack || !isAssistantMemory || (window.location.hash || '') !== memoryHash) return;
      pendingProgrammaticBack = false;
      isAssistantMemory = false;
      try { window.history.replaceState({ rfPage: 'memory-bank' }, '', '#memory-bank'); } catch (_) {}
      renderDaily();
      if (viewportEl) viewportEl.scrollTop = 0;
    }, 320);
  }

  /** 从卷宗详情退回格墙：优先退栈，退不动就直接重绘 */
  function backToWall() {
    const hash = window.location.hash || '';
    if (hash.indexOf('#memory-bank/') !== 0) {
      currentForkId = '';
      renderWall();
      return;
    }
    pendingProgrammaticBack = true;
    try {
      window.history.back();
    } catch (_) {
      pendingProgrammaticBack = false;
      currentForkId = '';
      renderWall();
      return;
    }
    // 栈已到底时 popstate 不会触发，兜底自己重绘
    setTimeout(() => {
      if (pendingProgrammaticBack) {
        pendingProgrammaticBack = false;
        currentForkId = '';
        renderWall();
      }
    }, 320);
  }

  // 系统返回键 / 手势返回：按 hash 决定退到格墙还是收起整页
  window.addEventListener('popstate', () => {
    const wasProgrammatic = pendingProgrammaticBack;
    if (pendingProgrammaticBack) pendingProgrammaticBack = false;
    if (!isOpened || !containerEl) return;
    const hash = window.location.hash || '';
    if (hash.indexOf('#memory-bank/assistant-memory/') === 0) {
      const catId = hash.slice('#memory-bank/assistant-memory/'.length);
      let state = null;
      try { state = window.history.state; } catch (_) {}
      const tool = state && state.memTool ? String(state.memTool) : '';
      // 同一分类内的返回只收起编辑面板或多选，不重绘整页
      if (currentAssistantCategory && currentAssistantCategory === getAssistantCategory(catId).id
          && handleAssistantToolPop(tool, wasProgrammatic)) return;
      currentForkId = '';
      isAssistantMemory = true;
      currentAssistantCategory = catId;
      renderAssistantCategory(catId);
      if (viewportEl) viewportEl.scrollTop = 0;
    } else if (hash === '#memory-bank/assistant-memory') {
      currentForkId = '';
      currentAssistantCategory = '';
      renderAssistantMemory();
      if (viewportEl) viewportEl.scrollTop = 0;
    } else if (hash.indexOf('#memory-bank/') === 0) {
      const fid = hash.slice('#memory-bank/'.length);
      currentForkId = fid;
      othersExpanded = false;
      renderDetail(fid);
    } else if (hash === '#memory-bank') {
      currentForkId = '';
      currentAssistantCategory = '';
      if (currentTab === 'daily') renderDaily();
      else renderWall();
    } else {
      // hash 已离开本页（例如从卷宗直接跳去别的应用）：静默收起
      close(true);
    }
  });

  /* ---------------- 工具 ---------------- */

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' };
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
  }

  function formatTimeAgo(ts) {
    const t = Number(ts);
    if (!t) return '时间不详';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  return {
    open,
    close
  };
})();

window.MemoryBankApp = MemoryBankApp;