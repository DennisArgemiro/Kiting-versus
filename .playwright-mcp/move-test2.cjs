async (page) => {
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  if (!box || box.width === 0) return 'NO CANVAS';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const steps = [];

  const readHud = async () => await page.evaluate(() => {
    const get = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim() : null; };
    return {
      ordem: get('#hud-order') || null,
      hp: get('#hud-hp-text'),
      timer: get('#hud-timer'),
      score: get('#hud-score'),
      raw: (() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const t = []; while (t.length < 200) { const n = w.nextNode(); if (!n) break; const v = n.textContent.trim(); if (v) t.push(v); } return t.filter(s => /^(Parado|A movimentar|Atacando|Andando|Movendo|Botão|Clique|\\d+:\\d+)/i.test(s)).join('|'); })(),
    };
  });

  steps.push('antes: ' + JSON.stringify(await readHud()));

  // right-click para mover (League style)
  await page.mouse.click(cx - 150, cy + 120, { button: 'right' });
  await page.waitForTimeout(500);
  steps.push('apos 1º right-click: ' + JSON.stringify(await readHud()));

  // segundo move
  await page.mouse.click(cx + 180, cy - 140, { button: 'right' });
  await page.waitForTimeout(500);
  steps.push('apos 2º right-click: ' + JSON.stringify(await readHud()));

  // A+click attack-move
  await page.keyboard.down('a');
  await page.waitForTimeout(50);
  await page.mouse.click(cx, cy + 60, { button: 'right' });
  await page.keyboard.up('a');
  await page.waitForTimeout(500);
  steps.push('apos A+click: ' + JSON.stringify(await readHud()));

  return steps.join('\\n');
}
