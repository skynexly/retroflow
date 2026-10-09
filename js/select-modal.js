/**
 * 溯流计划 · 通用机能选项面板 (SelectModal Controller)
 * 职责：
 * 1. 替代浏览器原生粗糙的 <select> 控件，提供统一的机能美学选项面板
 * 2. 支持单项极速选择、当前项高亮与纯 SVG 勾选反馈
 * 3. 支持多选模式 (pickMulti)：勾选可反复切换，底部确认条一次性提交
 * 4. 智能搜索过滤：当选项数 > 8 时自动激活顶部快速过滤框
 * 5. 遵循零物理分割线规范、全量 CSS 变量体系
 * 6. 提供 Promise 接口 SelectModal.pick / SelectModal.pickMulti
 *
 * 单选与多选的返回语义不同：
 *   pick      → Promise<string|null>   取消返回 null
 *   pickMulti → Promise<string[]|null> 取消返回 null，确认返回选中值数组（可为空数组）
 * 取消一律用 null，好让调用方区分「没动」与「清空了全部选择」。
 */
const SelectModal = (() => {
  'use strict';

  let overlay = null;
  let tagEl = null;
  let titleEl = null;
  let closeBtn = null;
  let searchWrap = null;
  let searchInput = null;
  let listEl = null;
  let emptyTip = null;
  let footerEl = null;
  let footerCountEl = null;
  let footerConfirmBtn = null;

  let currentResolver = null;
  let currentOptions = [];
  let currentValue = '';
  let isInitialized = false;
  // 多选态：模式标记与已选集合
  let isMulti = false;
  let selectedSet = new Set();

  function initDOM() {
    if (isInitialized) return;
    overlay = document.getElementById('selectModalOverlay');
    if (!overlay) return;

    tagEl = document.getElementById('selectModalTag');
    titleEl = document.getElementById('selectModalTitle');
    closeBtn = document.getElementById('selectModalCloseBtn');
    searchWrap = document.getElementById('selectModalSearchWrap');
    searchInput = document.getElementById('selectModalSearchInput');
    listEl = document.getElementById('selectModalList');
    emptyTip = document.getElementById('selectModalEmptyTip');
    footerEl = document.getElementById('selectModalFooter');
    footerCountEl = document.getElementById('selectModalPickedCount');
    footerConfirmBtn = document.getElementById('selectModalConfirmBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => close(null));
    }

    if (footerConfirmBtn) {
      footerConfirmBtn.addEventListener('click', () => {
        close(Array.from(selectedSet));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        filterOptions(searchInput.value.trim().toLowerCase());
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close(null);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.hidden) {
        close(null);
      }
    });

    isInitialized = true;
  }

  /** 多选底部计数条同步 */
  function syncFooter() {
    if (!footerEl) return;
    footerEl.hidden = !isMulti;
    if (!isMulti || !footerCountEl) return;
    const n = selectedSet.size;
    footerCountEl.textContent = n > 0 ? ('已选 ' + n + ' 项') : '未选择任何项';
  }

  /** 判定某项当前是否处于选中态（单选看 currentValue，多选看集合） */
  function isPicked(opt) {
    const v = String(opt.value);
    return isMulti ? selectedSet.has(v) : v === String(currentValue);
  }

  /** 勾选图标节点 */
  function buildCheckIcon() {
    const checkIcon = document.createElement('div');
    checkIcon.className = 'select-item-check-icon';
    checkIcon.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;
    return checkIcon;
  }

  function renderList(filtered) {
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!filtered || filtered.length === 0) {
      if (emptyTip) emptyTip.hidden = false;
      return;
    }

    if (emptyTip) emptyTip.hidden = true;

    // 分组标题：opt.group 为真时渲染成不可点的机能小标，不参与选择
    let lastGroup = null;

    filtered.forEach((opt) => {
      const group = opt.group ? String(opt.group) : '';
      if (group && group !== lastGroup) {
        const groupRow = document.createElement('div');
        groupRow.className = 'select-modal-group-label';
        groupRow.textContent = group;
        listEl.appendChild(groupRow);
        lastGroup = group;
      }

      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = 'select-modal-item';
      // 失效态：opt.disabled 为真时置灰、不可选，但仍完整陈列让用户知道该机制存在
      const isDisabled = !!opt.disabled;
      if (isDisabled) {
        itemBtn.classList.add('is-disabled');
        itemBtn.setAttribute('aria-disabled', 'true');
      }
      if (isPicked(opt)) itemBtn.classList.add('selected');
      if (isMulti) {
        itemBtn.setAttribute('aria-pressed', String(isPicked(opt)));
      }

      // 选项左侧内容包裹层（图标 + 文本）
      const leftCluster = document.createElement('div');
      leftCluster.className = 'select-item-left-cluster';

      // 可选的前置纯 SVG 图标位
      if (opt.iconSvg && typeof opt.iconSvg === 'string') {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'select-item-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = opt.iconSvg;
        leftCluster.appendChild(iconSpan);
      }

      // 文本组（主标签 + 说明副标题）
      const labelWrap = document.createElement('div');
      labelWrap.className = 'select-item-text-group';

      const mainLabel = document.createElement('span');
      mainLabel.className = 'select-item-label';
      mainLabel.textContent = opt.label !== undefined ? String(opt.label) : String(opt.value);
      labelWrap.appendChild(mainLabel);

      if (opt.hint) {
        const hintSpan = document.createElement('span');
        hintSpan.className = 'select-item-hint';
        hintSpan.textContent = opt.hint;
        labelWrap.appendChild(hintSpan);
      }

      leftCluster.appendChild(labelWrap);
      itemBtn.appendChild(leftCluster);

      // 右侧纯 SVG 选中勾选指示
      if (isPicked(opt)) itemBtn.appendChild(buildCheckIcon());

      // 可选的右侧动作按钮（如删除）。带了 onAction 才渲染，点击不触发选线切换
      if (typeof opt.onAction === 'function') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'select-item-action-btn';
        actionBtn.setAttribute('aria-label', opt.actionLabel || '操作');
        if (opt.actionLabel) actionBtn.title = opt.actionLabel;
        actionBtn.innerHTML = opt.actionIconSvg || `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        `;
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          opt.onAction(opt);
        });
        itemBtn.appendChild(actionBtn);
      }

      itemBtn.addEventListener('click', () => {
        // 失效项：只提示原因，不改变选择、不关闭面板
        if (isDisabled) {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'LOCKED // 条件未满足',
              message: `「${opt.label !== undefined ? opt.label : opt.value}」当前不可选`,
              detail: opt.disabledReason || '该选项的启用条件尚未满足',
              type: 'info'
            });
          }
          return;
        }
        if (!isMulti) {
          close(opt.value);
          return;
        }
        // 多选：就地切换勾选态，不关闭面板
        const v = String(opt.value);
        if (selectedSet.has(v)) selectedSet.delete(v);
        else selectedSet.add(v);

        const on = selectedSet.has(v);
        itemBtn.classList.toggle('selected', on);
        itemBtn.setAttribute('aria-pressed', String(on));
        const oldIcon = itemBtn.querySelector('.select-item-check-icon');
        if (on && !oldIcon) itemBtn.appendChild(buildCheckIcon());
        if (!on && oldIcon) oldIcon.remove();
        syncFooter();
      });

      listEl.appendChild(itemBtn);
    });
  }

  function filterOptions(keyword) {
    if (!keyword) {
      renderList(currentOptions);
      return;
    }
    const filtered = currentOptions.filter((opt) => {
      const label = String(opt.label || '').toLowerCase();
      const val = String(opt.value || '').toLowerCase();
      const hint = String(opt.hint || '').toLowerCase();
      return label.includes(keyword) || val.includes(keyword) || hint.includes(keyword);
    });
    renderList(filtered);
  }

  function open(options = {}) {
    initDOM();
    if (!overlay) return Promise.resolve(null);

    const {
      title = '请选择',
      tag = 'SELECTION // 选项指派',
      options: optList = [],
      value = '',
      values = null,        // 多选初始已选值数组
      multi = false,        // 是否多选模式
      confirmText = '确认绑定',
      searchable = null // 自动判定或显式指定
    } = options;

    currentOptions = Array.isArray(optList) ? optList : [];
    currentValue = value !== undefined && value !== null ? String(value) : '';
    isMulti = !!multi;
    selectedSet = new Set(
      isMulti && Array.isArray(values) ? values.map((v) => String(v)) : []
    );

    if (tagEl) tagEl.textContent = tag;
    if (titleEl) titleEl.textContent = title;
    if (footerConfirmBtn) footerConfirmBtn.textContent = confirmText;
    syncFooter();

    if (searchInput) {
      searchInput.value = '';
    }

    const shouldSearch = searchable !== null ? !!searchable : currentOptions.length > 8;
    if (searchWrap) {
      searchWrap.hidden = !shouldSearch;
    }

    renderList(currentOptions);

    overlay.hidden = false;

    // 自动聚焦到当前选中的项目或搜索框
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      if (shouldSearch && searchInput) {
        // 移动端体验：不过度强行 focus 以免顶起软键盘遮挡选项列表
      } else {
        const selectedItem = listEl?.querySelector('.select-modal-item.selected');
        if (selectedItem) {
          selectedItem.scrollIntoView({ block: 'nearest' });
        }
      }
    });

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  function close(result) {
    if (!overlay) return;
    overlay.classList.remove('active');

    setTimeout(() => {
      overlay.hidden = true;
      if (currentResolver) {
        currentResolver(result);
        currentResolver = null;
      }
    }, 200);
  }

  return {
    pick: open,
    /** 多选入口：返回 Promise<string[]|null>，取消为 null */
    pickMulti: (options = {}) => open(Object.assign({}, options, { multi: true })),
    close
  };
})();

// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.SelectModal 写法
window.SelectModal = SelectModal;