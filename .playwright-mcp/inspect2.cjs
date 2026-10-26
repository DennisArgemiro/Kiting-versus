async (page) => {
  const info = await page.evaluate(() => {
    const stage = document.getElementById('game-stage');
    if (!stage) return { stage: null };
    const r = stage.getBoundingClientRect();
    const children = [];
    stage.querySelectorAll('*').forEach((el) => {
      if (children.length > 15) return;
      const cr = el.getBoundingClientRect();
      children.push({ tag: el.tagName, id: el.id, cls: String(el.className).substring(0, 40), w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), children };
  });
  return JSON.stringify(info);
}
