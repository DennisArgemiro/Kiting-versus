async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // limpar overrides anteriores
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  await page.reload();
  await page.waitForTimeout(1500);

  // abrir tela de balanceamento
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(300);
  out.push('tuning aberta: ' + (await page.locator('#screen-tuning.is-active').count() > 0));

  // selecionar Supervivencia
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
  await page.waitForTimeout(400);

  // fechar tuning e jogar
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

  // matar 1 dummy
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.down('a');
  await page.waitForTimeout(40);
  await page.mouse.click(cx, cy + 60, { button: 'right' });
  await page.keyboard.up('a');
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return {
      hp: Math.round(run?.player?.hp ?? -1),
      kills: run?.dummyKills,
      score: run?.score,
    };
  });
  out.push('apos 1 kill: ' + JSON.stringify(after));

  // exportar JSON
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(200);
  await page.locator('#tuning-export').click();
  await page.waitForTimeout(200);
  out.push('export clicado');

  // resetar tudo
  await page.locator('#tuning-reset-all').click();
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('reset: ' + (!cleared || cleared === '{}' || cleared === '[]'));

  return out.join('\\n');
}