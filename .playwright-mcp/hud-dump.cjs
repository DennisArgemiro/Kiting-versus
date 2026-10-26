async (page) => {
  const state = await page.evaluate(() => {
    const els = document.querySelectorAll('strong, [class*=hud], [class*=stat]');
    const hpBar = document.querySelector('[aria-label="Sua vida"], [title="Sua vida"]');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (texts.length < 40) {
      const n = walker.nextNode();
      if (!n) break;
      const t = n.textContent.trim();
      if (t) texts.push(t);
    }
    return texts.join(' | ');
  });
  return state;
}
