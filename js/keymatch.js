/*
 * 关键词匹配内核 —— 供世界观/世界书「动态条目」判定命中使用。
 *
 * keys 仍是逗号/空格分隔的多项，每一项支持三种写法：
 *   猫            普通子串（历史行为，老数据零影响）
 *   /\bcat\b/i    正则，可带 i / m / s / u 标志
 *   "猫"          全词精确匹配（两侧不能紧邻同类字符）
 *
 * 【为什么普通子串和正则用不同的文本】
 * 历史实现是把正文整体转小写后再 includes，等于「子串永远大小写不敏感」。
 * 正则如果也拿小写文本匹配，用户写 /[A-Z]/ 就永远命中不了，违反正则直觉。
 * 所以：子串沿用小写文本（保持现状），正则匹配原始文本、大小写由 i 标志自己控制。
 *
 * 【为什么不做短词保护】
 * 动态条目本来就允许单字触发（节日那套 length<2 跳过的规则不适用于此），
 * 加保护会让用户已有的单字 keys 静默失效。
 */
const KeyMatch = (() => {
  'use strict';

  // 正则模式长度上限：正常手写规则远达不到，超长基本是误粘贴正文。
  const MAX_PATTERN_LENGTH = 500;
  // 单次匹配耗时熔断（毫秒）。用于兜住灾难性回溯，例如 /(a+)+$/ 撞上长文本。
  const MATCH_TIMEOUT_MS = 50;
  // 编译缓存：同一条 keys 每轮都会重新判定，重复编译纯属浪费。
  const _regexCache = new Map();
  const MAX_CACHE_SIZE = 500;

  function _isRegexLiteral(token) {
    if (token.length < 3 || token[0] !== '/') return false;
    const end = token.lastIndexOf('/');
    return end > 0 && /^[gimsuy]*$/.test(token.slice(end + 1));
  }

  function _isQuoted(token) {
    return token.length >= 3 && (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith('“') && token.endsWith('”'))
    );
  }

  function _escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 切分 keys 字符串成若干项。
   *
   * 【为什么不能直接 split(/[,，\s]+/)】
   * 正则量词里带逗号太常见了（`{0,6}`），字符类里也可能有空格。
   * 先切再识别会把 `/(晨|早).{0,6}(光柱|倾泻)/` 撕成
   * `/(晨|早).{0` 和 `6}(光柱|倾泻)/` 两段——两段都不是合法正则字面量，
   * 于是静默降级成普通文本匹配，用户看不到任何报错但条目永远不命中。
   * 所以这里改成扫描式分词：进入 /.../ 或 "..." 之后，
   * 内部的逗号和空白都算内容，只有在结构外部才是分隔符。
   */
  function tokenize(keysString) {
    const s = String(keysString == null ? '' : keysString);
    const tokens = [];
    let buf = '';
    const flush = () => { const t = buf.trim(); if (t) tokens.push(t); buf = ''; };

    let i = 0;
    while (i < s.length) {
      const ch = s[i];

      // 分隔符：逗号（中英）和空白
      if (ch === ',' || ch === '，' || /\s/.test(ch)) { flush(); i++; continue; }

      // 正则字面量：只有在项的开头出现 / 才算，避免把 a/b 这种普通词误判
      if (ch === '/' && buf === '') {
        const end = _scanRegexLiteral(s, i);
        if (end > i) { tokens.push(s.slice(i, end)); i = end; continue; }
        // 扫不出合法结构（比如没有闭合斜杠），当普通字符处理
      }

      // 引号字面量：同样只在项开头生效
      if ((ch === '"' || ch === '“') && buf === '') {
        const close = ch === '"' ? '"' : '”';
        const end = s.indexOf(close, i + 1);
        if (end > i) { tokens.push(s.slice(i, end + 1)); i = end + 1; continue; }
      }

      buf += ch;
      i++;
    }
    flush();
    return tokens;
  }

  // 从 start（一个 '/'）开始扫一个正则字面量，返回结束后的下标；扫不出返回 -1。
  // 需要跳过转义符和字符类，否则 /[/]/ 或 /a\/b/ 会在中间被截断。
  function _scanRegexLiteral(s, start) {
    let i = start + 1;
    let inClass = false;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }          // 转义，整对跳过
      if (c === '\n' || c === '\r') return -1;        // 正则不跨行
      if (inClass) { if (c === ']') inClass = false; i++; continue; }
      if (c === '[') { inClass = true; i++; continue; }
      if (c === '/') {
        // 找到闭合斜杠，后面连续的合法标志位一并吃掉
        let j = i + 1;
        while (j < s.length && /[gimsuy]/.test(s[j])) j++;
        // 标志位后必须是分隔符或字符串结束，否则不是一个完整的项
        if (j >= s.length || s[j] === ',' || s[j] === '，' || /\s/.test(s[j])) return j;
        return -1;
      }
      i++;
    }
    return -1;  // 没有闭合斜杠
  }

  // 编译正则字面量。失败返回 { error }，由调用方降级成普通子串。
  function _compile(token) {
    if (_regexCache.has(token)) return _regexCache.get(token);

    let result;
    const end = token.lastIndexOf('/');
    const body = token.slice(1, end);
    let flags = token.slice(end + 1);

    if (!body) {
      result = { error: '正则内容为空' };
    } else if (body.length > MAX_PATTERN_LENGTH) {
      result = { error: `正则过长（${body.length} 字符，上限 ${MAX_PATTERN_LENGTH}）` };
    } else {
      // g/y 会带着 lastIndex 走，缓存复用时下一轮会从上次位置继续匹配而漏命中。
      // 这里只做「有没有命中」的判断，剥掉它们语义不变。
      flags = flags.replace(/[gy]/g, '');
      try {
        result = { regex: new RegExp(body, flags) };
      } catch (e) {
        result = { error: e && e.message ? e.message : String(e) };
      }
    }

    if (_regexCache.size >= MAX_CACHE_SIZE) _regexCache.clear();
    _regexCache.set(token, result);
    return result;
  }

  // 全词匹配：两侧不能紧邻词字符。
  //
  // 【为什么只按 ASCII 词字符判边界】
  // 中文没有词边界，「我养了猫。」里的「猫」是独立词，「猫娘」里的不是，
  // 区分这两者需要分词器，纯字符规则做不到。如果把汉字也当词内字符，
  // 「我养了猫」会因为前面是「了」而判定不命中 —— 精确匹配对中文就彻底失效了。
  // 所以这里与 SillyTavern 等实现取同一口径：
  //   关键词首/尾是 ASCII 字母数字下划线 → 该侧检查边界（cat 不会命中 concatenate）
  //   关键词首/尾是汉字等无边界文字     → 该侧不检查，退化为包含匹配
  // 中文要严格边界请用正则 lookaround，例如 /(?<![\u4e00-\u9fff])猫(?![\u4e00-\u9fff])/
  function _testWholeWord(word, rawText) {
    if (!word) return false;
    const lowerText = rawText.toLowerCase();
    const needle = word.toLowerCase();
    const isWordChar = c => !!c && /[A-Za-z0-9_]/.test(c);
    const headIsWord = isWordChar(needle[0]);
    const tailIsWord = isWordChar(needle[needle.length - 1]);
    if (!headIsWord && !tailIsWord) return lowerText.includes(needle);

    let from = 0;
    for (;;) {
      const idx = lowerText.indexOf(needle, from);
      if (idx < 0) return false;
      const before = idx > 0 ? lowerText[idx - 1] : '';
      const after = lowerText[idx + needle.length] || '';
      const okBefore = !headIsWord || !isWordChar(before);
      const okAfter = !tailIsWord || !isWordChar(after);
      if (okBefore && okAfter) return true;
      from = idx + 1;
    }
  }

  /**
   * 判定一条 keys 是否命中正文。
   * @param {string} keysString 条目的 keys 字段原文
   * @param {string} rawText    扫描用正文（原始大小写）
   * @returns {{hit:boolean, matched:string[], errors:Array<{token:string,error:string}>}}
   */
  function test(keysString, rawText) {
    const out = { hit: false, matched: [], errors: [] };
    const keyStr = String(keysString == null ? '' : keysString).trim();
    const raw = String(rawText == null ? '' : rawText);
    if (!keyStr || !raw) return out;

    const lowerText = raw.toLowerCase();
    // 扫描式分词：正则和引号内部的逗号/空格不当分隔符（见 tokenize 注释）
    const tokens = tokenize(keyStr);

    for (const token of tokens) {
      if (_isRegexLiteral(token)) {
        const compiled = _compile(token);
        if (compiled.error) {
          // 坏正则不能让整条注入链崩，降级成普通子串并上报。
          out.errors.push({ token, error: compiled.error });
          if (lowerText.includes(token.toLowerCase())) {
            out.hit = true;
            out.matched.push(token);
          }
          continue;
        }
        let matchedByRegex = false;
        const started = Date.now();
        try {
          matchedByRegex = compiled.regex.test(raw);
        } catch (e) {
          out.errors.push({ token, error: e && e.message ? e.message : String(e) });
          continue;
        }
        const cost = Date.now() - started;
        if (cost > MATCH_TIMEOUT_MS) {
          // 已经跑完了才知道慢，但要让用户看到——下一轮同样会慢。
          out.errors.push({ token, error: `正则匹配耗时 ${cost}ms，可能存在灾难性回溯，建议简化` });
        }
        if (matchedByRegex) {
          out.hit = true;
          out.matched.push(token);
        }
        continue;
      }

      if (_isQuoted(token)) {
        const word = token.slice(1, -1).trim();
        if (word && _testWholeWord(word, raw)) {
          out.hit = true;
          out.matched.push(token);
        }
        continue;
      }

      // 普通子串：保持历史行为（大小写不敏感、允许单字）
      if (lowerText.includes(token.toLowerCase())) {
        out.hit = true;
        out.matched.push(token);
      }
    }

    return out;
  }

  // 供编辑器做实时校验：返回每一项的类型与错误，不需要正文。
  function validate(keysString) {
    const items = [];
    const keyStr = String(keysString == null ? '' : keysString).trim();
    if (!keyStr) return items;
    for (const token of tokenize(keyStr)) {
      if (_isRegexLiteral(token)) {
        const compiled = _compile(token);
        items.push({ token, type: 'regex', ok: !compiled.error, error: compiled.error || '' });
      } else if (_isQuoted(token)) {
        const word = token.slice(1, -1).trim();
        items.push({ token, type: 'exact', ok: !!word, error: word ? '' : '精确匹配内容为空' });
      } else {
        items.push({ token, type: 'text', ok: true, error: '' });
      }
    }
    return items;
  }

  function tokenType(token) {
    const t = String(token || '').trim();
    if (_isRegexLiteral(t)) return 'regex';
    if (_isQuoted(t)) return 'exact';
    return 'text';
  }

  function _clearCache() { _regexCache.clear(); }

  return { test, validate, tokenize, tokenType, _clearCache, MAX_PATTERN_LENGTH, MATCH_TIMEOUT_MS };
})();

if (typeof window !== 'undefined') window.KeyMatch = KeyMatch;
if (typeof module !== 'undefined' && module.exports) module.exports = KeyMatch;
