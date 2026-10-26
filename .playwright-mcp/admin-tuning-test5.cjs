async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // Set admin password to "admin" in localStorage (SHA256 of "admin")
  await page.evaluate(() => {
    localStorage.setItem('kitingVersus-web.admin-password', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
  });
  out.push('password set');

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

  return out.join('\\n');
}