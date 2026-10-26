async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1200);

  await page.evaluate(() => localStorage.setItem('kiting-versus.tuning.v1', JSON.stringify({
    'kiting-survival': {
      '1': { playerStats: { health: 2000 }, dummyCount: 5, dummyHp: 500, dummyAttackDamagePct: 0.1, dummyAttackWait: 6, dummyAttackPeriod: 2, drainFirst: 50, drainStep: 50, drainCapPct: 0.3, dummyRewardHp: 200, dummyRewardScore: 200 }
    }
  })));
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
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      dummies: run?.dummies?.length,
      dummyHp: run?.dummies?.[0]?.maxHp,
      dummyDmg: run?.dummies?.[0]?.attackDamage,
      drainFirst: run?.drainFirst,
      drainStep: run?.drainStep,
      attackWait: run?.dummyAttackWait,
      attackPeriod: run?.dummyAttackPeriod,
    };
  });
  out.push('config aplicada: ' + JSON.stringify(state));

  // matar 2 dummies via attack-move
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('a');
    await page.waitForTimeout(40);
    await page.mouse.click(cx + (i % 2 ? 80 : -80), cy + 40, { button: 'right' });
    await page.keyboard.up('a');
    await page.waitForTimeout(600);
  }

  const after = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      kills: run?.dummyKills,
      score: run?.score,
    };
  });
  out.push('apos 3 salvas: ' + JSON.stringify(after));

  // exportar
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(200);
  await page.locator('#tuning-export').click();
  await page.waitForTimeout(200);
  const hasJson = await page.evaluate(() => navigator.clipboard.readText().then(t => t.includes('kiting-survival')).catch(() => false));
  out.push('export clipboard: ' + hasJson);

  await page.locator('#tuning-reset-all').click();
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('reset: ' + (!cleared || cleared === '{}' || cleared === '[]'));

  return out.join('\\n');
}