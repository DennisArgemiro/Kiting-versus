async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1200);

  // 1) Abrir tela de balanceamento, mudar valores, jogar sobrevivencia
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
    await page.waitForTimeout(200);
  };

  await setField('Vida do player', 2000);        // 2000 * 5 = 10000 HP
  await setField('Dummies simultâneos', 5);
  await setField('HP do dummy', 500);
  await setField('Dano do dummy (% da vida do player)', 0.1); // 10% = 1000
  await setField('Espera antes do 1º ataque (s)', 6);
  await setField('Intervalo entre ataques (s)', 2);
  await setField('Primeiro tick de drenagem', 50);
  await setField('Aumento por tick', 50);
  await setField('Teto da drenagem (% da vida máx.)', 0.3);
  await setField('HP recuperado por kill', 200);
  await setField('Pontos por kill', 200);
  await page.waitForTimeout(400);

  await page.locator('#tuning-close').click();
  await page.waitForTimeout(300);

  // 2) Jogar sobrevivencia com overrides
  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(3500);

  // verificar estado inicial
  let state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      dummies: run?.dummies?.length,
      dummyHp: run?.dummies?.[0]?.maxHp,
      dummyDmg: run?.dummies?.[0]?.attackDamage,
    };
  });
  out.push('inicio: ' + JSON.stringify(state));

  // 3) Mover e testar kiting (right-click)
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.click(cx - 150, cy + 120, { button: 'right' });
  await page.waitForTimeout(400);
  await page.mouse.click(cx + 180, cy - 140, { button: 'right' });
  await page.waitForTimeout(400);

  // 4) Attack-move para matar dummies
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('a');
    await page.waitForTimeout(40);
    await page.mouse.click(cx + (i % 2 ? 100 : -100), cy + 40, { button: 'right' });
    await page.keyboard.up('a');
    await page.waitForTimeout(700);
  }

  state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      kills: window.__trainer.session?.run?.dummyKills,
      score: window.__trainer.session?.run?.score,
      dummies: run?.dummies?.length,
    };
  });
  out.push('apos kills: ' + JSON.stringify(state));

  // 5) Esperar drenagem escalonada e ataques
  await page.waitForTimeout(12000);
  state = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      maxHp: Math.round(run?.player?.maxHp ?? -1),
      time: Math.floor(run?.world?.time ?? -1),
      nextDrain: Math.floor(run?.nextDrainTime ?? -1),
    };
  });
  out.push('apos 12s: ' + JSON.stringify(state));

  // 6) Exportar overrides
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(300);
  const exported = await page.evaluate(async () => {
    const json = localStorage.getItem('kiting-versus.tuning.v1');
    return json;
  });
  out.push('export OK: ' + !!exported);

  // 7) Restaurar tudo
  await page.locator('#tuning-reset-all').click();
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('restaurado: ' + cleared);

  return out.join('\\n');
}