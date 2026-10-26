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
  await page.waitForTimeout(3200); // ready + ~1s apos inicio (progress ~0.2, verde)
  await page.screenshot({ path: '.playwright-mcp/tele-green.png', scale: 'css', type: 'png' });
  await page.waitForTimeout(3600); // ~4.6s (progress ~0.77, vermelho/amber)
  await page.screenshot({ path: '.playwright-mcp/tele-red.png', scale: 'css', type: 'png' });
  await page.waitForTimeout(1500); // pos-ataque (~6.2s)
  await page.screenshot({ path: '.playwright-mcp/tele-after.png', scale: 'css', type: 'png' });
  const hp = await page.evaluate(() => document.querySelector('#hud-hp-text')?.textContent.trim());
  return 'hp: ' + hp;
}
