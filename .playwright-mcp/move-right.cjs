async (page) => {
  const canvas = await page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return 'NO CANVAS';
  const x = box.x + box.width / 2 + 200;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y, { button: 'right' });
  return 'Right-clicked at ' + Math.round(x) + ',' + Math.round(y) + ' (canvas ' + Math.round(box.width) + 'x' + Math.round(box.height) + ')';
}
