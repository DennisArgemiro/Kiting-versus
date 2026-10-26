async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // Clear localStorage and sessionStorage via browser context
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
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

  return out.join('\\n');
}