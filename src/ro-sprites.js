/** Animated RO sprites from a ragassets-compatible CDN (APNG or PNG). */

export function spriteUrl(base, params) {
  const q = new URLSearchParams(params);
  return `${base.replace(/\/$/, '')}/image?${q}`;
}

export class RoSprite {
  constructor(url) {
    this.url = url;
    this.img = new Image();
    this.img.crossOrigin = 'anonymous';
    this.ready = new Promise((resolve, reject) => {
      this.img.onload = () => resolve(this);
      this.img.onerror = () => reject(new Error(`sprite: ${url}`));
      this.img.src = url;
    });
  }

  async load() {
    await this.ready;
    return this;
  }

  draw(ctx, x, y, { flip = false, scale = 1, feetY = true } = {}) {
    const w = this.img.naturalWidth * scale;
    const h = this.img.naturalHeight * scale;
    const dx = x - w / 2;
    const dy = feetY ? y - h : y - h / 2;
    ctx.save();
    if (flip) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, -w / 2, dy, w, h);
    } else {
      ctx.drawImage(this.img, dx, dy, w, h);
    }
    ctx.restore();
    return { w, h };
  }
}

export async function loadRoSprites(baseUrl, jobs) {
  const out = {};
  for (const [key, params] of Object.entries(jobs)) {
    try {
      out[key] = await new RoSprite(spriteUrl(baseUrl, params)).load();
    } catch (e) {
      console.warn(e.message);
      out[key] = null;
    }
  }
  return out;
}
