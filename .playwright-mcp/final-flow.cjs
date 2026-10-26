async (page) => {
  const out = [];
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1800);

  const cards = page.locator('article');
  const count = await cards.count();
  let opened = false;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    if ((await card.textContent()).includes('Supervivencia')) {
      await card.locator('button').first().click();
      opened = true;
      break;
    }
  }
  if (!opened) return 'DRILL NAO ENCONTRADO';

  await page.waitForTimeout(3200); // passar ready 2.4s

  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  if (!box || box.width === 0) return 'NO CANVAS';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const readHud = async () => await page.evaluate(() => {
    const vals = {};
    document.querySelectorAll('#drill-hud > *, [class*=hud] strong, [class*=stat] strong').forEach(e => {});
    const hpText = document.querySelector('#hud-hp-text');
    const timer = document.querySelector('#hud-timer');
    const score = document.querySelector('#hud-score');
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const t = [];
    while (t.length < 260) { const n = w.nextNode(); if (!n) break; const v = n.textContent.trim(); if (v) t.push(v); }
    const stat = {};
    // pares label next text: Vivos/Kills/Dummies/Tempo/Score/Ordem
    for (let i = 0; i < t.length - 1; i++) {
      if (/^(Ordem|Vivos|Dummies|Kills|Tempo|Score)$/.test(t[i])) stat[t[i]] = t[i + 1];
    }
    return stat;
  });

  const steps = [];
  steps.push('inicio: ' + JSON.stringify(await readHud()));

  // fase 1: mover (valida Ordem = Movendo)
  await page.mouse.click(cx - 160, cy + 110, { button: 'right' });
  await page.waitForTimeout(350);
  steps.push('movendo: ' + JSON.stringify(await readHud()));

  // fase 2: 12 salvas de attack-move (girando ao redor para varrer dummies)
  const dir = [[0,150],[110,110],[-110,110],[160,0],[160,60],[-160,30],[0,180],[90,170],[-90,170],[160,120],[60,190],[170,180]];
  for (let i = 0; i < dir.length; i++) {
    await page.keyboard.down('a');
    await page.waitForTimeout(30);
    await page.mouse.click(cx + dir[i][0], cy + dir[i][1], { button: 'right' });
    await page.keyboard.up('a');
    await page.waitForTimeout(480);
  }
  steps.push('apos salvas: ' + JSON.stringify(await readHud()));

  return steps.join('\\n');
}
