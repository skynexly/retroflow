/**
 * 溯流计划 · 使用手册与终端协议中枢 UI 控制器 (Manual App UI Controller)
 * 职责：
 *   1. 纯视图渲染层，完全由 window.SystemProtocols 知识库驱动；
 *   2. 支持 6 大分类右翼战术导轨书签切换、全文实时检索与战术折叠卡片列表。
 */
(() => {
  'use strict';

  let currentCategory = 'retroflow';
  let searchQuery = '';
  let expandedCardIds = new Set();

  let categoryRail = null;
  let searchInput = null;
  let searchClearBtn = null;
  let cardsStream = null;
  let emptyState = null;
  let isInitialized = false;

  function initElements() {
    categoryRail = document.getElementById('manualIndexRail');
    searchInput = document.getElementById('manualSearchInput');
    searchClearBtn = document.getElementById('manualSearchClearBtn');
    cardsStream = document.getElementById('manualCardsStream');
    emptyState = document.getElementById('manualEmptyState');
  }

  function bindEvents() {
    if (!categoryRail || !searchInput) return;

    // 1. 右翼战术索引导轨（书签点击切换 + 顶部角标收起/展开开关）
    categoryRail.addEventListener('click', (e) => {
      // 点击顶部角标按钮：收起或展开整个导轨
      const toggleBtn = e.target.closest('.rail-notch-toggle-btn');
      if (toggleBtn) {
        e.stopPropagation();
        const isCollapsed = categoryRail.classList.toggle('is-collapsed');
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        
        // 让工作区主容器同步切换避让 padding
        const manualLayout = document.querySelector('#manualDetailSection .api-body-layout, #manualDetailSection .settings-body-with-rail, #manualDetailSection .settings-body-scroll');
        if (manualLayout) {
          manualLayout.classList.toggle('rail-collapsed', isCollapsed);
        }
        return;
      }

      const bookmark = e.target.closest('.index-bookmark');
      if (!bookmark) return;
      const cat = bookmark.dataset.category;
      if (!cat || cat === currentCategory) return;

      currentCategory = cat;
      categoryRail.querySelectorAll('.index-bookmark').forEach(b => {
        const isSelected = b.dataset.category === currentCategory;
        b.classList.toggle('active', isSelected);
      });

      // 切换分类时重新渲染卡片
      renderCards();
    });

    // 2. 关键词搜索
    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').trim();
      if (searchClearBtn) {
        searchClearBtn.hidden = !searchQuery;
      }
      renderCards();
    });

    // 3. 清空搜索
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.hidden = true;
        searchInput.focus();
        renderCards();
      });
    }

    // 4. 卡片折叠/展开与关键词快搜委托
    if (cardsStream) {
      cardsStream.addEventListener('click', (e) => {
        // 点击关键词胶囊：快速填入搜索框并检索
        const pill = e.target.closest('.manual-keyword-pill');
        if (pill) {
          e.stopPropagation();
          const kw = pill.dataset.keyword || '';
          if (kw && searchInput) {
            searchInput.value = kw;
            searchQuery = kw.toLowerCase();
            if (searchClearBtn) searchClearBtn.hidden = false;
            renderCards();
          }
          return;
        }

        const header = e.target.closest('.manual-card-header');
        if (!header) return;
        const card = header.closest('.manual-article-card');
        if (!card) return;
        const cardId = card.dataset.id;
        if (!cardId) return;

        if (expandedCardIds.has(cardId)) {
          expandedCardIds.delete(cardId);
        } else {
          expandedCardIds.add(cardId);
        }
        updateCardExpandedState(card, expandedCardIds.has(cardId));
      });
    }
  }

  function updateCardExpandedState(cardEl, isExpanded) {
    cardEl.classList.toggle('expanded', isExpanded);
    const body = cardEl.querySelector('.manual-card-body');
    if (body) {
      body.hidden = !isExpanded;
    }
  }

  /**
   * 将正文文本格式化为机能子卡片流 (Sub-cards Stream)
   */
  function formatContentToSubCards(rawContent) {
    if (!rawContent) return '';
    
    // 按双换行分割段落/区块
    const blocks = rawContent.split(/\n{2,}/).filter(Boolean);
    
    return blocks.map(block => {
      const trimmed = block.trim();
      
      // 检测是否为带【模块标题】的子卡片
      const moduleMatch = trimmed.match(/^【([^】]+)】([\s\S]*)$/);
      if (moduleMatch) {
        const moduleTitle = moduleMatch[1].trim();
        const moduleBody = moduleMatch[2].trim();
        
        // 拆解子卡片内部的多行条目（如 · 理性：... 或 1. xxx）
        const lines = moduleBody.split('\n').filter(Boolean);
        const renderedLines = lines.map(line => {
          const itemMatch = line.trim().match(/^[·•\-*]\s*([^：:]+)[：:]([\s\S]+)$/);
          if (itemMatch) {
            const itemKey = itemMatch[1].trim();
            const itemVal = itemMatch[2].trim();
            return `
              <div class="manual-sub-item-row">
                <span class="manual-sub-item-key">${escapeHtml(itemKey)}</span>
                <span class="manual-sub-item-val">${escapeHtml(itemVal)}</span>
              </div>
            `;
          }
          return `<p class="manual-sub-card-p">${escapeHtml(line.trim())}</p>`;
        }).join('');

        return `
          <div class="manual-sub-card">
            <div class="manual-sub-card-header">
              <svg class="manual-sub-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              <span class="manual-sub-card-title">${escapeHtml(moduleTitle)}</span>
            </div>
            <div class="manual-sub-card-body">
              ${renderedLines}
            </div>
          </div>
        `;
      }

      // 检测是否为独立词条列表段落（以 · 开头）
      if (trimmed.startsWith('·') || trimmed.startsWith('•')) {
        const lines = trimmed.split('\n').filter(Boolean);
        const isAllItems = lines.every(l => /^[·•\-*]\s*([^：:]+)[：:]/.test(l.trim()));
        if (isAllItems) {
          const renderedItems = lines.map(line => {
            const itemMatch = line.trim().match(/^[·•\-*]\s*([^：:]+)[：:]([\s\S]+)$/);
            if (itemMatch) {
              return `
                <div class="manual-sub-item-row">
                  <span class="manual-sub-item-key">${escapeHtml(itemMatch[1].trim())}</span>
                  <span class="manual-sub-item-val">${escapeHtml(itemMatch[2].trim())}</span>
                </div>
              `;
            }
            return `<p class="manual-sub-card-p">${escapeHtml(line.trim())}</p>`;
          }).join('');

          return `
            <div class="manual-sub-card">
              <div class="manual-sub-card-body">
                ${renderedItems}
              </div>
            </div>
          `;
        }
      }

      // 普通正文段落
      return `<p class="manual-body-para">${escapeHtml(trimmed)}</p>`;
    }).join('');
  }

  function renderCards() {
    if (!cardsStream) return;

    // 从全局系统协议中枢进行检索与过滤
    const items = window.SystemProtocols
      ? window.SystemProtocols.search(searchQuery, searchQuery ? null : currentCategory)
      : [];

    if (items.length === 0) {
      cardsStream.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    cardsStream.innerHTML = items.map((item, idx) => {
      const isExpanded = searchQuery ? true : (expandedCardIds.has(item.id) || idx === 0);
      if (isExpanded) expandedCardIds.add(item.id);

      // 1. 概要 (Summary) 机能小卡片
      const summaryHtml = item.summary ? `
        <div class="manual-summary-card">
          <div class="manual-summary-header">
            <svg class="manual-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span class="manual-summary-tag">SUMMARY // 核心概要</span>
          </div>
          <p class="manual-summary-text">${escapeHtml(item.summary)}</p>
        </div>
      ` : '';

      // 2. 正文子卡片化流
      const formattedContent = formatContentToSubCards(item.content);

      // 3. 战术提示块 (Callout)
      const calloutHtml = item.callout ? `
        <div class="manual-callout">
          <span class="manual-callout-tag">${escapeHtml(item.callout.tag)}</span>
          <p>${escapeHtml(item.callout.text)}</p>
        </div>
      ` : '';

      // 4. 关键词胶囊流 (Keywords Row)
      const keywordsHtml = Array.isArray(item.keywords) && item.keywords.length > 0 ? `
        <div class="manual-keywords-row">
          <span class="manual-keywords-label">KEYWORDS //</span>
          <div class="manual-keywords-list">
            ${item.keywords.map(kw => `
              <button type="button" class="manual-keyword-pill" data-keyword="${escapeHtml(kw)}" title="点击快速检索 #${escapeHtml(kw)}">
                #${escapeHtml(kw)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : '';

      return `
        <article class="manual-article-card ${isExpanded ? 'expanded' : ''}" data-id="${item.id}">
          <header class="manual-card-header" role="button" tabindex="0">
            <div class="manual-card-header-left">
              <span class="manual-card-tag">${escapeHtml(item.tag)}</span>
              <h3 class="manual-card-title">${escapeHtml(item.title)}</h3>
              <span class="manual-card-subtitle">${escapeHtml(item.subtitle)}</span>
            </div>
            <div class="manual-card-header-right">
              <svg class="manual-chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </div>
          </header>
          <div class="manual-card-body" ${isExpanded ? '' : 'hidden'}>
            <div class="manual-card-content">
              ${summaryHtml}
              ${formattedContent}
              ${calloutHtml}
              ${keywordsHtml}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  function init() {
    initElements();
    if (!isInitialized) {
      bindEvents();
      isInitialized = true;
    }
    renderCards();
  }

  // 暴露给全局设置中枢调用
  window.RetroflowManualApp = {
    init,
    render: renderCards
  };

  // DOM 就绪后预初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initElements();
      bindEvents();
      isInitialized = true;
    });
  } else {
    initElements();
    bindEvents();
    isInitialized = true;
  }
})();