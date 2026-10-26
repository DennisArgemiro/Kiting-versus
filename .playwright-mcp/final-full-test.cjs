async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // 1. Verificar que não tem botão "Balanciamento" no menu principal
  const btnTuning = await page.locator('#open-tuning').count();
  out.push('botão tuning no menu: ' + btnTuning);

  // 2. Abrir Admin e testar tuning
  await page.locator('#open-admin').click();
  await page.waitForTimeout(500);
  await page.locator('.admin-tab', { hasText: 'Balanciamento' }).click();
  await page.waitForTimeout(500);

  // 3. Alterar um valor no Supervivencia
  await page.locator('.admin-drill-btn', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const fields = [...document.querySelectorAll('#admin-tuning-fields .tuning-field')];
    const field = fields.find(f => f.querySelector('label span')?.textContent.trim() === 'HP do dummy');
    if (field) {
      const input = field.querySelector('input');
      input.value = '500';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);

  // 4. Voltar ao menu e jogar
  await page.locator('#admin-close').click();
  await page.waitForTimeout(500);

  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      dummies: run?.dummies?.length,
      dummyHp: run?.dummies?.[0]?.maxHp,
    };
  });
  out.push('estado no jogo: ' + JSON.stringify(state));

  // 5. Voltar no admin e restaurar
  await page.locator('#open-admin').click();
  await page.waitForTimeout(500);
  await page.locator('.admin-tab', { hasText: 'Balanciamento' }).click();
  await page.waitForTimeout(500);
  await page.locator('.admin-drill-btn', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('#admin-tuning-reset-drill').click();
  await page.waitForTimeout(300);
  out.push('resetado');

  // 6. Verificar se voltou ao padrão
  await page.locator('#admin-close').click();
  await page.waitForTimeout(500);
  const cards2 = page.locator('article');
  const count2 = await cards2.count();
  for (let i = 0; i < count2; i++) {
    if ((await cards2.nth(i).textContent()).includes('Supervivencia')) {
      await cards2.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3000);
  const state2 = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      dummyHp: run?.dummies?.[0]?.maxHp,
    };
  });
  out.push('estado restaurado: ' + JSON.stringify(state2));

  return out.join('\\n');
}