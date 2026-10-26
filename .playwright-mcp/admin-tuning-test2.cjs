async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // Clicar no botão Admin
  await page.locator('#open-admin').click();
  await page.waitForTimeout(500);

  // Verificar se está na tela de login
  const isLogin = await page.locator('#screen-admin-login.is-active').count() > 0;
  out.push('login screen: ' + isLogin);

  // Fazer login (senha padrão é "admin")
  await page.fill('#admin-password', 'admin');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Verificar se está na tela de admin
  const isAdmin = await page.locator('#screen-admin.is-active').count() > 0;
  out.push('admin screen: ' + isAdmin);

  // Listar abas disponíveis
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.admin-tab')].map(t => t.textContent.trim()));
  out.push('abas: ' + JSON.stringify(tabs));

  // Clicar na aba Balanciamento
  await page.locator('.admin-tab', { hasText: 'Balanciamento' }).click();
  await page.waitForTimeout(500);

  // Verificar se o painel de balanciamento carregou
  const hasTuning = await page.locator('#admin-tuning-drills').count() > 0;
  out.push('tuning panel: ' + hasTuning);

  // Listar treinos disponíveis
  const drills = await page.evaluate(() => [...document.querySelectorAll('#admin-tuning-drills .admin-drill-btn')].map(b => b.querySelector('span').textContent));
  out.push('treinos: ' + JSON.stringify(drills));

  // Selecionar Supervivencia
  await page.locator('.admin-drill-btn', { hasText: 'Supervivencia' }).first().click();
  await page.waitForTimeout(300);

  const groups = await page.evaluate(() => [...document.querySelectorAll('#admin-tuning-fields .tuning-group h4')].map(e => e.textContent));
  out.push('grupos: ' + JSON.stringify(groups));

  return out.join('\\n');
}