/**
 * 溯流计划 · 副本库艺术馆油画墙交互控制器 (Fork Archive Gallery UI)
 *
 * 架构规范：
 * 1. 严格遵守《工地施工协议》：零 emoji，纯 SVG 矢量图标，零分割线
 * 2. 严格使用全局主题变量：var(--bg-color), var(--card-bg-color), var(--primary-color), var(--secondary-color), var(--decor-color) 等
 * 3. 展厅切换器 (方案 B)：
 *    < 01展厅 · 无限世界 >  < 02展厅 · 三千世界 >
 * 4. 4列网格画廊排版循环律：
 *    每个展厅独立按照 5 个一组循环排布：
 *    - 1️⃣ 2*3  (左列高框)
 *    - 2️⃣ 2*2  (右列中方框，下方自然留白 2*1 展位)
 *    - 3️⃣ 1*1  (左侧紧凑小框，右侧下方自然留白 1*1 展位)
 *    - 4️⃣ 3*2  (右侧长横宽框)
 *    - 5️⃣ 4*2  (横跨4列全景画幅)
 * 5. 纯图片填满画框：等级置于右上角微标，名称与编号置于画框内底部居中（带渐变蒙层托底）
 */

(() => {
  'use strict';

  // 预设规格周期定义 (每5个一组循环，采用8列细分网格：1=2.5x3, 2=1.5x2, 3=1.5x1.5, 4=2.5x2, 5=4x2)
  const SPEC_CYCLE = [
    { spec: '2.5x3', ratioText: '5:6 PORTRAIT' },
    { spec: '1.5x2', ratioText: '3:4 SLENDER' },
    { spec: '1.5x1.5', ratioText: '1:1 SQUARE' },
    { spec: '2.5x2', ratioText: '5:5 GRAND' },
    { spec: '4x2', ratioText: '4:2 MONOLITH' }
  ];

  // 纯 SVG 7档战术水相微图腾 (禁止emoji，纯矢量机能线条)
  const LEVEL_SVGS = {
    // E 静水：一滴初生静水，万流推演的原点
    'E': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    // D 流深：水面平展 + 下层深潜暗流 V 轨（去杂点，开阔通透）
    'D': `<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    // C 清源：水源澄澈，向上的清源水滴菱形
    'C': `<svg viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    // B 狂澜：波涛翻涌，交错上升的双折波纹
    'B': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    // A 潮汐：引力潮汐，闭环涌动的双重潮弧
    'A': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    // S 深渊：万流沉沦，同心向下潜行的深邃梯阵
    'S': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    // S+ 归墟：万水汇聚湮灭之所，因果终极奇点微标
    'S+': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  // 统一水相因果评级字典 (精悍4~6字母英汉战术代号，适配所有画幅单行排版)
  const LEVEL_MAP = {
    'E': { letter: 'E', name: '静水', enName: 'STILL' },
    'D': { letter: 'D', name: '流深', enName: 'DEPTH' },
    'C': { letter: 'C', name: '清源', enName: 'SPRING' },
    'B': { letter: 'B', name: '狂澜', enName: 'SURGE' },
    'A': { letter: 'A', name: '潮汐', enName: 'TIDE' },
    'S': { letter: 'S', name: '深渊', enName: 'ABYSS' },
    'S+': { letter: 'S+', name: '归墟', enName: 'VOID' }
  };
  // 展厅定义：01 无限世界 / 02 三千世界。展品由 fork/index 实时提供，不写死数据。
  const SALONS = [
    {
      id: 'salon_01',
      code: 'SALON 01',
      title: '01展厅 · 无限世界',
      desc: '因果长河深渊断层 · 特级灾厄与收容实例'
    },
    {
      id: 'salon_02',
      code: 'SALON 02',
      title: '02展厅 · 三千世界',
      desc: '快穿因果分支切片 · 宿主干涉与轨迹修正'
    }
  ];

  // 画框色调轮转：索引里没写 tone 时按序号取一个，保证展墙冷暖交替不单调
  const TONE_CYCLE = ['obsidian-gold', 'deep-crimson', 'slate-blue', 'twilight-purple', 'gold-amber'];

  /** 读取油画墙轻量索引（Store 未装载时给空数组，页面呈空态而非报错） */
  function readForkIndex() {
    if (!window.Store || !Store.fork || !Array.isArray(Store.fork.index)) return [];
    return Store.fork.index;
  }

  /**
   * 取某展厅的展品，按创建序号 seq 升序陈列。
   *
   * 位置刻意绑定 seq 而非 updatedAt：档案馆靠编号定位，01 号框永远是 FORK-001，
   * 编纂或进出副本都不会让画框漂移。若日后要做「最近编纂优先」，另开排序开关，
   * 不要改动这里的默认口径。
   *
   * seq 缺失的老数据没有可靠位置，统一沉到队尾，按创建时间兜底排，
   * 避免它们插到有号副本中间把编号与位置的对应关系搅乱。
   */
  function getExhibits(salonId) {
    const seqOf = (it) => {
      const n = Number(it && it.seq);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    return readForkIndex()
      .filter((it) => it && (it.salonId || 'salon_01') === salonId)
      .slice()
      .sort((a, b) => {
        const sa = seqOf(a);
        const sb = seqOf(b);
        // 两边都有号：纯按创建序号升序，这是展墙的唯一权威顺序
        if (sa && sb) return sa - sb;
        // 只有一边有号：无号的老数据一律靠后
        if (sa) return -1;
        if (sb) return 1;
        // 两边都无号：退回创建时间升序，保证每次重绘顺序一致不跳动
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      });
  }

  // 本次展墙持有的封面 objectURL，重绘或关页时统一释放，避免反复进出泄漏
  let coverUrls = [];

  /** 释放全部封面 objectURL */
  function releaseAllCoverUrls() {
    if (window.Storage && typeof Storage.revokeAssetSrc === 'function') {
      coverUrls.forEach((u) => Storage.revokeAssetSrc(u));
    }
    coverUrls = [];
  }

  /**
   * 异步给已渲染的画框补挂封面。
   * 先出结构再补图，展墙不会因为等 IndexedDB 而白屏。
   */
  async function hydrateCovers(items) {
    if (!gridEl || !window.Storage) return;
    for (const item of items) {
      if (!item || !item.hasCover) continue;
      const key = window.DataRegistry
        ? DataRegistry.key.forkCover(item.id)
        : `fork/cover.${item.id}`;
      let src = '';
      try {
        src = await Storage.getAssetSrc(key);
      } catch (_) { continue; }
      if (!src) continue;
      coverUrls.push(src);
      const wrapper = gridEl.querySelector(`.fork-frame-wrapper[data-fork-id="${item.id}"]`);
      if (!wrapper) continue;
      const oilFrame = wrapper.querySelector('.fork-oil-frame');
      const media = wrapper.querySelector('.fork-canvas-media');
      if (!media) continue;

      const img = document.createElement('img');
      img.className = 'fork-canvas-img';
      img.src = src;
      img.alt = item.title || '副本封面';
      img.loading = 'lazy';

      // 封面挂载成功时，标记 has-cover 并彻底移除中间的罗盘占位图腾
      if (oilFrame) {
        oilFrame.classList.add('has-cover');
      }
      const artCenter = media.querySelector('.fork-canvas-art-center');
      if (artCenter) {
        artCenter.remove();
      }

      media.insertBefore(img, media.firstChild);
    }
  }


  let currentSalonIndex = 0;
  let pageEl = null;
  let gridEl = null;
  let scrollEl = null;
  let prevBtn = null;
  let nextBtn = null;
  let salonCodeEl = null;
  let salonTitleEl = null;
  let salonDisplayEl = null;
  let backBtn = null;
  let createBtn = null;
  // 展厅横向滑切状态：动画进行中锁定，避免重复点击造成动画叠加
  let isSwitching = false;
  let slideTimer = null;
  // 页面激活与历史栈状态标记
  let isOpened = false;
  let pendingProgrammaticBack = false;
  // 边缘手势滑动状态
  let touchStartX = 0;
  let touchStartY = 0;
  let isEdgeSwiping = false;
  let isEdgeLocked = false;
  let isEdgeHorizontal = false;
  // 鉴赏卷宗模态卡节点与当前展品引用
  let dossierEls = null;
  let activeExhibit = null;

  /**
   * 纯 SVG 图标集
   */
  const SVG_ICONS = {
    compass: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor"/></svg>`,
    emptyCurator: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3V3zm16 16V5H5v14h14zM11 7h2v6h-2V7zm0 8h2v2h-2v-2z" fill="currentColor"/></svg>`,
    // 通关：实心校准环内嵌对勾
    cleared: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M7.8 12.3l2.9 2.9 5.5-5.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    // 待通关：虚断校准环内嵌中置准星
    pending: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3.2 2.6"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>`,
    // 新建：细笔画加号
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/></svg>`
  };

  /**
   * 渲染单个画框 HTML (全幅图片填满 + 右上角悬浮等级 + 底部居中暗色托底名称)
   */
  function renderFrame(item, specInfo, displayIndex) {
    // 左上角微标只认副本自身的创建序号，与展陈编号 code 同源。
    // 刻意不再退回 displayIndex：位置已锚定 seq，若这里跟着排位走，
    // 一旦删除中间某本副本，无号老数据的微标就会整体漂移，编号失去可信度。
    // 序号缺失说明这本副本还没归档过号，直接呈待分配态而不是编个假号。
    const seqNum = Number(item.seq);
    const hasSeq = Number.isFinite(seqNum) && seqNum > 0;
    const paddedIndex = hasSeq ? String(seqNum).padStart(2, '0') : '--';
    const lvl = LEVEL_MAP[item.levelKey] || LEVEL_MAP['C'];
    const lvlSvg = LEVEL_SVGS[lvl.letter] || LEVEL_SVGS['C'];
    // 色调同样绑定 seq，保证增删相邻副本不会让整墙画框集体换色
    const toneSeed = hasSeq ? seqNum - 1 : displayIndex;
    const tone = item.tone || TONE_CYCLE[toneSeed % TONE_CYCLE.length];
    const title = item.title || '未命名副本';
    const code = item.code || (hasSeq ? `FORK-${paddedIndex}` : 'FORK-待归档');
    return `
      <div class="fork-frame-wrapper fork-frame-${specInfo.spec}" data-fork-id="${item.id}" tabindex="0" role="button" aria-label="${title}">
        <div class="fork-oil-frame tone-${tone}">
          <!-- 全幅背景图片或油画底衬（封面由 hydrateCovers 异步补挂） -->
          <div class="fork-canvas-media">
            <div class="fork-canvas-texture"></div>
            <div class="fork-canvas-art-center">
              <div class="fork-art-motif">${SVG_ICONS.compass}</div>
            </div>
          </div>

          <!-- 右上角悬浮等级徽标 (统一暗黑底 + 统一装饰高亮金 + 纯矢量水相微标 + 单斜杠公文代码) -->
          <div class="fork-level-pill" title="副本等级：${lvl.letter} / ${lvl.name}">
            <span class="fork-level-icon">${lvlSvg}</span>
            <span class="fork-level-code">${lvl.letter}</span>
            <span class="fork-level-sep">/</span>
            <span class="fork-level-name">${lvl.name}</span>
          </div>

          <!-- 左上角极细等宽序列微标 -->
          <div class="fork-seq-tag">
            <span class="fork-seq-num">${paddedIndex}</span>
          </div>

          <!-- 底部暗色渐变遮罩 + 居中标题与编号（等宽编号 // 英文水相战术评级代号） -->
          <div class="fork-bottom-scrim">
            <div class="fork-caption-title">${title}</div>
            <div class="fork-caption-meta">
              <span class="fork-caption-code">${code}</span>
              <span class="fork-caption-sep">//</span>
              <span class="fork-caption-spec">${lvl.enName}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染画框正上方的策展短句题铭 (Overhead Title Prelude)
   * 风格 1：古典衬线斜体，压低下方大画框，形成自然高低错位
   */
  function renderOverheadTitle(spec, text) {
    return `
      <div class="fork-inscript-overhead fork-overhead-${spec}" aria-hidden="true">
        <span class="fork-overhead-verse">${text}</span>
      </div>
    `;
  }

  /**
   * 渲染展墙物理空隙处的古典花体英文题铭 (Wall Inscription)
   * 彻底摒弃底色块，字迹如同直接烫印在展厅米色展墙上
   */
  function renderWallInscription(type, bayGroup) {
    if (type === 'long') {
      // 空隙 1：长句 (位于2号框正下方，宽3列x高3行，纯净诗句不加杂色标签)
      return `
        <div class="fork-wall-inscription fork-inscript-long" aria-hidden="true">
          <div class="fork-inscript-body">
            <span class="fork-inscript-verse">"All rivers flow into the void, yet the causal currents never cease to remember."</span>
          </div>
        </div>
      `;
    } else {
      // 空隙 2：短句 (位于3号框下方、补齐与4号框的高差，宽3列x高2行，优美拆成两排)
      return `
        <div class="fork-wall-inscription fork-inscript-short" aria-hidden="true">
          <div class="fork-inscript-body">
            <span class="fork-inscript-verse">"We navigate;<br>we never witness."</span>
          </div>
        </div>
      `;
    }
  }

  /**
   * 数据驱动构建当前展厅的画廊墙：
   * 实施 S 型波浪高低错落流动律 (Staggered Elevation)：
   * - 1号框上题铭 "Where currents converge." (宽5x高1) -> 1号压低1行
   * - 2号框 (宽3x高4) -> 右侧从顶端悬挂，产生左沉右浮错落
   * - 1号框 (宽5x高6) -> 紧承在题铭下方
   * - 空隙1长句 (宽3x高3) -> 承接在2号框下方，第一单元底端在第7行拉平！
   * - 3号框 (宽3x高3) -> 第二单元左侧
   * - 4号框 (宽5x高5) -> 与3号顶端平齐，自身吃满单元高度，无需补气隙
   * - 空隙2短句 (宽3x高2) -> 回填在3号正下方 (3+2=5)，第二单元底端拉平
   * - 5号全景大画框 (宽8x高4) -> 横贯全屏收官！
   */
  function buildCurrentSalon() {
    if (!gridEl) return;

    // 重绘前先释放上一批封面 URL，避免切展厅反复累积
    releaseAllCoverUrls();

    const currentSalon = SALONS[currentSalonIndex] || SALONS[0];
    const exhibits = getExhibits(currentSalon.id);
    let html = '';
    const total = exhibits.length;

    // 空展厅：只留一句展墙题铭与新建入口，不摆任何示例画框
    if (total === 0) {
      gridEl.innerHTML = renderEmptySalon();
      if (salonCodeEl) salonCodeEl.textContent = currentSalon.code;
      if (salonTitleEl) salonTitleEl.textContent = currentSalon.title;
      if (scrollEl) scrollEl.scrollTop = 0;
      return;
    }

    for (let i = 0; i < total; i++) {
      const cycleIndex = i % 5;
      const bayGroup = Math.floor(i / 5) + 1;
      const specInfo = SPEC_CYCLE[cycleIndex];
      const item = exhibits[i];

      // 逢 1 号框 (2.5*3) 渲染前，先渲染其头上的策展题词 (宽5列x高1行)
      if (cycleIndex === 0) {
        html += renderOverheadTitle('5x1', 'Where currents converge.');
      }

      // 渲染当前画框
      html += renderFrame(item, specInfo, i);

      // 逢第 2 个 (1.5*2) 之后插入空隙 1：古典花体长句 (宽3列x高3行，补齐与1号单元底端高差)
      if (cycleIndex === 1) {
        html += renderWallInscription('long', bayGroup);
      }

      // 逢第 4 个 (2.5*2.5) 之后插入空隙 2：极简花体两行短句 (宽3列x高2行，回填至3号下方 3+2=5 拉平底端)
      if (cycleIndex === 3) {
        html += renderWallInscription('short', bayGroup);
      }
    }

    gridEl.innerHTML = html;

    // 结构先落地，封面异步补挂
    hydrateCovers(exhibits);

    // 更新 Stepper 显示文本
    if (salonCodeEl) salonCodeEl.textContent = currentSalon.code;
    if (salonTitleEl) salonTitleEl.textContent = currentSalon.title;

    // 滚动区回到展厅顶部
    if (scrollEl) {
      scrollEl.scrollTop = 0;
    }
  }

  /**
   * 空展厅态：展墙上只烫印一行题铭与一枚新建副本入口
   */
  function renderEmptySalon() {
    return `
      <div class="fork-salon-empty">
        <div class="fork-salon-empty-motif">${SVG_ICONS.emptyCurator}</div>
        <div class="fork-salon-empty-verse">This wall awaits its first current.</div>
        <div class="fork-salon-empty-text">本展厅尚无归档副本</div>
        <button type="button" class="fork-salon-empty-btn" id="forkSalonCreateBtn">
          ${SVG_ICONS.plus}
          <span>新建副本</span>
        </button>
      </div>
    `;
  }

  /**
   * 切换展厅 (方向: -1 上一个, +1 下一个)
   * 横向滑切：旧展墙朝切换反方向推出，新展墙从对侧推入，
   * 营造镜头沿展馆长廊平移到下一个展厅的实体空间感
   */
  function switchSalon(direction) {
    // 动画进行中忽略重复点击，避免两套动画叠加导致展墙卡在半途
    if (isSwitching) return;

    const totalSalons = SALONS.length;
    if (totalSalons <= 1) return;

    currentSalonIndex = (currentSalonIndex + direction + totalSalons) % totalSalons;

    if (!gridEl) {
      buildCurrentSalon();
      return;
    }

    isSwitching = true;

    // Next(+1)：旧墙向左推出，新墙自右侧入场；Prev(-1)：反向
    const goingNext = direction > 0;
    const outClass = goingNext ? 'fork-slide-out-left' : 'fork-slide-out-right';
    const fromClass = goingNext ? 'fork-slide-from-right' : 'fork-slide-from-left';

    clearSlideClasses();
    gridEl.classList.add(outClass);

    // 第一段：旧展墙推出 (170ms)
    slideTimer = setTimeout(() => {
      // 重绘为新展厅内容，并瞬时移到对侧屏幕外待命
      buildCurrentSalon();
      clearSlideClasses();
      gridEl.classList.add(fromClass);

      // 强制一次样式计算，确保起点生效后再放行，否则浏览器会合并两帧导致没有滑入过程
      void gridEl.offsetWidth;

      // 第二段：新展墙果冻减速归位 (360ms)
      gridEl.classList.remove(fromClass);
      gridEl.classList.add('fork-slide-settle');

      slideTimer = setTimeout(() => {
        clearSlideClasses();
        isSwitching = false;
        slideTimer = null;
      }, 380);
    }, 170);
  }

  /** 清理全部滑切状态类，保证展墙回到无 transform 的干净基线 */
  function clearSlideClasses() {
    if (!gridEl) return;
    gridEl.classList.remove(
      'fork-slide-out-left',
      'fork-slide-out-right',
      'fork-slide-from-right',
      'fork-slide-from-left',
      'fork-slide-settle'
    );
  }

  /**
   * 依 id 在油画墙索引中检索展品
   */
  function findExhibitById(forkId) {
    return readForkIndex().find((it) => it && it.id === forkId) || null;
  }

  /**
   * 聚焦到某个副本所在的展厅并重绘，然后给那幅画一次短暂高亮。
   * 编纂器保存后调用，跨展厅新建也能立刻在展墙上看到成果。
   */
  function focusFork(forkId) {
    const item = findExhibitById(forkId);
    if (!item) {
      buildCurrentSalon();
      return;
    }

    const salonId = item.salonId || 'salon_01';
    const at = SALONS.findIndex((s) => s.id === salonId);
    if (at >= 0) currentSalonIndex = at;

    buildCurrentSalon();

    if (!gridEl) return;
    const frame = gridEl.querySelector(`.fork-frame-wrapper[data-fork-id="${forkId}"]`);
    if (!frame) return;

    // 高亮呼吸一次即摘掉，不在 DOM 上留状态
    frame.classList.add('is-just-archived');
    setTimeout(() => frame.classList.remove('is-just-archived'), 1400);
  }

  /**
   * 缓存鉴赏卷宗模态卡的 DOM 引用
   */
  function cacheDossierEls() {
    if (dossierEls) return dossierEls;

    const overlay = document.getElementById('forkDossierOverlay');
    if (!overlay) return null;

    dossierEls = {
      overlay,
      backdrop: document.getElementById('forkDossierBackdrop'),
      closeBtn: document.getElementById('forkDossierCloseBtn'),
      media: document.getElementById('forkDossierMedia'),
      oilFrame: document.getElementById('forkDossierOilFrame'),
      levelIcon: document.getElementById('forkDossierLevelIcon'),
      levelCode: document.getElementById('forkDossierLevelCode'),
      levelName: document.getElementById('forkDossierLevelName'),
      code: document.getElementById('forkDossierCode'),
      statusPill: document.getElementById('forkDossierStatusPill'),
      statusIcon: document.getElementById('forkDossierStatusIcon'),
      statusText: document.getElementById('forkDossierStatusText'),
      title: document.getElementById('forkDossierTitle'),
      desc: document.getElementById('forkDossierDesc'),
      body: document.querySelector('#forkDossierDialog .fork-dossier-body'),
      viewBtn: document.getElementById('forkDossierViewBtn'),
      enterBtn: document.getElementById('forkDossierEnterBtn'),
      logBtn: document.getElementById('forkDossierLogBtn'),
      logCount: document.getElementById('forkDossierLogCount')
    };
    return dossierEls;
  }

  /**
   * 打开鉴赏卷宗模态卡并绑定展品数据
   */
  function openDossier(forkId) {
    const els = cacheDossierEls();
    if (!els) return;

    const item = findExhibitById(forkId);
    if (!item) return;

    activeExhibit = item;

    const lvl = LEVEL_MAP[item.levelKey] || LEVEL_MAP['C'];
    const lvlSvg = LEVEL_SVGS[lvl.letter] || LEVEL_SVGS['C'];

    // 封面：先落纯 SVG 水相图腾占位，有归档封面时再异步替换为原图
    if (els.media) {
      els.media.innerHTML = `<div class="fork-dossier-placeholder"><div class="fork-dossier-placeholder-motif">${SVG_ICONS.compass}</div></div>`;
      if (item.hasCover && window.Storage) {
        const key = window.DataRegistry
          ? DataRegistry.key.forkCover(item.id)
          : `fork/cover.${item.id}`;
        Storage.getAssetSrc(key).then((src) => {
          // 异步返回时用户可能已换看别的展品，比对一次再落图
          if (!src || !activeExhibit || activeExhibit.id !== item.id) return;
          coverUrls.push(src);
          els.media.innerHTML = `<img src="${src}" alt="${item.title || '副本封面'}">`;
        }).catch(() => {});
      }
    }

    if (els.oilFrame) {
      els.oilFrame.className = `fork-dossier-oil-frame tone-${item.tone || 'obsidian-gold'}`;
    }

    if (els.levelIcon) els.levelIcon.innerHTML = lvlSvg;
    if (els.levelCode) els.levelCode.textContent = lvl.letter;
    if (els.levelName) els.levelName.textContent = lvl.name;
    if (els.code) els.code.textContent = item.code || '未编号';
    if (els.title) els.title.textContent = item.title || '未命名副本';
    // 概述直接用索引里的 120 字摘要，展陈不读长文正文
    if (els.desc) els.desc.textContent = item.overview || '该副本尚未填写概述。';

    // 通关状态徽标：纯 SVG 校准环，禁用 emoji
    const cleared = !!item.cleared;
    if (els.statusPill) els.statusPill.classList.toggle('is-cleared', cleared);
    if (els.statusIcon) els.statusIcon.innerHTML = cleared ? SVG_ICONS.cleared : SVG_ICONS.pending;
    if (els.statusText) els.statusText.textContent = cleared ? '已通关' : '待通关';

    // 下潜记录入口：先按空态渲染，再异步读存档回填。
    // 同步先置空是为了防止上一本的次数残留在这一本上（模态卡是复用的同一批节点）。
    if (els.logBtn) els.logBtn.classList.add('is-empty');
    if (els.logCount) {
      els.logCount.hidden = true;
      els.logCount.textContent = '';
    }
    if (window.ForkRunStore && typeof ForkRunStore.getForkRunSummary === 'function') {
      ForkRunStore.getForkRunSummary(item.id).then((sum) => {
        // 异步返回时用户可能已换看别的展品，比对一次再落值
        if (!activeExhibit || activeExhibit.id !== item.id) return;
        const total = sum && sum.total ? sum.total : 0;
        if (els.logBtn) els.logBtn.classList.toggle('is-empty', total === 0);
        if (els.logCount) {
          els.logCount.hidden = total === 0;
          els.logCount.textContent = total ? `×${total}` : '';
        }
      }).catch(() => {});
    }

    if (els.body) els.body.scrollTop = 0;

    els.overlay.classList.add('active');
    els.overlay.setAttribute('aria-hidden', 'false');
  }

  /**
   * 关闭鉴赏卷宗模态卡
   */
  function closeDossier() {
    const els = cacheDossierEls();
    if (!els) return;

    els.overlay.classList.remove('active');
    els.overlay.setAttribute('aria-hidden', 'true');
    activeExhibit = null;
  }

  /**
   * 打开副本库全屏视图
   */
  function open() {
    if (!pageEl) init();
    if (!pageEl) return;

    document.body.classList.add('page-active');
    pageEl.classList.add('active');
    pageEl.setAttribute('aria-hidden', 'false');
    isOpened = true;

    // 压入历史栈，支持手机物理返回键与手势返回
    if (window.location.hash !== '#fork-archive') {
      try {
        window.history.pushState({ rfPage: 'fork-archive' }, '', '#fork-archive');
      } catch (_) {}
    }

    // 每次进入都按最新索引重绘：编纂器里改过标题或封面能立刻反映
    buildCurrentSalon();

    if (scrollEl) {
      scrollEl.scrollTop = 0;
    }
  }

  /**
   * 新建副本：直接推入编纂器空白卷宗，落库时机交给编纂器的保存
   */
  function createFork() {
    const salon = SALONS[currentSalonIndex] || SALONS[0];
    if (!window.ForkEditorUI || typeof window.ForkEditorUI.open !== 'function') return;
    const newId = `fork_${Date.now()}`;
    window.ForkEditorUI.open(newId, { salonId: salon.id });
  }

  /**
   * 关闭副本库视图
   * @param {boolean} silent 为 true 时仅收起 UI、不操作 history
   */
  function close(silent) {
    if (!pageEl || !isOpened) return;
    isOpened = false;

    // 关页时若滑切动画未跑完，清掉定时器与状态类，避免下次进入时被锁死或残留 transform
    if (slideTimer) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
    clearSlideClasses();
    isSwitching = false;

    // 关页时一并收起鉴赏卷宗，避免下次进入残留浮层
    closeDossier();
    // 释放本次展墙持有的全部封面 objectURL
    releaseAllCoverUrls();

    pageEl.classList.remove('active');
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('page-active');

    if (!silent && window.location.hash === '#fork-archive') {
      pendingProgrammaticBack = true;
      try {
        window.history.back();
      } catch (_) {
        pendingProgrammaticBack = false;
      }
      setTimeout(() => {
        pendingProgrammaticBack = false;
      }, 300);
    }
  }

  /**
   * 初始化控制器
   */
  function init() {
    pageEl = document.getElementById('forkArchivePage');
    if (!pageEl) return;

    gridEl = document.getElementById('forkGalleryGrid');
    scrollEl = document.getElementById('forkGalleryScroll');
    prevBtn = document.getElementById('forkSalonPrevBtn');
    nextBtn = document.getElementById('forkSalonNextBtn');
    salonCodeEl = document.getElementById('forkSalonCode');
    salonTitleEl = document.getElementById('forkSalonTitle');
    salonDisplayEl = document.getElementById('forkSalonDisplay');
    backBtn = document.getElementById('forkArchiveBackBtn');
    createBtn = document.getElementById('forkArchiveCreateBtn');

    if (backBtn) {
      backBtn.addEventListener('click', () => close());
    }

    if (createBtn) {
      createBtn.addEventListener('click', () => createFork());
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => switchSalon(-1));
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => switchSalon(1));
    }

    // 点击中间标题也可以快速切换下一个展厅
    if (salonDisplayEl) {
      salonDisplayEl.addEventListener('click', () => switchSalon(1));
    }

    buildCurrentSalon();

    // 点击画框：唤出居中鉴赏卷宗；空态新建按钮同轨委托
    if (gridEl) {
      gridEl.addEventListener('click', (e) => {
        if (e.target.closest('#forkSalonCreateBtn')) {
          createFork();
          return;
        }
        const frame = e.target.closest('.fork-frame-wrapper');
        if (frame && frame.dataset.forkId) {
          openDossier(frame.dataset.forkId);
        }
      });
    }

    // 卷宗卡：遮罩与关闭键
    const dEls = cacheDossierEls();
    if (dEls) {
      if (dEls.backdrop) {
        dEls.backdrop.addEventListener('click', () => closeDossier());
      }
      if (dEls.closeBtn) {
        dEls.closeBtn.addEventListener('click', () => closeDossier());
      }

      // 查看副本：关闭卷宗并推入无限世界副本深度编纂全屏视图
      if (dEls.viewBtn) {
        dEls.viewBtn.addEventListener('click', () => {
          if (!activeExhibit) return;
          const item = activeExhibit;
          const forkId = item.id;
          // 先关闭卷宗卡
          closeDossier();
          // 若编纂器模块已就绪，立即打开
          if (window.ForkEditorUI && typeof window.ForkEditorUI.open === 'function') {
            // open 是异步的，裸调时 reject 会静默丢失，这里显式接住并告警
            Promise.resolve(window.ForkEditorUI.open(forkId)).catch((err) => {
              console.warn('[ForkArchive] 打开副本编纂器失败：', forkId, err);
              if (window.RetroToast) {
                window.RetroToast.show({
                  tag: 'FORK // 打开失败',
                  message: `无法打开：${item.title}`,
                  detail: String(err && err.message ? err.message : err),
                  type: 'error'
                });
              }
            });
          } else {
            if (window.RetroToast) {
              window.RetroToast.show({
                tag: 'FORK // 副本编纂',
                message: `打开副本：${item.title}`,
                detail: '编纂模块装载中，请稍候…',
                type: 'info'
              });
            }
          }
        });
      }

      // 进入副本：收起卷宗卡，推入推演终端。
      // 不新开档 —— ForkRunUI 内部会续上未结算的那条线，
      // 点错一次就多一条废线是很糟的体验，开新档由下潜记录页显式发起。
      if (dEls.enterBtn) {
        dEls.enterBtn.addEventListener('click', () => {
          if (!activeExhibit) return;
          const item = activeExhibit;
          closeDossier();

          if (window.ForkRunUI && typeof ForkRunUI.open === 'function') {
            Promise.resolve(ForkRunUI.open(item.id)).catch((err) => {
              console.warn('[ForkArchive] 进入副本失败：', item.id, err);
              if (window.RetroToast) {
                window.RetroToast.show({
                  tag: 'FORK // 接入失败',
                  message: `无法进入：${item.title}`,
                  detail: String(err && err.message ? err.message : err),
                  type: 'error'
                });
              }
            });
            return;
          }

          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'FORK // 因果接入',
              message: `进入副本：${item.title}`,
              detail: `${item.code} · 推演模块装载中，请稍候…`,
              type: 'info'
            });
          }
        });
      }
      // 下潜记录：推入独立全屏页（页面待建，先给占位反馈）
      if (dEls.logBtn) {
        dEls.logBtn.addEventListener('click', () => {
          if (!activeExhibit) return;
          const item = activeExhibit;
          // 与 viewBtn 同一套路：先收模态卡，再推全屏页。
          // 返回时直接回卷宗库列表，不重开模态卡，避免多一层返回。
          closeDossier();
          if (window.ForkDiveLogUI && typeof ForkDiveLogUI.open === 'function') {
            ForkDiveLogUI.open(item.id);
            return;
          }
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'DIVE LOG // 下潜记录',
              message: `${item.title} 的下潜记录`,
              detail: `${item.code} · 记录模块待建`,
              type: 'info'
            });
          }
        });
      }
    }

    // 绑定左边缘滑动手势与浏览器 popstate 物理返回
    bindEdgeSwipe();
    bindPopState();
  }

  /**
   * 绑定屏幕左边缘右滑返回手势 (Edge Swipe Back)
   */
  function bindEdgeSwipe() {
    if (!pageEl) return;

    pageEl.addEventListener('touchstart', (e) => {
      if (!isOpened) return;
      if (e.touches && e.touches.length > 1) return;
      const t = e.touches[0];
      // 必须从屏幕最左边缘 (<= 48px) 起手，严防与展墙内画框点按滚动冲突
      if (t.clientX > 48) {
        isEdgeSwiping = false;
        return;
      }
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      isEdgeSwiping = true;
      isEdgeLocked = false;
      isEdgeHorizontal = false;
    }, { passive: true });

    pageEl.addEventListener('touchmove', (e) => {
      if (!isEdgeSwiping) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      if (!isEdgeLocked) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          isEdgeLocked = true;
          // 向右滑动且水平主导
          isEdgeHorizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
        }
      }
    }, { passive: true });

    pageEl.addEventListener('touchend', (e) => {
      if (!isEdgeSwiping) return;
      isEdgeSwiping = false;
      if (!isEdgeHorizontal) return;

      const t = e.changedTouches ? e.changedTouches[0] : null;
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      // 触发条件：从左边缘向右滑动超过 64px 且垂直偏离不大
      if (dx > 64 && Math.abs(dy) < dx * 0.75) {
        // 如果鉴赏卷宗模态卡开着，优先收起模态卡
        const dEls = cacheDossierEls();
        if (dEls && dEls.overlay && dEls.overlay.classList.contains('active')) {
          closeDossier();
        } else {
          close();
        }
      }
    }, { passive: true });

    pageEl.addEventListener('touchcancel', () => {
      isEdgeSwiping = false;
      isEdgeLocked = false;
      isEdgeHorizontal = false;
    });
  }

  /**
   * 绑定浏览器历史路由与系统/物理手势返回
   */
  function bindPopState() {
    window.addEventListener('popstate', () => {
      if (pendingProgrammaticBack) {
        pendingProgrammaticBack = false;
        return;
      }

      // 如果文本编辑器在上层，返回归它处理
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;

      // 如果副本编纂器或推演正在上层，这次返回归它
      if (window.ForkEditorUI && typeof ForkEditorUI.isOpen === 'function' && ForkEditorUI.isOpen()) return;
      if (window.ForkRunUI && typeof ForkRunUI.isOpen === 'function' && ForkRunUI.isOpen()) return;

      if (!isOpened) return;

      // 1. 鉴赏卷宗模态卡开着：优先收起卷宗卡，并补回一条页面路由，防止直接退出整个展厅
      const dEls = cacheDossierEls();
      if (dEls && dEls.overlay && dEls.overlay.classList.contains('active')) {
        closeDossier();
        try {
          window.history.pushState({ rfPage: 'fork-archive' }, '', '#fork-archive');
        } catch (_) {}
        return;
      }

      // 2. 正常退回主桌面
      const hash = window.location.hash || '';
      if (hash !== '#fork-archive') {
        close(true);
      }
    });
  }

  // 挂载全局对象
  window.ForkArchiveUI = {
    open,
    close,
    init,
    switchSalon,
    buildCurrentSalon,
    focusFork,
    createFork,
    openDossier,
    closeDossier
  };

  // DOM 就绪后自初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();