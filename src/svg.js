function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function exportSVG(layout, options = {}) {
  const { width, height } = layout.size;
  const font = layout.params.font;
  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  lines.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${options.background || '#ffffff'}"/>`
  );

  for (const para of layout.paragraphs) {
    lines.push(`<g data-paragraph-id="${escapeXml(para.id)}" data-locked="${para.locked}">`);
    if (para.locked) {
      lines.push(
        `<rect x="${para.frame.x + 1}" y="${para.frame.y + 1}" width="${para.frame.w - 2}" height="${para.frame.h - 2}" fill="none" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6 4" rx="6"/>`
      );
    }
    for (const line of para.lines) {
      for (const item of line.items) {
        const x = para.frame.x + layout.params.padding + item.x;
        const y = para.frame.y + layout.params.padding + item.y;
        lines.push(
          `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="${escapeXml(font.family)}" font-size="${font.sizePx}" fill="#1f2937">${escapeXml(item.token.text)}</text>`
        );
      }
    }
    lines.push('</g>');
  }
  lines.push('</svg>');
  return lines.join('\n');
}
