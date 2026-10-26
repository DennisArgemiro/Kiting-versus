async (page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1800);
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3800); // ~1.4s apos inicio: HP deve estar 3000 (ainda sem ataque)
  const hp1 = await page.evaluate(() => document.querySelector('#hud-hp-text')?.textContent.trim());
  await page.screenshot({ path: '.playwright-mcp/tele-v3-wait.png', scale: 'css', type: 'png' });
  await page.waitForTimeout(3500); // ~5-6s: primeiro ataque
  const hp2 = await page.evaluate(() => document.querySelector('#hud-hp-text')?.textContent.trim());
  await page.screenshot({ path: '.playwright-mcp/tele-v3-first.png', scale: 'css', type: 'png' });
  await page.waitForTimeout(2600); // ~8-9s: segundo ataque (1/s)
  const hp3 = await page.evaluate(() => document.querySelector('#hud-hp-text')?.textContent.trim());
  await page.screenshot({ path: '.playwright-mcp/tele-v3-second.png', scale: 'css', type: 'png' });
  return 't1.4s hp=' + hp1 + ' | t5-6s hp=' + hp2 + ' | t8-9s hp=' + hp3 + ' (era esperado ~2400 no final)';
}
