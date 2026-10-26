async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);

  // botao voltar ao menu se estiver no resultado
  await page.locator('button:has-text("Menu")').click().catch(() => {});
  await page.waitForTimeout(1000);

  // limpar localStorage
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(2000);

  // 1) Abrir balanciamento
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(500);
  out.push('tuning aberta: sim');

  // 2) Selecionar Supervivencia
  await page.locator('#tuning-drills .tuning-drill', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(500);

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

  // 3) Aplicar overrides
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

  // 4) Fechar e jogar
  await page.locator('#tuning-close').click();
  await page.waitForTimeout(500);

  const cards = page.locator('article');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    if ((await cards.nth(i).textContent()).includes('Supervivencia')) {
      await cards.nth(i).locator('button').first().click();
      break;
    }
  }
  await page.waitForTimeout(4500);

  // 5) Verificar estado
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
  out.push('estado: ' + JSON.stringify(state));

  // 6) Matar dummy
  const canvas = await page.locator('#game-stage canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.down('a');
  await page.waitForTimeout(40);
  await page.mouse.click(cx, cy + 60, { button: 'right' });
  await page.keyboard.up('a');
  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => {
    const run = window.__trainer.session?.run;
    return { hp: Math.round(run?.player?.hp ?? -1), kills: run?.dummyKills, score: run?.score };
  });
  out.push('apos kill: ' + JSON.stringify(after));

  // 7) Testar zoom
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(50); }
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(50); }
  out.push('zoom ok');

  // 8) Exportar / resetar
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(300);
  await page.locator('#tuning-export').click();
  await page.waitForTimeout(200);
  await page.locator('#tuning-reset-all').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Confirmar"), button:has-text("Sim")').click().catch(() => {});
  await page.waitForTimeout(300);

  const cleared = await page.evaluate(() => localStorage.getItem('kiting-versus.tuning.v1'));
  out.push('reset: ' + (!cleared || cleared === '{}' || cleared === '[]'));

  return out.join('\\n');
}