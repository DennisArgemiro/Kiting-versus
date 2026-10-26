async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
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
    const hpText = document.querySelector('#hud-hp-text');
    const timer = document.querySelector('#hud-timer');
    const coach = document.querySelector('#hud-coach');
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const t = [];
    while (t.length < 260) { const n = w.nextNode(); if (!n) break; const v = n.textContent.trim(); if (v) t.push(v); }
    const stat = {};
    for (let i = 0; i < t.length - 1; i++) {
      if (/^(Ordem|Vivos|Dummies|Kills|Tempo|Score)$/.test(t[i])) stat[t[i]] = t[i + 1];
    }
    const coachRect = coach ? coach.getBoundingClientRect().height : -1;
    return { hp: hpText ? hpText.textContent.trim() : null, timer: timer ? timer.textContent.trim() : null, coachH: Math.round(coachRect), ...stat };
  });

  out.push('inicio: ' + JSON.stringify(await readHud()));

  // teste 1: zoom (roda do mouse) - medir camera conf velha vs nova via transform do canvas / compare via screenshot? Checar delta em clientToGround indireto: usar app? Simples: pegar window zoom se exposto; senao verificar visual por screenshot
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(80); }
  await page.screenshot({ path: '.playwright-mcp/survival-zoom-in.png', scale: 'css', type: 'png' });
  out.push('zoom-in ok (screenshot)');
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80); }
  await page.screenshot({ path: '.playwright-mcp/survival-zoom-out.png', scale: 'css', type: 'png' });
  out.push('zoom-out ok (screenshot)');

  // teste 2: coach 1 linha (coachH deve ser constante ~16px)
  out.push('coachH: ' + JSON.stringify(await readHud()));

  // teste 3: telegrafico + ataque dos dummies: esperar ~7s sem mover, dummy ataca aos ~6s
  await page.waitForTimeout(7000);
  s1 = await readHud();
  out.push('t+7s (dummy deve ter atacado): ' + JSON.stringify(s1));
  await page.waitForTimeout(6000);
  out.push('t+13s: ' + JSON.stringify(await readHud()));
  await page.screenshot({ path: '.playwright-mcp/survival-telegraph.png', scale: 'css', type: 'png' });

  return out.join('\\n');
}
