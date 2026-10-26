async (page) => {
  // Sair do treino atual (Esc) e voltar ao menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  // Ver tamanho do game-stage sem treino
  const before = await page.evaluate(() => {
    const s = document.getElementById('game-stage');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    return { w: r.width, h: r.height, display: cs.display, vis: cs.visibility, parentCls: s.parentElement.className, parentW: s.parentElement.getBoundingClientRect().width };
  });
  return JSON.stringify(before);
}
