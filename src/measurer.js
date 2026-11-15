function fontString(font) {
  return `${font.style || 'normal'} ${font.weight || 'normal'} ${font.sizePx}px ${font.family}`;
}

export class CanvasMeasurer {
  constructor() {
    const canvas = document.createElement('canvas');
    this.ctx = canvas.getContext('2d');
  }

  width(token, font) {
    this.ctx.font = fontString(font);
    const w = this.ctx.measureText(token.text).width;
    if (token.cjk) return w + (font.cjkTracking || 0);
    return w;
  }

  spaceWidth(font) {
    this.ctx.font = fontString(font);
    return this.ctx.measureText(' ').width;
  }
}

export class HeadlessMeasurer {
  width(token, font) {
    const size = font.sizePx;
    let width;
    if (token.cjk) {
      width = token.text === '\u3000' ? size : size * (token.type === 'punct' ? 0.5 : 1);
      width += font.cjkTracking || 0;
    } else if (token.type === 'space') {
      width = size * 0.35;
    } else {
      width = token.text.length * size * 0.55;
    }
    return width;
  }

  spaceWidth(font) {
    return font.sizePx * 0.35;
  }
}
