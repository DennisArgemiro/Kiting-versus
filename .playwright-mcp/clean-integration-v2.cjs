async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // limpar localStorage
  await page.evaluate(() => {
    localStorage.clear();
  });
  out.push('localStorage limpo');

  await page.reload();
  await page.waitForTimeout(2000);

  const isMenu = await page.locator('#screen-menu.is-active').count() > 0;
  out.push('esta no menu: ' + isMenu);

  await page.locator('#open-tuning').click();
  await page.waitForTimeout(400);
  out.push('tuning aberta: ' + (await page.locator('#screen-tuning.is-active').count() > 0));

  // selecionar Supervivencia
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(400);

  const groups = await page.evaluate(() => [...document.querySelectorAll('#tuning-fields .tuning-group h4')].map(e => e.textContent));
  out.push('grupos: ' + JSON.stringify(groups));

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

  await setField('Vida do player', 2000);
  await setField('Dummies simultâneos', 5);
  await setField('HP do dummy', 500);
  await setField('Dano do dummy (% da vida do player)', 0.1);
  await setField('Espera antes do 1º ataque (s)', 6);
  await setField('Intervalo entre ataques (s)', 2);
  await setField('Primeiro tick de drenagem', 50);
  await setField('Aumento por tick', 50);
  await setField('HP recuperado por kill', 200);
  await setField('Pontos por kill', 200);
  await page.waitForTimeout(500);

  await page.locator('#tuning-close').click();
  await page.waitForTimeout(400);

  const cards = page.locator('article');
  const count = await cards.count();
  let opened = false;
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      opened = true;
      break;
    }
  }
  if (!opened) return 'DRILL NAO ENCONTRADO';
  out.push('drill aberto');

  await page.waitForTimeout(4000);

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
  out.push('estado no jogo: ' + JSON.stringify(state));

  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('a');
    await page.waitForTimeout(40);
    await page.mouse.click(cx + (i % 2 ? 80 : -80), cy + 40, { button: 'right' });
    await page.keyboard.up('a');
    await page.waitForTimeout(700);
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
  await page.waitForTimeout(300);
  await page.locator('#tuning-export').click();
  await page.waitForTimeout(300);
  out.push('export OK');

  await page.locator('#tuning-reset-all').click();
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('reset: ' + (!cleared || cleared === '{}' || cleared === '[]'));

  return out.join('\\n');
}