async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.setItem('kiting-versus.tuning.v1', JSON.stringify({ 'kiting-survival': { '1': { playerStats: { health: 2000 } } } })));
  await page.reload();
  await page.waitForTimeout(1500);
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    hudHp: document.querySelector('#hud-hp-text')?.textContent.trim(),
    playerHp: Math.round(window.__trainer.session?.run?.player?.hp ?? -1),
    maxHp: Math.round(window.__trainer.session?.run?.player?.maxHp ?? -1),
    barWidth: document.querySelector('#hud-hp')?.style.width,
  }));
  out.push(JSON.stringify(info));
  return out.join('\\n');
}
