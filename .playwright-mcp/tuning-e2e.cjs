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

  const setField = async (labelText, value) => {
    await page.evaluate(({ labelText, value }) => {
      const fields = [...document.querySelectorAll('#tuning-fields .tuning-field')];
      const field = fields.find(f => f.querySelector('label span')?.textContent.trim() === labelText);
      if (!field) throw new Error('campo nao encontrado: ' + labelText);
      const input = field.querySelector('input');
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { labelText, value });
    await page.waitForTimeout(250);
  };

  await setField('Vida do player', 2000);      // 2000 * 5 = 10000 HP
  await setField('Dummies simultâneos', 5);
  await setField('HP do dummy', 500);
  await setField('Dano do dummy (% da vida do player)', 0.1); // 10% = 1000
  await setField('Intervalo entre ataques (s)', 2);
  await setField('Primeiro tick de drenagem', 50);
  await page.waitForTimeout(400);

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
  const state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hudHp: document.querySelector('#hud-hp-text')?.textContent.trim(),
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      dummies: run?.dummies?.length,
      dummyHp: run?.dummies?.[0]?.maxHp,
      dummyDmg: run?.dummies?.[0]?.attackDamage,
      drainFirst: run?.drainFirst,
      attackPeriod: run?.dummyAttackPeriod,
    };
  });
  out.push('estado com overrides: ' + JSON.stringify(state));

  // limpar tudo e confirmar defaults
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  await page.reload();
  await page.waitForTimeout(1500);
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
      dummies: run?.dummies?.length,
      dummyHp: run?.dummies?.[0]?.maxHp,
      dummyDmg: run?.dummies?.[0]?.attackDamage,
    };
  });
  out.push('estado restaurado: ' + JSON.stringify(state2));
  return out.join('\\n');
}
