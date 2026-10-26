/** Load a RO .gat slice and build a Kit tileWorld-compatible grid. */
import { tileWorld } from 'kit';

const CELL = 20;

export async function loadGatSlice(baseUrl, mapName, opts = {}) {
  const {
    tileSize = 8,
    cx = 156,
    cy = 192,
    width = 96,
    height = 96,
  } = opts;
  const url = `${baseUrl.replace(/\/$/, '')}/maps/${mapName}/${mapName}.gat`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GAT fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const b = new DataView(buf);
  const sig = String.fromCharCode(b.getUint8(0), b.getUint8(1), b.getUint8(2), b.getUint8(3));
  if (sig !== 'GRAT') throw new Error('Not a GRAT file');
  const mapW = b.getInt32(6, true);
  const mapH = b.getInt32(10, true);
  const x0 = Math.max(0, Math.min(mapW - width, cx - Math.floor(width / 2)));
  const y0 = Math.max(0, Math.min(mapH - height, cy - Math.floor(height / 2)));

  let off = 14;
  const rows = [];
  for (let y = 0; y < mapH; y++) {
    let row = '';
    for (let x = 0; x < mapW; x++) {
      const t = b.getFloat32(off, true);
      off += CELL;
      if (y >= y0 && y < y0 + height && x >= x0 && x < x0 + width) {
        row += t === 0 ? '.' : '#';
      }
    }
    if (y >= y0 && y < y0 + height) rows.push(row);
  }

  const world = tileWorld(rows, { tileSize, solid: '#', outside: { top: true, bottom: true, left: true, right: true } });
  return {
    world,
    rows,
    mapW,
    mapH,
    origin: { x: x0, y: y0 },
    spawn: { tx: cx - x0, ty: cy - y0 },
  };
}
