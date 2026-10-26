// collide.js — AABB vs tile map (and vs AABB lists) with swept, per-axis
// resolution. Pure logic: no DOM.
//
// A body is { x, y, w, h }: x, y is the TOP-LEFT corner, screen axes (+y down).
// A world is what the game owns:
//   { tileSize, solidAt(tx, ty) -> bool, oneWayAt?(tx, ty) -> bool, boxes?: [{x,y,w,h,oneWay?}] }
// tileWorld(rows) builds one from strings ('#' solid, '=' one-way, anything else empty).
//
// The sweep checks every tile column (or row) the leading edge crosses this
// step, so no speed tunnels through a 1-tile wall. Bounds are exclusive on
// the far side, so a body resting exactly on a floor never snags on the seam
// between two floor tiles. One-way platforms only stop a body moving DOWN
// whose feet start at or above the platform's top.
// Slopes are not supported (use AABB boxes or steps).

const E = 1e-6;        // in tile units
const EB = 1e-7;       // in world units, for boxes

/**
 * A tile world from rows of text.
 * @param {string[]} rows
 * @param {object} [o]
 * @param {number} [o.tileSize=16]
 * @param {string} [o.solid='#']    characters that are solid
 * @param {string} [o.oneWay='=']   characters that are one-way platforms
 * @param {{left?:boolean,right?:boolean,top?:boolean,bottom?:boolean}} [o.outside]
 *   which sides beyond the map count as solid (default: left and right walls, open top and bottom)
 */
export function tileWorld(rows, { tileSize = 16, solid = '#', oneWay = '=', outside = {} } = {}) {
  const grid = rows.map((r) => String(r).split(''));
  const out = { left: true, right: true, top: false, bottom: false, ...outside };
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const nrows = grid.length;
  const tileAt = (tx, ty) => (ty >= 0 && ty < nrows && tx >= 0 && tx < cols ? grid[ty][tx] ?? ' ' : null);
  const outsideSolid = (tx, ty) => (tx < 0 && out.left) || (tx >= cols && out.right) || (ty < 0 && out.top) || (ty >= nrows && out.bottom);
  return {
    tileSize, cols, rows: nrows, width: cols * tileSize, height: nrows * tileSize,
    tileAt,
    solidAt(tx, ty) { const c = tileAt(tx, ty); return c === null ? outsideSolid(tx, ty) : solid.includes(c); },
    oneWayAt(tx, ty) { const c = tileAt(tx, ty); return c !== null && oneWay.includes(c); },
    set(tx, ty, ch) { if (tileAt(tx, ty) !== null) grid[ty][tx] = ch; },
    /** every tile with this character: [{tx, ty, x, y}] (spawn markers, coins...) */
    find(ch) {
      const r = [];
      for (let ty = 0; ty < nrows; ty++) for (let tx = 0; tx < cols; tx++) if (grid[ty][tx] === ch) r.push({ tx, ty, x: tx * tileSize, y: ty * tileSize });
      return r;
    },
  };
}

const rowSpan = (b, T) => [Math.floor(b.y / T + E), Math.ceil((b.y + b.h) / T - E) - 1];
const colSpan = (b, T) => [Math.floor(b.x / T + E), Math.ceil((b.x + b.w) / T - E) - 1];
const hasTiles = (w) => w && w.tileSize > 0 && typeof w.solidAt === 'function';

/**
 * Sweep a body along x. Mutates b.x. Returns { moved, hit, side: -1|0|1 }.
 */
export function sweepX(b, dx, world) {
  if (!Number.isFinite(dx) || dx === 0) return { moved: 0, hit: false, side: 0 };
  let allowed = dx, hit = false;
  if (hasTiles(world)) {
    const T = world.tileSize;
    const [r0, r1] = rowSpan(b, T);
    if (dx > 0) {
      const edge = b.x + b.w;
      const c0 = Math.ceil(edge / T - E), c1 = Math.ceil((edge + dx) / T) - 1;
      outer: for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) if (world.solidAt(c, r)) { allowed = c * T - edge; hit = true; break outer; }
      }
    } else {
      const edge = b.x;
      const c0 = Math.floor(edge / T + E) - 1, c1 = Math.floor((edge + dx) / T);
      outer: for (let c = c0; c >= c1; c--) {
        for (let r = r0; r <= r1; r++) if (world.solidAt(c, r)) { allowed = (c + 1) * T - edge; hit = true; break outer; }
      }
    }
  }
  for (const o of world?.boxes || []) {
    if (o.oneWay || !(b.y < o.y + o.h - EB && b.y + b.h > o.y + EB)) continue;
    if (dx > 0) {
      const edge = b.x + b.w;
      if (o.x >= edge - EB && o.x < edge + allowed) { allowed = o.x - edge; hit = true; }
    } else {
      const far = o.x + o.w;
      if (far <= b.x + EB && far > b.x + allowed) { allowed = far - b.x; hit = true; }
    }
  }
  if (hit && Math.sign(allowed) !== Math.sign(dx)) allowed = 0; // already touching
  b.x += allowed;
  return { moved: allowed, hit, side: hit ? Math.sign(dx) : 0 };
}

/**
 * Sweep a body along y. Mutates b.y. Returns { moved, hit, side, oneWay }.
 * @param {{dropThrough?:boolean}} [o]  dropThrough: ignore one-way platforms this move
 */
export function sweepY(b, dy, world, { dropThrough = false } = {}) {
  if (!Number.isFinite(dy) || dy === 0) return { moved: 0, hit: false, side: 0, oneWay: false };
  let allowed = dy, hit = false, oneWay = false;
  if (hasTiles(world)) {
    const T = world.tileSize;
    const [c0, c1] = colSpan(b, T);
    const ow = typeof world.oneWayAt === 'function' && !dropThrough;
    if (dy > 0) {
      const edge = b.y + b.h;
      const r0 = Math.ceil(edge / T - E), r1 = Math.ceil((edge + dy) / T) - 1;
      outer: for (let r = r0; r <= r1; r++) {
        let any = false, solid = false;
        for (let c = c0; c <= c1; c++) {
          if (world.solidAt(c, r)) { solid = true; any = true; break; }
          if (ow && world.oneWayAt(c, r)) any = true;
        }
        if (any) { allowed = r * T - edge; hit = true; oneWay = !solid; break outer; }
      }
    } else {
      const edge = b.y;
      const r0 = Math.floor(edge / T + E) - 1, r1 = Math.floor((edge + dy) / T);
      outer: for (let r = r0; r >= r1; r--) {
        for (let c = c0; c <= c1; c++) if (world.solidAt(c, r)) { allowed = (r + 1) * T - edge; hit = true; break outer; }
      }
    }
  }
  for (const o of world?.boxes || []) {
    if (!(b.x < o.x + o.w - EB && b.x + b.w > o.x + EB)) continue;
    if (dy > 0) {
      if (o.oneWay && dropThrough) continue;
      const edge = b.y + b.h;
      if (o.y >= edge - EB && o.y < edge + allowed) { allowed = o.y - edge; hit = true; oneWay = !!o.oneWay; }
    } else {
      if (o.oneWay) continue;
      const far = o.y + o.h;
      if (far <= b.y + EB && far > b.y + allowed) { allowed = far - b.y; hit = true; }
    }
  }
  if (hit && Math.sign(allowed) !== Math.sign(dy)) allowed = 0;
  b.y += allowed;
  return { moved: allowed, hit, side: hit ? Math.sign(dy) : 0, oneWay };
}

/**
 * Move a body by (dx, dy) against the world: x first, then y. Mutates b.
 * @returns {{ dx:number, dy:number, hitX:boolean, hitY:boolean, left:boolean, right:boolean, top:boolean, bottom:boolean, oneWay:boolean }}
 */
export function moveAndCollide(b, dx, dy, world, opts = {}) {
  const rx = sweepX(b, dx, world);
  const ry = sweepY(b, dy, world, opts);
  return {
    dx: rx.moved, dy: ry.moved,
    hitX: rx.hit, hitY: ry.hit,
    left: rx.side < 0, right: rx.side > 0, top: ry.side < 0, bottom: ry.side > 0,
    oneWay: ry.oneWay,
  };
}

/** would moving by (dx, dy) be blocked? (does not move b) */
export function probe(b, dx, dy, world, opts) {
  const c = { x: b.x, y: b.y, w: b.w, h: b.h };
  if (dx) return sweepX(c, dx, world).hit;
  if (dy) return sweepY(c, dy, world, opts).hit;
  return false;
}

/** does the rect overlap any solid tile or box? (one-way platforms do not count) */
export function overlapsWorld(r, world) {
  if (hasTiles(world)) {
    const T = world.tileSize;
    const [c0, c1] = colSpan(r, T), [r0, r1] = rowSpan(r, T);
    for (let ty = r0; ty <= r1; ty++) for (let tx = c0; tx <= c1; tx++) if (world.solidAt(tx, ty)) return true;
  }
  for (const o of world?.boxes || []) if (!o.oneWay && overlap(r, o)) return true;
  return false;
}

/**
 * Corner correction: the body was blocked moving along `axis` ('x' or 'y') in
 * direction dir; if sliding it sideways by up to maxPx clears the corner,
 * shift it and return the shift (0 when nothing helps).
 */
export function cornerSlip(b, axis, dir, world, maxPx = 4) {
  if (!dir || maxPx <= 0) return 0;
  for (let off = 1; off <= maxPx; off++) {
    for (const s of [-1, 1]) {
      const c = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (axis === 'x') c.y += s * off; else c.x += s * off;
      if (overlapsWorld(c, world)) continue;
      const ahead = { ...c };
      if (axis === 'x') ahead.x += dir; else ahead.y += dir;
      if (overlapsWorld(ahead, world)) continue;
      if (axis === 'x') b.y = c.y; else b.x = c.x;
      return s * off;
    }
  }
  return 0;
}

// ------------------------------------------------------------ AABB helpers

/** strict overlap of two rects {x,y,w,h} (touching edges do not overlap) */
export function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** the overlapping rect, or null */
export function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

/** the smallest push {x, y} that moves `a` out of `b` (zero vector when apart) */
export function separate(a, b) {
  const i = intersect(a, b);
  if (!i) return { x: 0, y: 0 };
  if (i.w < i.h) return { x: a.x + a.w / 2 < b.x + b.w / 2 ? -i.w : i.w, y: 0 };
  return { x: 0, y: a.y + a.h / 2 < b.y + b.h / 2 ? -i.h : i.h };
}

export const containsPoint = (r, px, py) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

/**
 * Swept AABB: moving rect `a` by (vx, vy) against a static rect `b`.
 * @returns {{t:number, nx:number, ny:number} | null}  t in [0,1] at first contact, normal of b's face
 */
export function sweepAabb(a, vx, vy, b) {
  if (overlap(a, b)) return { t: 0, nx: 0, ny: 0 };
  const inv = (v) => (v === 0 ? Infinity : 1 / v);
  const ex = vx > 0 ? [b.x - (a.x + a.w), b.x + b.w - a.x] : [b.x + b.w - a.x, b.x - (a.x + a.w)];
  const ey = vy > 0 ? [b.y - (a.y + a.h), b.y + b.h - a.y] : [b.y + b.h - a.y, b.y - (a.y + a.h)];
  let tx0, tx1, ty0, ty1;
  if (vx === 0) {
    if (a.x + a.w <= b.x || a.x >= b.x + b.w) return null;
    tx0 = -Infinity; tx1 = Infinity;
  } else { tx0 = ex[0] * inv(vx); tx1 = ex[1] * inv(vx); }
  if (vy === 0) {
    if (a.y + a.h <= b.y || a.y >= b.y + b.h) return null;
    ty0 = -Infinity; ty1 = Infinity;
  } else { ty0 = ey[0] * inv(vy); ty1 = ey[1] * inv(vy); }
  const t0 = Math.max(tx0, ty0), t1 = Math.min(tx1, ty1);
  if (t0 > t1 || t0 < 0 || t0 > 1) return null;
  return tx0 > ty0 ? { t: t0, nx: -Math.sign(vx), ny: 0 } : { t: t0, nx: 0, ny: -Math.sign(vy) };
}

/** every box in a list that overlaps rect r */
export function boxesAt(list, r) { return (list || []).filter((o) => overlap(r, o)); }
