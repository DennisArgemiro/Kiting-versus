async (page) => {
  const out = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1200);

  // limpar tudo
  await page.evaluate(() => localStorage.removeItem('kiting-versus.tuning.v1'));
  out.push('localStorage limpo');
  await page.reload();
  await page.waitForTimeout(1500);

  // verificar se está no menu
  const isMenu = await page.locator('#screen-menu.is-active').count() > 0;
  out.push('esta no menu: ' + isMenu);
  const btn = await page.locator('#open-tuning').count();
  out.push('botao tuning: ' + btn);

  // abrir tuning
  await page.locator('#open-tuning').click();
  await page.waitForTimeout(300);
  out.push('tuning aberta: ' + (await page.locator('#screen-tuning.is-active').count() > 0));

  return out.join('\\n');
}