async (page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    const drill = window.__trainer.byId.get('kiting-survival');
    return {
      runDummyCount: run?.dummyCount,
      dummiesAlive: run?.dummies?.length,
      levelParams: drill?.levels?.[0]?.params?.dummyCount,
      stored: localStorage.getItem('kiting-versus.tuning.v1'),
    };
  });
  return JSON.stringify(info);
}
