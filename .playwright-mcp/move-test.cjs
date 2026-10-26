async (page) => {
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return 'NO CANVAS';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // right-click 150px abaixo do centro (mover)
  await page.mouse.click(cx - 100, cy + 150, { button: 'right' });
  await page.waitForTimeout(600);
  // right-click 250px acima (mover de novo)
  await page.mouse.click(cx + 100, cy - 200, { button: 'right' });
  await page.waitForTimeout(600);
  // subir HUD text
  const hud = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    while (out.length < 60) { const n = w.nextNode(); if (!n) break; const t = n.textContent.trim(); if (t) out.push(t); }
    return out.join(' | ');
  });
  return hud;
}
