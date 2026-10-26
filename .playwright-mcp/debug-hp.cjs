async (page) => {
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
  const info = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    const drill = window.__trainer.byId.get('kiting-survival');
    return {
      runParamsPlayerStats: JSON.stringify(run?.params?.playerStats),
      runPlayerHpScale: run?.playerHpScale,
      playerMaxHp: run?.player?.maxHp,
      playerHp: run?.player?.hp,
      levelParams: JSON.stringify(drill?.levels?.[0]?.params?.playerStats),
      levelHpScale: drill?.levels?.[0]?.params?.playerHpScale,
    };
  });
  return JSON.stringify(info);
}
