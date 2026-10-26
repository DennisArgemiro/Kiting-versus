async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  // Set admin password to "admin" in localStorage
  await page.evaluate(() => {
    localStorage.setItem('kitingVersus-web.admin-password', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
  });
  
  // Check what's stored
  const stored = await page.evaluate(() => localStorage.getItem('kitingVersus-web.admin-password'));
  out.push('stored: ' + stored);

  // Hash "admin" and compare
  const hash = await page.evaluate(async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode('admin');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  });
  out.push('computed hash: ' + hash);
  out.push('match: ' + (hash === '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'));

  // Clicar no botão Admin
  await page.locator('#open-admin').click();
  await page.waitForTimeout(500);

  // Check stored hash again after click
  const stored2 = await page.evaluate(() => localStorage.getItem('kitingVersus-web.admin-password'));
  out.push('stored after click: ' + stored2);

  // Fazer login
  await page.fill('#admin-password', 'admin');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Verificar se está na tela de admin
  const isAdmin = await page.locator('#screen-admin.is-active').count() > 0;
  out.push('admin screen: ' + isAdmin);

  return out.join('\\n');
}