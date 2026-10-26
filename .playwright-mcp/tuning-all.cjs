async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  await page.reload();
  await page.waitForTimeout(1500);

  await page.locator('#open-tuning').click();
  await page.waitForTimeout(400);

  // cada treino: quantos campos/grupos
  const drills = await page.evaluate(() => [...document.querySelectorAll('#tuning-drills .tuning-drill')].map(b => b.querySelector('span').textContent));
  for (const name of drills) {
    await page.locator('#tuning-drills .tuning-drill', { hasText: name }).first().click();
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => ({
      grupos: [...document.querySelectorAll('#tuning-fields .tuning-group h4')].map(e => e.textContent),
      campos: document.querySelectorAll('#tuning-fields .tuning-field').length,
      botoes: document.querySelectorAll('#tuning-fields .tuning-actions button, #tuning-fields .tuning-grid button').length,
    }));
    out.push(name + ': ' + JSON.stringify(info));
  }

  // screenshot da tela com Supervivencia selecionado
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.playwright-mcp/tuning-survival.png', scale: 'css', type: 'png' });

  // screenshot do kiting de separacao (com lista de inimigos)
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Kiting de Separação' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.playwright-mcp/tuning-spacing.png', scale: 'css', type: 'png' });

  return out.join('\\n');
}
