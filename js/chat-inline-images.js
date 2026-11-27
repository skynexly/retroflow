/* 仅通过本地图片记录的图库 ID 装配阅后即焚的直传内容。 */
(() => {
  const refs = new WeakMap();
  function attach(message, id) {
    if (id) refs.set(message, [...(refs.get(message) || []), id]);
    return message;
  }
  function placeholder(id) { return `[图片 ID：${id}；原图仅当轮直传，后续只保留 ID]`; }
  function idsFrom(message) { return refs.get(message) || []; }
  async function prepare(messages, pending, toUrl) {
    const allowed = new Set(pending);
    return Promise.all(messages.map(async m => {
      if (!allowed.has(m) || m.role !== 'user') return m;
      const ids = idsFrom(m);
      if (!ids.length) return m;
      let text = m.content;
      const parts = [];
      for (const id of ids) {
        text = text.replace(placeholder(id), '');
        try {
          const blob = await window.GalleryStore?.getBlob(id);
          if (blob) parts.push({ type: 'image_url', image_url: { url: await toUrl(blob) } });
          else text += `\n图片 ID ${id}：原图已释放。`;
        } catch (_) { text += `\n图片 ID ${id}：原图暂不可用。`; }
      }
      return { role: m.role, content: [{ type: 'text', text: text.trim() }, ...parts] };
    }));
  }
  function errorText(text) {
    return /(?:image|vision|图片|图像).{0,70}(?:not supported|unsupported|not allowed|不支持)|(?:does not support|unsupported|不支持).{0,70}(?:image|vision|图片|图像)/i.test(text)
      ? `${text}\n当前模型拒绝图片输入，请更换多模态模型，或重新开启预识图后再发图。` : text;
  }
  window.ChatInlineImages = { attach, placeholder, idsFrom, prepare, errorText };
})();