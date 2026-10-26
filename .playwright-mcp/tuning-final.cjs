async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  await page.reload();
  await page.waitForTimeout(1500);

  await page.locator('#open-tuning').click();
  await page.waitForTimeout(300);
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);

  // labels dos campos de player devem mostrar "padrao"
  const playerFields = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('#tuning-fields .tuning-field')];
    const wanted = ['Vida do player', 'Dano de ataque', 'Alcance de ataque'];
    return fields.filter(f => wanted.includes(f.querySelector('label span')?.textContent.trim()))
      .map(f => f.querySelector('label span').textContent.trim() + '=' + f.querySelector('label b').textContent.trim()
        + ' (input="' + (f.querySelector('input')?.value ?? '') + '")');
  });
  out.push('player fields: ' + JSON.stringify(playerFields));

  // editar vida do player para 2000 e verificar aplicação
  await page.evaluate(() => {
    const fields = [...document.querySelectorAll('#tuning-fields .tuning-field')];
    const field = fields.find(f => f.querySelector('label span')?.textContent.trim() === 'Vida do player');
    const input = field.querySelector('input');
    input.value = '2000';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const params = await page.evaluate(() => JSON.stringify(window.__trainer.byId.get('kiting-survival').levels[0].params.playerStats));
  out.push('playerStats aplicado: ' + params);

  // abrir o treino e conferir HP = 2000 * 5 = 10000
  await page.locator('#tuning-close').click();
  await page.waitForTimeout(200);
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(2000);
  const hp = await page.evaluate(() => document.querySelector('#hud-hp-text')?.textContent.trim());
  out.push('HP no treino (esperado 10000): ' + hp);

  // limpar overrides e confirmar padrao restaurado
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  out.push('limpo');
  return out.join('\\n');
}
