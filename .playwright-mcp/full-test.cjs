async (page) => {
  const out = [];
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // abrir Supervivencia nivel 1 (3º artigo da lista de treinos)
  const cards = page.locator('#drill-list article, article');
  const count = await cards.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    if ((await card.textContent()).includes('Supervivencia')) {
      await card.locator('button').first().click();
      clicked = true;
      break;
    }
  }
  if (!clicked) return 'DRILL NAO ENCONTRADO';

  await page.waitForTimeout(3000); // esperar ready terminar

  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  if (!box || box.width === 0) return 'NO CANVAS';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const readHud = async () => await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const t = [];
    while (t.length < 250) { const n = w.nextNode(); if (!n) break; const v = n.textContent.trim(); if (v) t.push(v); }
    const hpTextEl = document.querySelector('#hud-hp-text');
    return { hp: hpTextEl ? hpTextEl.textContent.trim() : null, flags: t.filter(s => /^(Parado|Movendo|Kill|\\+\\d+|-\\d+|\\d+:\\d\\d)$/.test(s)).slice(0, 12).join('|') };
  });

  out.push('inicial: ' + JSON.stringify(await readHud()));

  // testar movimento com right-click
  await page.mouse.click(cx - 150, cy + 120, { button: 'right' });
  await page.waitForTimeout(400);
  out.push('apos mover: ' + JSON.stringify(await readHud()));

  // matar dummy A: pegar dummies, atacar alternado com recuo estimulado
  for (let salvo = 0; salvo < 4; salvo++) {
    // click no dummy mais próximo (left click + attackMove A segurado)
    await page.keyboard.down('a');
    await page.waitForTimeout(40);
    await page.mouse.click(cx - 60 + salvo * 30, cy + 40, { button: 'right' });
    await page.keyboard.up('a');
    await page.waitForTimeout(700); // esperar ataques (2.5 AA/s)
  }
  out.push('apos 4 attack-moves: ' + JSON.stringify(await readHud()));

  return out.join('\\n');
}
