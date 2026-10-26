async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1800);

  // abrir a tela
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(400);
  out.push('screen ativa: ' + await page.evaluate(() => document.querySelector('#screen-tuning')?.classList.contains('is-active')));
  out.push('treinos listados: ' + await page.evaluate(() => document.querySelectorAll('#tuning-drills .tuning-drill').length));
  out.push('campos (1o treino): ' + await page.evaluate(() => document.querySelectorAll('#tuning-fields .tuning-field').length));

  // selecionar Supervivencia
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);
  const groups = await page.evaluate(() => [...document.querySelectorAll('#tuning-fields .tuning-group h4')].map(e => e.textContent));
  out.push('grupos: ' + JSON.stringify(groups));

  // alterar dummyHp para 500 e dummyCount para 5
  const setField = async (labelText, value) => {
    await page.evaluate(({ labelText, value }) => {
      const fields = [...document.querySelectorAll('#tuning-fields .tuning-field')];
      const field = fields.find(f => f.querySelector('label span')?.textContent.trim() === labelText);
      if (!field) throw new Error('campo nao encontrado: ' + labelText);
      const input = field.querySelector('input');
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { labelText, value });
    await page.waitForTimeout(200);
  };
  await setField('HP do dummy', 500);
  await setField('Dummies simultâneos', 5);
  await setField('Intervalo entre ataques (s)', 2);
  await page.waitForTimeout(400);

  const stored = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('localStorage: ' + stored);

  const applied = await page.evaluate(() => {
    const d = window.__trainer.byId.get('kiting-survival');
    return JSON.stringify(d.levels[0].params);
  });
  out.push('params aplicados: ' + applied);

  // voltar ao menu e jogar sobrevivencia com os novos valores
  await page.locator('#tuning-close').click();
  await page.waitForTimeout(300);
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3500);
  const hud = await page.evaluate(() => {
    const t = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (t.length < 260) { const n = w.nextNode(); if (!n) break; const v = n.textContent.trim(); if (v) t.push(v); }
    const stat = {};
    for (let i = 0; i < t.length - 1; i++) if (/^(Vivos|Dummies|Kills|Tempo|Score)$/.test(t[i])) stat[t[i]] = t[i + 1];
    return stat;
  });
  out.push('HUD com overrides: ' + JSON.stringify(hud));
  await page.screenshot({ path: '.playwright-mcp/tuning-screen.png', scale: 'css', type: 'png' });

  return out.join('\\n');
}
