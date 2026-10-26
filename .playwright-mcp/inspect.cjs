async (page) => {
  const info = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    const out = { canvasCount: canvases.length, canvases: [] };
    canvases.forEach((c) => {
      const r = c.getBoundingClientRect();
      out.canvases.push({ w: r.width, h: r.height, x: r.x, y: r.y, id: c.id, cls: c.className });
    });
    iframes: document.querySelectorAll('iframe').length;
    out.iframes = document.querySelectorAll('iframe').length;
    const anyFixed = document.querySelector('[class*=game], [id*=game], [class*=canvas], [id*=canvas]');
    out.gameEl = anyFixed ? { tag: anyFixed.tagName, id: anyFixed.id, cls: anyFixed.className } : null;
    return out;
  });
  return JSON.stringify(info);
}
