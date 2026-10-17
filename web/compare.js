/* AutoFab · Compare: the same order built by two factory versions, side by side.
   The plain-English maps, gate drawing, flatten/simulate, 3D replay and benches are copied from web/home.js.
   Every number shown comes from run.json (plus menu.json / library.json / snapshots for names and counts). */
import * as THREE from 'three';

/* ───────── helpers ───────── */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const verNum = v => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
const params = new URLSearchParams(location.search);
const icon = (name, cls) => `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`;
const icons = () => { try { window.lucide?.createIcons(); } catch (e) { /* icons are decoration */ } };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const S = { data: null, lastText: '', apiMode: null, extra: null, lib: null, menu: null, snaps: {}, showBad: true, link: true, mode: 'past', orderId: null, own: null, vA: null, vB: null };

/* ───────── plain words ───────── */
function chipName(title) {
  const t = String(title || '');
  if (/^calculator/i.test(t)) return ['Calculator', 'calculator'];
  if (/^(door lock|lock)\b/i.test(t)) return ['Door lock', 'lock'];
  if (/counter/i.test(t)) return ['Counter', 'timer'];
  if (/^traffic light/i.test(t)) return ['Traffic light', 'traffic-cone'];
  if (/^comparator/i.test(t)) return ['Which is bigger', 'scale'];
  if (/gray-code|blinker/i.test(t)) return ['Blinker', 'lightbulb'];
  if (/^digit display/i.test(t)) return ['Digit display', 'hash'];
  if (/parity|majority/i.test(t)) return ['Vote counter', 'vote'];
  return [cap(t.split(/\s+/).slice(0, 2).join(' ')) || 'Chip', 'cpu'];
}
function chipDesc(title) {
  let t = String(title || '');
  if (/whether a is bigger than b/i.test(t)) return 'Tells you which of two numbers is bigger';
  let m;
  if ((m = /^(odd|even)-parity detector for (\d+) bits/i.exec(t))) return `Lights up when an ${m[1].toLowerCase()} number of its ${m[2]} switches are on`.replace('an even', 'an even');
  if ((m = /^digit display segment (\w) for digits (\d+) to (\d+)/i.exec(t))) return `Lights one bar of a number display, for ${m[2]} to ${m[3]}`;
  t = t.replace(/^.*?counter that\s+/i, '').replace(/^(calculator|door lock|lock|comparator|traffic light)\s+(that\s+)?/i, '');
  t = t.replace(/^with\s+/i, '').replace(/\s*\(\d+-bit\)/g, '').replace(/\b\d+-bit\s+/g, '');
  t = t.replace(/,?\s*built from only NAND chips, at most (\d+)/i, ', using at most $1 simple gates');
  t = t.replace(/plus a carry-in/i, 'plus one extra');
  t = t.replace(/→/g, 'to');
  return cap(t);
}
const GATE_WORD = { AND: 'both', OR: 'either', XOR: 'one not both', NOT: 'flip', NAND: 'not both', NOR: 'neither', XNOR: 'same', DFF: 'memory' };
const PART_WORD = { full_adder: 'Adder', half_adder: 'Adder', fa_lsb: 'Adder', fa_msb: 'Adder', bit_gt: 'Bigger?', bit_eq: 'Same?', comp_2bit: 'Compare' };
function partLabel(part) {
  const p = String(part || '');
  if (PART_WORD[p]) return PART_WORD[p];
  if (/adder|^fa(_|\d|$)|^full_?a|^half_?a/i.test(p)) return 'Adder';
  if (/compar/i.test(p)) return 'Compare';
  if (/dff|flip_?flop|^state/i.test(p)) return 'Memory';
  const ws = p.split(/[_\s]+/).filter(x => x && /^[a-z]/i.test(x)).map(x => x.toLowerCase());
  const w = ws.slice(0, 2).join(' ');
  return cap(w.length > 14 ? ws[0] : w) || 'Block';
}
const ROLE = { architect: 'Planner', designer: 'Block designer', assembler: 'Wirer', investigator: 'Investigator' };
const LESSON_PLAIN = {
  format: 'Write the plan in the exact form the checker expects',
  spiral: 'Stop thinking in circles: answer within the budget',
  assembly: 'Check every wire goes to the right pin before handing it in',
  rules: 'Never feed more than four blocks from one wire',
  wrong_logic: 'Test the block against all answers before reusing it',
  budget: 'Use fewer gates: tidy before handing in',
};
const PROPOSAL_PLAIN = {
  schema_on: 'a strict answer form', route_novel_to_super: 'sending hard parts to the bigger model', loop_cutter: 'cutting off thinking loops',
  library_first: 'reusing tested blocks first', fanout_buffer_rule: 'a rule about overloaded wires', tidy_tool: 'a tidy-up tool',
  stable_prefix: 'a cheaper prompt layout', schema_and_route: 'the strict form plus the bigger model together', no_fast_lane: 'no shortcuts for easy orders',
  super_everywhere: 'the bigger model for everything', fast_lane_easy: 'shortcuts for easy orders',
};
function plainNote(note) {
  let s = String(note || '').split(';')[0].trim();
  s = s.replace(/\bfa(\d+)\.cout\b/g, (m, n) => `adder ${+n + 1}'s carry`).replace(/\bfa(\d+)\.\w+\b/g, (m, n) => `adder ${+n + 1}`).replace(/\bfa(\d+)\b/g, (m, n) => `adder ${+n + 1}`);
  s = s.replace(/\b([ab])(\d)\b/g, (m, w, n) => `the ${w === 'a' ? 'first' : 'second'} number's ${2 ** +n}s switch`);
  s = s.replace(/\b\d+k tokens\b/g, 'the thinking budget').replace(/\binputs?\b/g, 'answers');
  return s;
}

/* ═════════ gate drawing (Schematic copied from fab.js, restyled: plain words, lamps, no ids) ═════════ */
const OUT_PORT = /^(sum|s|cout|co|carry|carry_?out|y|q|qn|out|o|z|eq|gt|lt|diff|bout|borrow|result)\d*$/i;
const NODE_SZ = { in: [64, 24], out: [64, 24], gate: [60, 54], ff: [72, 56] };
const curveX = (x0, y) => { const t = y / 40; return x0 + 28 * t * (1 - t); };
const GATE = {
  AND:  { body: 'M8,0 H30 A20,20 0 0 1 30,40 H8 Z', inX: () => 8, outX: 50 },
  NAND: { body: 'M8,0 H28 A20,20 0 0 1 28,40 H8 Z', bubble: 52, inX: () => 8, outX: 56 },
  OR:   { body: 'M6,0 Q20,20 6,40 Q34,40 52,20 Q34,0 6,0 Z', inX: y => curveX(6, y), outX: 52 },
  XOR:  { body: 'M12,0 Q26,20 12,40 Q40,40 56,20 Q40,0 12,0 Z', arc: 'M5,0 Q19,20 5,40', inX: y => curveX(5, y), outX: 56 },
  NOT:  { body: 'M8,4 L44,20 L8,36 Z', bubble: 48, inX: () => 8, outX: 52 },
};
const NSS = { 'vector-effect': 'non-scaling-stroke' };
function placeCol(items, gapOf) {
  let off = 0; const blocks = [];
  items.forEach((it, i) => {
    if (i) off += items[i - 1].h + gapOf(items[i - 1], it);
    it.off = off; blocks.push({ s: (it.want - off) * it.wt, w: it.wt, n: 1 });
    while (blocks.length > 1) { const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.s / a.w <= b.s / b.w) break; a.s += b.s; a.w += b.w; a.n += b.n; blocks.pop(); }
  });
  let i = 0; blocks.forEach(b => { const m = b.s / b.w; for (let k = 0; k < b.n; k++, i++) items[i].y = m + items[i].off; });
}
function simplify(pts) {
  const a = [];
  pts.forEach(p => { const l = a[a.length - 1]; if (!l || Math.abs(l[0] - p[0]) > .01 || Math.abs(l[1] - p[1]) > .01) a.push(p); });
  return a.filter((p, i) => { if (i === 0 || i === a.length - 1) return true; const q = a[i - 1], r = a[i + 1];
    return !((Math.abs(q[0] - p[0]) < .01 && Math.abs(p[0] - r[0]) < .01) || (Math.abs(q[1] - p[1]) < .01 && Math.abs(p[1] - r[1]) < .01)); });
}
const txt = (g, x, y, s, cls, anchor) => { const t = sv('text', { x: x.toFixed(1), y: y.toFixed(1), class: cls, 'text-anchor': anchor || 'start' }, g); t.textContent = s; return t; };
const lead = (g, x0, y, x1, cls) => sv('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'lead' + (cls ? ' ' + cls : ''), ...NSS }, g);

class Schematic {
  constructor(run, names) { this.run = run; this.bp = run.blueprint || {}; this.names = names || {}; this.build(); this.layout(); }
  build() {
    const bp = this.bp, nodes = this.nodes = new Map(), drivers = this.drivers = new Map();
    const add = n => { n.ins = n.ins || []; n.outs = n.outs || []; n.ins.forEach(p => { p.node = n; }); n.outs.forEach(p => { p.node = n; }); nodes.set(n.id, n); return n; };
    (bp.inputs || this.run.order?.inputs || []).forEach((s, i) => {
      const n = add({ id: 'in:' + s, kind: 'in', label: String(s), idx: i, outs: [{ key: 'in:' + s, sig: s, name: s }] }); drivers.set(s, n.outs[0]); });
    (bp.flipflops || []).forEach(f => {
      const n = add({ id: f.name, kind: 'ff', label: String(f.name), ins: [{ key: f.name + '.d', sig: f.d, name: 'd' }], outs: [{ key: f.name + '.q', sig: f.name, name: 'q' }] });
      drivers.set(f.name, n.outs[0]); });
    (bp.gates || []).forEach(g => {
      const n = add({ id: g.name, kind: 'gate', type: String(g.type || '').toUpperCase(), label: String(g.name),
        ins: (g.inputs || []).map((s, i) => ({ key: `${g.name}.in${i}`, sig: s, name: 'in' + i })),
        outs: g.output != null ? [{ key: `${g.name}.out`, sig: g.output, name: 'out' }] : [] });
      if (g.output != null && !drivers.has(g.output)) drivers.set(g.output, n.outs[0]); });
    const outMap = outMapOf(bp), outSigs = new Set(Object.values(outMap));
    (bp.instances || []).forEach(inst => {
      const ins = [], outs = [];
      Object.entries(inst.wire || {}).forEach(([p, s]) => {
        const isOut = !drivers.has(s) && (OUT_PORT.test(p) || outSigs.has(s));
        (isOut ? outs : ins).push({ key: `${inst.name}.${p}`, sig: s, name: p });
      });
      add({ id: inst.name, kind: 'inst', label: partLabel(inst.part), part: inst.part, ins, outs });
    });
    nodes.forEach(n => { if (n.kind === 'inst') n.outs.forEach(o => { if (!drivers.has(o.sig)) drivers.set(o.sig, o); }); });
    Object.entries(outMap).forEach(([name, s]) => add({ id: 'out:' + name, kind: 'out', label: name, ins: [{ key: 'out:' + name, sig: s, name }] }));
    [...nodes.values()].forEach(n => n.ins.forEach(p => {
      if (p.sig == null || drivers.has(p.sig) || nodes.has('in:' + p.sig)) return;
      const c = add({ id: 'in:' + p.sig, kind: 'in', label: String(p.sig), konst: true, idx: 900, outs: [{ key: 'in:' + p.sig, sig: p.sig, name: p.sig }] });
      drivers.set(p.sig, c.outs[0]); }));
    this.edges = []; this.edgeInto = new Map(); this.badEdges = new Map();
    nodes.forEach(n => n.ins.forEach(p => { const s = drivers.get(p.sig); if (!s) return;
      const e = { id: p.key, src: s, dst: p, bad: false }; this.edges.push(e); this.edgeInto.set(p.key, e); }));
    (this.run.events || []).forEach(ev => {
      if (ev.type !== 'fail') return;
      (ev.bad_wires || []).forEach(w => {
        if (!Array.isArray(w) || w.length < 2) return;
        const id = w[0] + '>' + w[1]; if (this.badEdges.has(id)) return;
        const s = this.resolveSrc(w[0]), d = this.resolveDst(w[1]); if (!s || !d) return;
        const e = { id: 'bad:' + id, src: s, dst: d, bad: true }; this.edges.push(e); this.badEdges.set(id, e);
      });
    });
  }
  resolveSrc(tok) {
    tok = String(tok); const i = tok.indexOf('.');
    if (i > 0) { const n = this.nodes.get(tok.slice(0, i)); if (n && n.kind !== 'in' && n.kind !== 'out') { const p = tok.slice(i + 1); return n.outs.find(o => o.name === p) || n.outs[0] || null; } }
    return this.drivers.get(tok) || null;
  }
  resolveDst(tok) {
    tok = String(tok); const i = tok.indexOf('.');
    if (i > 0) { const n = this.nodes.get(tok.slice(0, i)); if (n && n.kind !== 'in' && n.kind !== 'out') { const p = tok.slice(i + 1);
      return n.ins.find(o => o.name === p) || (n.kind === 'gate' && /^in/.test(p) ? n.ins[0] || null : null); } }
    const o = this.nodes.get('out:' + tok); return o ? o.ins[0] : null;
  }
  layout() {
    const nodes = [...this.nodes.values()], edges = this.edges;
    const depth = new Map();
    const dep = (n, stack) => {
      if (depth.has(n.id)) return depth.get(n.id);
      if (n.kind === 'in' || n.kind === 'ff') { depth.set(n.id, 0); return 0; }
      if (stack.has(n.id)) return 0;
      stack.add(n.id); let d = 1;
      n.ins.forEach(p => { const s = this.drivers.get(p.sig); if (s && s.node !== n) d = Math.max(d, dep(s.node, stack) + 1); });
      stack.delete(n.id); depth.set(n.id, d); return d;
    };
    nodes.forEach(n => { if (n.kind !== 'out') dep(n, new Set()); });
    let maxD = 0; depth.forEach(v => { maxD = Math.max(maxD, v); });
    nodes.forEach(n => { n.col = n.kind === 'out' ? maxD + 1 : depth.get(n.id); });
    const ncol = Math.max(...nodes.map(n => n.col)) + 1;
    nodes.forEach(n => {
      if (n.kind === 'inst') { n.w = 96; n.h = Math.max(n.ins.length, n.outs.length, 2) * 20 + 14; } else [n.w, n.h] = NODE_SZ[n.kind];
      const spread = (arr, x, cy, pitch) => arr.forEach((p, i) => { p.ox = x; p.oy = cy + (i - (arr.length - 1) / 2) * pitch; });
      if (n.kind === 'in') spread(n.outs, n.w, n.h / 2, 0);
      else if (n.kind === 'out') spread(n.ins, 0, n.h / 2, 0);
      else if (n.kind === 'gate') { spread(n.ins, 0, 20, n.ins.length > 2 ? 32 / (n.ins.length - 1) : 20); spread(n.outs, n.w, 20, 0); }
      else if (n.kind === 'ff') { spread(n.ins, 0, 22, 0); spread(n.outs, n.w, 22, 0); }
      else { spread(n.ins, 0, n.h / 2, 20); spread(n.outs, n.w, n.h / 2, 20); }
    });
    const cols = Array.from({ length: ncol }, () => []);
    nodes.forEach(n => cols[n.col].push({ kind: 'node', node: n, h: n.h, w: n.w }));
    const dummies = new Map();
    edges.forEach(e => {
      e.cs = e.src.node.col; e.ct = e.dst.node.col; e.chain = e.bad ? e.id : e.src.key; e.lanes = [];
      for (let c = e.cs + 1; c < e.ct; c++) {
        const k = e.chain + '@' + c; let d = dummies.get(k);
        if (!d) { d = { kind: 'dummy', key: k, col: c, h: 8, w: 0, prev: c - 1 === e.cs ? { pin: e.src } : { dummy: dummies.get(e.chain + '@' + (c - 1)) } };
          dummies.set(k, d); cols[c].push(d); }
        e.lanes.push(d);
      }
    });
    const pinY = p => p.node.y + p.oy;
    const refY = r => r.pin ? pinY(r.pin) : r.dummy.y + r.dummy.h / 2;
    const gapOf = (a, b) => a.kind === 'dummy' && b.kind === 'dummy' ? 6 : (a.kind === 'dummy' || b.kind === 'dummy') ? 10 : 16;
    const firstUse = n => { let m = 99; edges.forEach(e => { if (!e.bad && e.src.node === n) m = Math.min(m, e.ct); }); return m; };
    cols[0].sort((a, b) => (firstUse(a.node) - firstUse(b.node)) || ((a.node.idx ?? 500) - (b.node.idx ?? 500)));
    let y = 0; cols[0].forEach((it, i) => { if (i) y += gapOf(cols[0][i - 1], it); it.y = y; y += it.h; it.node.y = it.y; });
    for (let c = 1; c < ncol; c++) {
      const col = cols[c];
      col.forEach((it, i) => {
        if (it.kind === 'dummy') { it.want = refY(it.prev) - it.h / 2; it.wt = 1; return; }
        const vals = [];
        it.node.ins.forEach(p => { const e = this.edgeInto.get(p.key); if (!e || e.ct <= e.cs) return;
          vals.push(refY(e.lanes.length ? { dummy: e.lanes[e.lanes.length - 1] } : { pin: e.src }) - p.oy); });
        it.want = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : i * 40; it.wt = 3;
      });
      col.sort((a, b) => a.want - b.want);
      placeCol(col, gapOf);
      col.forEach(it => { if (it.kind === 'node') it.node.y = it.y; });
    }
    let minY = Infinity, maxY = -Infinity;
    cols.flat().forEach(it => { minY = Math.min(minY, it.y); maxY = Math.max(maxY, it.y + it.h); });
    cols.flat().forEach(it => { it.y -= minY; if (it.kind === 'node') it.node.y = it.y; });
    maxY -= minY;
    const colW = cols.map(col => Math.max(20, ...col.filter(it => it.kind === 'node').map(it => it.w)));
    const chans = Array.from({ length: ncol }, () => new Map());
    edges.forEach(e => { if (e.ct <= e.cs) return;
      for (let c = e.cs + 1; c <= e.ct; c++) {
        const entry = c - 1 === e.cs ? pinY(e.src) : e.lanes[c - e.cs - 2].y + 4;
        const exit = c === e.ct ? pinY(e.dst) : e.lanes[c - e.cs - 1].y + 4;
        let t = chans[c].get(e.chain); if (!t) chans[c].set(e.chain, t = { entry, exits: new Set() }); t.exits.add(exit);
      } });
    const TR = 8;
    const chW = chans.map((m, c) => c === 0 ? 0 : Math.max(34, 22 + (m.size - 1) * TR));
    chans.forEach(m => {
      const arr = [...m.values()].map(t => { const ex = [...t.exits]; return { t, dir: Math.sign(ex.reduce((a, b) => a + b, 0) / ex.length - t.entry) }; });
      const down = arr.filter(a => a.dir > 0).sort((a, b) => b.t.entry - a.t.entry);
      const flat = arr.filter(a => a.dir === 0);
      const up = arr.filter(a => a.dir < 0).sort((a, b) => a.t.entry - b.t.entry);
      [...down, ...flat, ...up].forEach((a, i) => { a.t.idx = i; });
    });
    let x = 0; const colX = [];
    for (let c = 0; c < ncol; c++) { if (c) x += chW[c]; colX[c] = x; x += colW[c]; }
    const trackX = (c, chain) => { const m = chans[c], t = m.get(chain); return colX[c] - chW[c] + (chW[c] - (m.size - 1) * TR) / 2 + (t ? t.idx : 0) * TR; };
    nodes.forEach(n => { const c = n.col;
      n.x = n.kind === 'in' ? colX[c] + colW[c] - n.w : n.kind === 'out' ? colX[c] : colX[c] + (colW[c] - n.w) / 2; });
    const pinXY = p => [p.node.x + p.ox, p.node.y + p.oy];
    let back = 0;
    edges.forEach(e => {
      const s = pinXY(e.src), t = pinXY(e.dst); let pts;
      if (e.ct > e.cs) {
        pts = [s]; let cy = s[1];
        for (let c = e.cs + 1; c <= e.ct; c++) {
          const tx = trackX(c, e.chain), ny = c === e.ct ? t[1] : e.lanes[c - e.cs - 1].y + 4;
          pts.push([tx, cy], [tx, ny]); cy = ny;
        }
        pts.push(t);
      } else {
        const ly = maxY + 24 + (back++) * 8;
        pts = [s, [s[0] + 12, s[1]], [s[0] + 12, ly], [t[0] - 12, ly], [t[0] - 12, t[1]], t];
      }
      e.pts = simplify(pts);
    });
    this.junctions = [];
    chans.forEach((m, c) => m.forEach((t, chain) => {
      if (chain.startsWith('bad:')) return;
      const ys = [t.entry, ...t.exits], lo = Math.min(...ys), hi = Math.max(...ys);
      new Set(ys).forEach(yy => { if (yy > lo + .5 && yy < hi - .5) this.junctions.push({ x: trackX(c, chain), y: yy, chain }); });
    }));
    this.box = { x0: -112, y0: -24, x1: x + 150, y1: maxY + 24 + back * 8 };
  }
  draw(host) {
    host.innerHTML = '';
    const b = this.box, W = b.x1 - b.x0, H = b.y1 - b.y0;
    const svg = this.svg = sv('svg', { viewBox: `${b.x0} ${b.y0} ${W} ${H}`, class: 'sch', role: 'img', 'aria-label': 'the gates inside this chip' }, host);
    this.vb = [W, H];
    const gW = sv('g', {}, svg), gB = sv('g', {}, svg), gN = sv('g', {}, svg);
    this.edges.forEach(e => {
      e.el = sv('path', { d: 'M' + e.pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L'), class: e.bad ? 'w bad-w hidden' : 'w', ...NSS }, e.bad ? gB : gW);
    });
    this.dots = this.junctions.map(j => ({ ...j, el: sv('circle', { cx: j.x.toFixed(1), cy: j.y.toFixed(1), r: 2.6, class: 'dot' }, gW) }));
    this.nodes.forEach(n => this.drawNode(n, gN));
    return svg;
  }
  drawNode(n, parent) {
    const g = sv('g', { transform: `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})` }, parent); n.el = g;
    const nm = this.names[n.label] ?? (n.konst ? 'always off' : n.label);
    if (n.kind === 'in') { sv('circle', { cx: n.w - 4, cy: n.h / 2, r: 5, class: 'knob', ...NSS }, g); txt(g, n.w - 14, n.h / 2 + 6, nm, 'io', 'end'); return; }
    if (n.kind === 'out') { sv('circle', { cx: 10, cy: n.h / 2, r: 8, class: 'bulb', ...NSS }, g); txt(g, 24, n.h / 2 + 6, nm, 'io'); return; }
    if (n.kind === 'gate') {
      const G = GATE[n.type];
      if (!G) { n.ins.forEach(p => { p.leadEl = lead(g, 0, p.oy, 8); }); sv('rect', { x: 8, y: 0, width: 44, height: 40, rx: 4, class: 'sym', ...NSS }, g); n.outLead = lead(g, 52, 20, 60); txt(g, 30, 52, GATE_WORD[n.type] || '', 'gw', 'middle'); return; }
      n.ins.forEach(p => { p.leadEl = lead(g, 0, p.oy, G.inX(p.oy)); });
      if (G.arc) sv('path', { d: G.arc, class: 'sym arc', ...NSS }, g);
      sv('path', { d: G.body, class: 'sym', ...NSS }, g);
      if (G.bubble) sv('circle', { cx: G.bubble, cy: 20, r: 4, class: 'sym', ...NSS }, g);
      n.outLead = lead(g, G.outX, 20, 60);
      txt(g, 30, 54, GATE_WORD[n.type] || '', 'gw', 'middle');
      return;
    }
    if (n.kind === 'ff') {
      n.ins.forEach(p => { p.leadEl = lead(g, 0, 22, 8); }); n.outLead = lead(g, 64, 22, 72);
      sv('rect', { x: 8, y: 0, width: 56, height: 44, rx: 6, class: 'sym', ...NSS }, g);
      txt(g, 36, 56, 'memory', 'gw', 'middle');
      return;
    }
    sv('rect', { x: 0, y: 0, width: n.w, height: n.h, rx: 8, class: 'sym box', ...NSS }, g);
    txt(g, n.w / 2, n.h / 2 + 5, n.label, 'iname', 'middle');
    n.ins.forEach(p => { p.pinEl = sv('circle', { cx: 0, cy: p.oy, r: 3, class: 'pin' }, g); });
    n.outs.forEach(p => { p.pinEl = sv('circle', { cx: n.w, cy: p.oy, r: 3, class: 'pin' }, g); });
  }
  fit(host, maxH = 520) {
    if (!this.svg) return;
    const [W, H] = this.vb, cw = (host.clientWidth || 560) - 4;
    const sc = Math.min(cw / W, maxH / H, 1.25);
    this.svg.setAttribute('width', Math.round(W * sc)); this.svg.setAttribute('height', Math.round(H * sc));
  }
  light(v) {
    const on = s => !!v[s];
    this.edges.forEach(e => { if (!e.bad) e.el.classList.toggle('hi', on(e.src.sig)); });
    this.dots.forEach(d => { const e = this.edges.find(x => x.src.key === d.chain); d.el.style.fill = e && on(e.src.sig) ? 'var(--amber)' : ''; });
    this.nodes.forEach(n => {
      if (n.kind === 'in') n.el.classList.toggle('hi', on(n.outs[0]?.sig));
      else if (n.kind === 'out') n.el.classList.toggle('hi', on(n.ins[0]?.sig));
      else {
        n.ins.forEach(p => { p.leadEl?.classList.toggle('on', on(p.sig)); p.pinEl?.classList.toggle('on', on(p.sig)); });
        n.outs.forEach(p => { p.pinEl?.classList.toggle('on', on(p.sig)); });
        n.outLead?.classList.toggle('on', on(n.outs[0]?.sig));
      }
    });
  }
  showBad(yes) { this.badEdges.forEach(e => e.el.classList.toggle('hidden', !yes)); }
}

/* ───────── library parts → flat gates → simulation (copied from fab.js) ───────── */
const g_ = (name, type, inputs) => ({ name, type, inputs, output: name });
const BUILTIN_PARTS = {
  full_adder: { id: 'full_adder', ports: { inputs: ['a', 'b', 'cin'], outputs: ['sum', 'cout'] }, gates: 5, builtin: true,
    blueprint: { inputs: ['a', 'b', 'cin'], outputs: { sum: 'sum', cout: 'cout' }, instances: [], flipflops: [],
      gates: [g_('x1', 'XOR', ['a', 'b']), g_('sum', 'XOR', ['x1', 'cin']), g_('a1', 'AND', ['a', 'b']), g_('a2', 'AND', ['x1', 'cin']), g_('cout', 'OR', ['a1', 'a2'])] } },
  half_adder: { id: 'half_adder', ports: { inputs: ['a', 'b'], outputs: ['sum', 'cout'] }, gates: 2, builtin: true,
    blueprint: { inputs: ['a', 'b'], outputs: { sum: 'sum', cout: 'cout' }, instances: [], flipflops: [],
      gates: [g_('sum', 'XOR', ['a', 'b']), g_('cout', 'AND', ['a', 'b'])] } },
};
const partOf = id => S.lib?.parts?.[id] || BUILTIN_PARTS[id] || null;
const outMapOf = bp => Array.isArray(bp?.outputs) ? Object.fromEntries(bp.outputs.map(s => [s, s])) : (bp?.outputs || {});
function flatten(bp) {
  const out = { inputs: [...(bp.inputs || [])], outputs: { ...outMapOf(bp) }, gates: [], flipflops: [], instances: [], missing: [] };
  const walk = (b, R, pre, depth) => {
    (b.gates || []).forEach(g => out.gates.push({ name: pre + g.name, type: String(g.type || '').toUpperCase(), inputs: (g.inputs || []).map(R), output: R(g.output) }));
    (b.flipflops || []).forEach(f => out.flipflops.push({ name: R(f.name), d: R(f.d) }));
    (b.instances || []).forEach(inst => {
      const p = partOf(inst.part);
      if (!p || !p.blueprint || depth > 6) { out.missing.push(inst.part); return; }
      const pb = p.blueprint, ins = new Set(p.ports?.inputs || pb.inputs || []), internalOut = new Map();
      Object.entries(outMapOf(pb)).forEach(([port, s]) => internalOut.set(s, port));
      const ipre = pre + inst.name + '_', w = inst.wire || {};
      const Ri = s => ins.has(s) ? R(w[s] ?? ipre + s) : internalOut.has(s) ? R(w[internalOut.get(s)] ?? ipre + s) : ipre + s;
      walk(pb, Ri, ipre, depth + 1);
    });
  };
  walk(bp, s => s, '', 0);
  return out;
}
const GATE_FN = { AND: (a, b) => a & b, OR: (a, b) => a | b, XOR: (a, b) => a ^ b, NAND: (a, b) => 1 - (a & b),
  NOR: (a, b) => 1 - (a | b), XNOR: (a, b) => 1 - (a ^ b), NOT: a => 1 - a, BUF: a => a };
function simulate(flat, inputs, state = {}) {
  const v = {};
  for (const k in inputs) v[k] = inputs[k] ? 1 : 0;
  flat.flipflops.forEach(f => { v[f.name] = state[f.name] ? 1 : 0; });
  const rd = s => v[s] ? 1 : 0;
  for (let it = 0; it < flat.gates.length + 3; it++) {
    let ch = false;
    for (const g of flat.gates) {
      const fn = GATE_FN[g.type]; if (!fn) continue;
      const y = g.type === 'NOT' || g.type === 'BUF' ? fn(rd(g.inputs[0])) : fn(rd(g.inputs[0]), rd(g.inputs[1]));
      if (v[g.output] !== y) { v[g.output] = y; ch = true; }
    }
    if (!ch) break;
  }
  const outs = {}; for (const n in flat.outputs) outs[n] = rd(flat.outputs[n]);
  return { v, outs };
}
function buses(names) {
  const m = new Map();
  names.forEach(s => { const r = /^([A-Za-z_]+?)(\d+)$/.exec(s); const key = r ? r[1] : '·';
    if (!m.has(key)) m.set(key, []); m.get(key).push({ sig: s, bit: r ? +r[2] : null }); });
  const out = [];
  m.forEach((bits, name) => {
    if (name !== '·' && bits.length > 1) out.push({ name, bits: bits.sort((a, b) => b.bit - a.bit), bus: true });
    else bits.forEach(b => out.push({ name: b.sig, bits: [b], bus: false, single: true }));
  });
  return out;
}
const busVal = (bus, vals) => bus.bits.reduce((a, b) => a + ((vals[b.sig] ? 1 : 0) << b.bit), 0);

/* ═════════ 3D assembly replay ═════════ */
const C3 = { board: 0xF1ECE3, chip: 0xFAF7F1, pin: 0xBDB4A7, part: 0xFFFFFF, gate: 0xF7F2EA, edge: 0xD9D0C2, wire: 0x3A332B, bad: 0xD9483B, ok: 0x2E9E5B };
const hashOff = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (((h % 5) + 5) % 5 - 2); };
function labelSprite(text) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), fs = 56;
  ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 24; c.width = w; c.height = fs + 22;
  ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#1F1B16'; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const hgt = .42; sp.scale.set(hgt * c.width / c.height, hgt, 1); sp.renderOrder = 5;
  return sp;
}
class Replay3D {
  constructor(host) {
    this.host = host;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.setClearColor(0xffffff, 1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    host.prepend(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1.6, .1, 300);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xE6DCCB, 2.0));
    const d = this.sun = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(6, 16, 9); d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048); d.shadow.radius = 6; d.shadow.bias = -.0005;
    this.scene.add(d, d.target);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.t = 0; this.paused = false; this.time = 0; this.items = []; this.anims = [];
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    this.onCaption = () => {}; this.onStamp = () => {};
  }
  resize() {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 460;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  clear() {
    this.root.traverse(o => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
    this.root.clear(); this.blocks = new Map(); this.wires = new Map(); this.anims = []; this.items = []; this.t = 0;
  }
  load(run, live) {
    this.clear(); this.run = run; this.live = !!live;
    const bp = run.blueprint || {}, order = run.order || {};
    let events = (run.events || []).slice();
    if (!events.some(e => e.type === 'place') && bp) events = synthEvents(run).concat(events.filter(e => e.type === 'fail' || e.type === 'pass'));
    this.instPart = new Map((bp.instances || []).map(i => [i.name, i.part]));
    this.gateType = new Map((bp.gates || []).map(g => [g.name, String(g.type || '').toUpperCase()]));
    this.driverOf = new Map();
    (bp.gates || []).forEach(g => this.driverOf.set(g.output, g.name));
    (bp.flipflops || []).forEach(f => this.driverOf.set(f.name, f.name));
    (bp.instances || []).forEach(i => Object.entries(i.wire || {}).forEach(([p, s]) => { if (OUT_PORT.test(p) && !this.driverOf.has(s)) this.driverOf.set(s, i.name); }));
    // the blocks, in the order they were first placed
    const blocks = [];
    events.forEach(e => { if (e.type === 'place' && !blocks.some(b => b.name === e.block)) blocks.push({ name: e.block, kind: e.kind || 'gate', label: e.label }); });
    const n = Math.max(1, blocks.length), cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.7))), rows = Math.ceil(n / cols);
    const CW = 2.5, CD = 2.1, W = cols * CW + 2.6, D = rows * CD + 2.4, TOP = .5;
    this.W = W; this.D = D; this.TOP = TOP;
    // board + chip body + pins
    const board = new THREE.Mesh(new THREE.BoxGeometry(W + 9, .2, D + 7), new THREE.MeshStandardMaterial({ color: C3.board, roughness: 1 }));
    board.position.y = -.1; board.receiveShadow = true; this.root.add(board);
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, TOP, D), new THREE.MeshStandardMaterial({ color: C3.chip, roughness: .85 }));
    body.position.y = TOP / 2; body.castShadow = true; body.receiveShadow = true; this.root.add(body);
    const ins = order.inputs || bp.inputs || [], outs = Object.keys(outMapOf(bp)).length ? Object.keys(outMapOf(bp)) : (order.outputs || []);
    const pinMat = new THREE.MeshStandardMaterial({ color: C3.pin, roughness: .5, metalness: .2 });
    const pinGeo = new THREE.BoxGeometry(.7, .12, .22);
    this.pinPos = new Map();
    const addPins = (names, side) => {
      const k = Math.max(4, names.length), step = Math.min(.6, (D - .8) / k);
      for (let i = 0; i < k; i++) {
        const z = (i - (k - 1) / 2) * step, x = side * (W / 2 + .3);
        const p = new THREE.Mesh(pinGeo, pinMat); p.position.set(x, .12, z); p.castShadow = true; this.root.add(p);
        if (names[i]) this.pinPos.set(names[i], new THREE.Vector3(side * W / 2 * .97, TOP + .02, z));
      }
    };
    addPins(ins, -1); addPins(outs, 1);
    // blocks (hidden until placed)
    const blkMat = { part: new THREE.MeshStandardMaterial({ color: C3.part, roughness: .7 }), gate: new THREE.MeshStandardMaterial({ color: C3.gate, roughness: .8 }) };
    const edgeMat = new THREE.LineBasicMaterial({ color: C3.edge });
    blocks.forEach((b, i) => {
      const part = b.kind === 'part', [bw, bh, bd] = part ? [1.8, .5, 1.25] : [1.15, .32, .8];
      const c = i % cols, r = Math.floor(i / cols);
      const x = -W / 2 + 1.3 + CW * (c + .5), z = -D / 2 + 1.2 + CD * (r + .5);
      const g = new THREE.Group(); g.position.set(x, TOP, z); g.visible = false;
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      const m = new THREE.Mesh(geo, blkMat[part ? 'part' : 'gate']); m.position.y = bh / 2; m.castShadow = true; m.receiveShadow = true; g.add(m);
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat); ed.position.y = bh / 2; g.add(ed);
      const gt = this.gateType.get(b.name) || String(b.label || '').toUpperCase().replace(/\d+$/, '');
      const text = part ? partLabel(this.instPart.get(b.name) || b.name) : (GATE_WORD[gt] || partLabel(b.label));
      const sp = labelSprite(text); sp.position.y = bh + .38; g.add(sp);
      this.root.add(g);
      this.blocks.set(b.name, { g, x, z, w: bw, d: bd, placed: false });
    });
    // timeline: each step gets a share of ~9 s
    const W8 = { plan: .6, place: 1, wire: .45, test: 1, fail: 3.4, retry: 1.4, pass: 1.6, spiral: 1.6 };
    const seenB = new Set(), seenW = new Set(); let tot = 0;
    const steps = [];
    events.forEach((e, i) => {
      let w = W8[e.type] || 0;
      if (e.type === 'place') { if (seenB.has(e.block)) w = 0; seenB.add(e.block); }
      if (e.type === 'wire') { const k = e.from + '>' + e.to; if (seenW.has(k)) w = 0; seenW.add(k); }
      if (e.type === 'test' && steps.some(s => s.e.type === 'test')) w = .6;
      steps.push({ e, i, w, at: tot }); tot += w;
    });
    const scale = live ? .5 : 9 / Math.max(tot, 1);
    steps.forEach(s => { s.at *= scale; });
    this.items = steps; this.events = events; this.pending = 0; this.endAt = tot * scale; this.skip = new Set();
    this.onCaption('', ''); this.onStamp(null);
    // camera frame
    const R = (Math.max(W, D * 1.5) + 3) * 1.2;
    this.camR = R * .62; this.camH = R * .92;
  }
  replay() { const run = this.run; if (run) this.load(run, this.live); this.paused = false; }
  follow(run) {          // live: the run grew; rebuild, then jump straight back to where the playhead was
    const t = this.t; this.load(run, true); this.t = t;
    while (this.pending < this.items.length && this.items[this.pending].at <= t) this.apply(this.items[this.pending++]);
  }
  /* ── actions ── */
  place(e) {
    const b = this.blocks.get(e.block); if (!b || b.placed) return;
    b.placed = true; b.g.visible = true; const y0 = this.TOP + 3;
    this.anim(.38, p => { b.g.position.y = this.TOP + (y0 - this.TOP) * (1 - easeOut(p)); });
    this.onCaption('Putting blocks on the chip', '');
  }
  endpoint(tok, isFrom) {
    tok = String(tok); const dot = tok.indexOf('.');
    const nm = dot > 0 ? tok.slice(0, dot) : tok, port = dot > 0 ? tok.slice(dot + 1) : '';
    let b = this.blocks.get(nm);
    if (!b && this.pinPos.has(tok)) return this.pinPos.get(tok).clone();
    if (!b && this.driverOf.has(tok)) b = this.blocks.get(this.driverOf.get(tok));
    if (b && b.placed) return new THREE.Vector3(b.x + (isFrom ? b.w / 2 : -b.w / 2), this.TOP + .02, b.z + hashOff(port || tok) * b.d * .14);
    return new THREE.Vector3(isFrom ? -this.W / 2 * .97 : this.W / 2 * .97, this.TOP + .02, hashOff(tok) * .5);
  }
  wirePath(a, b, key) {
    const xm = (a.x + b.x) / 2 + hashOff(key) * .12;
    const pts = [a, new THREE.Vector3(xm, a.y, a.z), new THREE.Vector3(xm, a.y, b.z), b];
    return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > .01);
  }
  buildWire(w, pts) {
    w.g.clear(); w.segs = [];
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, .02, .055), w.mat); m.visible = false; w.g.add(m);
      w.segs.push({ a, b, len, cum, m }); cum += len;
    }
    w.len = cum;
  }
  grow(w, p) {
    const L = w.len * p;
    w.segs.forEach(s => {
      const l = clamp(L - s.cum, 0, s.len); s.m.visible = l > .001; if (!s.m.visible) return;
      const dir = s.b.clone().sub(s.a).normalize();
      s.m.scale.set(l, 1, 1); s.m.position.copy(s.a).addScaledVector(dir, l / 2); s.m.position.y += .012;
      s.m.rotation.y = Math.atan2(-dir.z, dir.x);
    });
  }
  wire(e, color = C3.wire) {
    const key = e.from + '>' + e.to;
    if (this.wires.has(key)) return;
    const w = { key, from: e.from, to: e.to, g: new THREE.Group(), mat: new THREE.MeshBasicMaterial({ color }) };
    this.root.add(w.g); this.wires.set(key, w);
    this.buildWire(w, this.wirePath(this.endpoint(e.from, true), this.endpoint(e.to, false), key));
    this.anim(.15, p => this.grow(w, p));
    this.onCaption('Connecting the wires', '');
  }
  fail(e) {
    const bad = (e.bad_wires || []).filter(w => Array.isArray(w) && w.length > 1);
    this.badNow = [];
    bad.forEach(([f, t]) => {
      const key = f + '>' + t;
      if (!this.wires.has(key)) { this.wire({ from: f, to: t }, C3.bad); }
      const w = this.wires.get(key); if (w) { w.mat.color.setHex(C3.bad); this.badNow.push(w); }
    });
    const note = plainNote(e.note);
    if (bad.length) this.onCaption('Wrong wire: ' + note, 'bad');
    else if (e.category === 'spiral') this.onCaption('Got stuck thinking in circles: ' + note, 'bad');
    else this.onCaption(/^wrong/i.test(note) ? cap(note) : 'Wrong: ' + note, 'bad');
  }
  retry(idx) {
    this.onCaption('Trying again', '');
    (this.badNow || []).forEach(w => {
      const fixIdx = this.events.findIndex((e, i) => i > idx && e.type === 'wire' && e.to === w.to);
      if (fixIdx >= 0) {
        const fix = this.events[fixIdx]; this.skip.add(fixIdx);
        this.wires.delete(w.key); w.key = fix.from + '>' + fix.to; w.from = fix.from; this.wires.set(w.key, w);
        this.buildWire(w, this.wirePath(this.endpoint(fix.from, true), this.endpoint(fix.to, false), w.key));
        w.mat.color.setHex(C3.ok);
        this.anim(.35, p => this.grow(w, p), () => setTimeout(() => w.mat.color.setHex(C3.wire), 600));
      } else w.mat.color.setHex(C3.wire);
    });
    this.badNow = [];
  }
  apply(s) {
    const e = s.e;
    switch (e.type) {
      case 'plan': this.onCaption(`Planning: ${(e.parts || []).length} block${(e.parts || []).length === 1 ? '' : 's'}`, ''); break;
      case 'place': this.place(e); break;
      case 'wire': if (!this.skip.has(s.i)) this.wire(e); break;
      case 'test': this.onCaption('Checking every answer', ''); break;
      case 'spiral': this.onCaption('Got stuck thinking in circles', 'bad'); break;
      case 'fail': this.fail(e); break;
      case 'retry': this.retry(s.i); break;
      case 'pass': this.onCaption('', ''); this.onStamp('pass'); break;
      case 'done': if (!this.events.some(x => x.type === 'pass')) this.onStamp('fail'); break;
    }
  }
  extend(run) {          // live: new events arrive; play them after what is already scheduled
    const old = this.events.length, add = (run.events || []).slice(old);
    if (!add.length) return;
    this.run = run;
    let at = Math.max(this.t, this.items.length ? this.items[this.items.length - 1].at : 0);
    add.forEach((e, k) => { at += .35; this.events.push(e); this.items.push({ e, i: old + k, w: 1, at }); });
    this.endAt = at;
  }
  anim(dur, fn, done) { this.anims.push({ t: 0, dur, fn, done }); }
  tick(dt) {
    this.time += dt;
    if (!this.paused) {
      this.t += dt;
      while (this.pending < this.items.length && this.items[this.pending].at <= this.t) this.apply(this.items[this.pending++]);
      this.anims = this.anims.filter(a => { a.t += dt; a.fn(clamp(a.t / a.dur, 0, 1)); if (a.t >= a.dur) { a.done?.(); return false; } return true; });
    }
    const az = Math.sin(this.time * .12) * .38, R = this.camR || 14;
    this.camera.position.set(Math.sin(az) * R, this.camH || 10, Math.cos(az) * R);
    this.camera.lookAt(0, 0, .2);
    this.renderer.render(this.scene, this.camera);
  }
}
function synthEvents(run) {            // older runs without place/wire events: rebuild them from the final blueprint
  const bp = run.blueprint || {}, ev = [], drv = new Map();
  (bp.instances || []).forEach(i => {
    ev.push({ type: 'place', block: i.name, kind: 'part', label: i.part });
    Object.entries(i.wire || {}).forEach(([port, s]) => { if (OUT_PORT.test(port)) drv.set(s, `${i.name}.${port}`); });
  });
  (bp.gates || []).forEach(g => { ev.push({ type: 'place', block: g.name, kind: 'gate', label: String(g.type || '').toUpperCase() }); drv.set(g.output, `${g.name}.out`); });
  (bp.flipflops || []).forEach(f => { ev.push({ type: 'place', block: f.name, kind: 'gate', label: 'DFF' }); drv.set(f.name, `${f.name}.q`); });
  const src = s => drv.get(s) || s;
  (bp.instances || []).forEach(i => Object.entries(i.wire || {}).forEach(([port, s]) => { if (!OUT_PORT.test(port)) ev.push({ type: 'wire', from: src(s), to: `${i.name}.${port}` }); }));
  (bp.gates || []).forEach(g => (g.inputs || []).forEach((s, k) => ev.push({ type: 'wire', from: src(s), to: `${g.name}.in${k}` })));
  (bp.flipflops || []).forEach(f => ev.push({ type: 'wire', from: src(f.d), to: `${f.name}.d` }));
  Object.entries(outMapOf(bp)).forEach(([name, s]) => { if (drv.has(s)) ev.push({ type: 'wire', from: drv.get(s), to: name }); });
  return ev;
}

/* ═════════ Try it: the bench ═════════ */
function codesIn(re, title) { const m = re.exec(title || ''); return m ? m[1].match(/\d+/g).map(Number) : null; }
function benchKind(run) {
  const o = run.order || {}, bp = run.blueprint || {}, t = o.title || '';
  const ib = buses(bp.inputs || o.inputs || []), ob = buses(Object.keys(outMapOf(bp)));
  if ((bp.flipflops || []).length || o.flipflops_allowed) return 'seq';
  if (ib.some(b => b.bus && b.name === 'a') && ib.some(b => b.bus && b.name === 'b') && ob.some(b => b.bus && b.name === 's')) return 'calc';
  if (/^(door lock|lock)\b/i.test(t) && ib.every(b => b.single)) return 'lock';
  return 'generic';
}
function namesFor(run, kind) {
  const o = run.order || {}, bp = run.blueprint || {}, t = `${o.title || ''} ${o.spec || ''}`, N = {};
  const ins = bp.inputs || o.inputs || [], outs = Object.keys(outMapOf(bp));
  const BUSNAME = { a: 'first', b: 'second', d: 'digit', q: 'count', s: 'answer' };
  const parity = /parity/i.test(t);
  buses(ins).forEach(b => {
    if (b.bus) b.bits.forEach((x, i) => { N[x.sig] = parity ? `switch ${i + 1}` : `${BUSNAME[b.name] || b.name} · ${2 ** x.bit}`; });
  });
  const singles = buses(ins).filter(b => b.single).map(b => b.name).filter(s => !['cin', 'op'].includes(s));
  if (kind === 'lock' || singles.length > 1) singles.forEach((s, i) => { N[s] = String(2 ** (singles.length - 1 - i)); });
  else singles.forEach((s, i) => { N[s] = `switch ${i + 1}`; });
  N.cin = 'plus one'; N.op = 'take away';
  buses(outs).forEach(b => { if (b.bus) b.bits.forEach(x => { N[x.sig] = `${BUSNAME[b.name] || b.name} · ${2 ** x.bit}`; }); });
  const sBits = buses(outs).find(b => b.bus && b.name === 's');
  if (outs.includes('cout')) N.cout = /subtract/i.test(t) ? 'below zero' : `answer · ${2 ** (sBits ? sBits.bits.length : 0)}`;
  const COL = { g: 'green', y: 'yellow', r: 'red', green: 'green light', red: 'red light' };
  outs.forEach(s => {
    if (N[s]) return;
    if (kind === 'seq' && COL[s]) N[s] = COL[s];
    else if (kind === 'lock') N[s] = s === 'green' || s === 'red' ? COL[s] : 'opens';
    else if (/bigger/i.test(t)) N[s] = 'first is bigger';
    else if (/odd-parity/i.test(t)) N[s] = 'odd';
    else if (/even-parity/i.test(t)) N[s] = 'even';
    else if (/segment/i.test(t)) N[s] = 'bar lit';
    else N[s] = COL[s] || 'light';
  });
  return N;
}
function truthCheck(order, inputs, outs) {
  const tt = order?.truth; if (!tt) return null;
  const key = (order.inputs || []).map(s => inputs[s] ? 1 : 0).join(''), want = tt[key];
  if (!want) return null;
  return Object.keys(want).every(k => (outs[k] ? 1 : 0) === (want[k] ? 1 : 0));
}

class Bench {
  constructor(host, run) {
    this.host = host; this.run = run; host.innerHTML = '';
    const bp = run?.blueprint;
    if (!bp) {
      const note = run?.inspection?.note ? plainNote(run.inspection.note) : 'the team is still working on it';
      host.append(el('p', 'empty', `Nothing to try yet: ${note}.`)); this.dead = true; return;
    }
    this.flat = flatten(bp); this.kind = benchKind(run); this.names = namesFor(run, this.kind);
    this.inputs = Object.fromEntries((bp.inputs || run.order?.inputs || []).map(s => [s, 0]));
    this.state = {}; this.ticks = 0;
    this.ui = el('div', 'benchui'); host.append(this.ui);
    this.ib = buses(Object.keys(this.inputs)); this.ob = buses(Object.keys(this.flat.outputs));
    ({ calc: () => this.buildCalc(), lock: () => this.buildLock(), seq: () => this.buildSeq(), generic: () => this.buildGeneric() })[this.kind]();
    // the gate drawing
    const dw = el('div', 'drawing'), dh = el('div', 'drawhead');
    dh.append(el('span', null, 'Inside the chip · lit wires carry a 1'));
    this.sch = new Schematic(run, this.names);
    if (this.sch.badEdges.size) {
      const t = el('button', 'switch' + (S.showBad ? ' on' : '')); t.type = 'button'; t.append(el('i'), el('span', null, 'Show the wrong wire'));
      t.addEventListener('click', () => { S.showBad = !S.showBad; t.classList.toggle('on', S.showBad); this.sch.showBad(S.showBad); });
      dh.append(t);
    }
    this.schHost = el('div', 'schwrap'); dw.append(dh, this.schHost); host.append(dw);
    this.sch.draw(this.schHost); this.sch.showBad(S.showBad);
    this.ro = new ResizeObserver(() => this.sch.fit(this.schHost)); this.ro.observe(this.schHost);
    this.update();
  }
  emit(kind) { if (!this.quiet) this.onChange?.(kind, this); }
  reset() { this.state = {}; this.ticks = 0; this.update(); }
  follow(kind, other) {             // linked switches: copy what matches by input name, then re-light
    if (this.dead) return;
    if (kind === 'tick') { Object.keys(this.inputs).forEach(k => { if (k in other.inputs) this.inputs[k] = other.inputs[k]; }); this.clock(); return; }
    if (kind === 'reset') { this.reset(); return; }
    let n = 0; Object.keys(this.inputs).forEach(k => { if (k in other.inputs) { this.inputs[k] = other.inputs[k]; n++; } });
    if (n) this.update();
  }
  set(sig, v) { if (sig in this.inputs) this.inputs[sig] = v ? 1 : 0; }
  setBus(bus, n) { bus.bits.forEach(b => this.set(b.sig, (n >> b.bit) & 1)); }
  stepper(label, get, set, max) {
    const w = el('div', 'stepper'), box = el('div', 'box'), v = el('div', 'val');
    const mk = (s, d) => { const b = el('button', 'rb', s); b.type = 'button'; b.setAttribute('aria-label', d > 0 ? 'more' : 'less');
      b.addEventListener('click', () => { set((get() + d + max + 1) % (max + 1)); this.update(); this.emit('inputs'); }); return b; };
    box.append(mk('−', -1), v, mk('+', 1)); w.append(box, el('div', 'lab', label));
    return { w, v };
  }
  toggle(label, sig) {
    const b = el('button', 'tg'); b.type = 'button'; b.append(el('i'), el('span', null, label));
    b.addEventListener('click', () => { this.inputs[sig] ^= 1; this.update(); this.emit('inputs'); });
    (this.tgs = this.tgs || []).push({ b, sig }); return b;
  }
  lamp(label, sig, cls) { const l = el('div', 'lamp ' + (cls || '')); l.append(el('i'), el('span', null, label)); (this.lps = this.lps || []).push({ l, sig }); return l; }
  bitLamps(bus) { const row = el('div', 'bits'); [...bus.bits].forEach(b => row.append(this.lamp(String(2 ** b.bit), b.sig))); return row; }

  buildCalc() {
    const A = this.ib.find(b => b.bus && b.name === 'a'), B = this.ib.find(b => b.bus && b.name === 'b');
    this.A = A; this.B = B; this.Sb = this.ob.find(b => b.bus && b.name === 's');
    const maxA = 2 ** A.bits.length - 1, maxB = 2 ** B.bits.length - 1;
    this.sub = /subtract/i.test(this.run.order?.title || '') && !('op' in this.inputs);
    this.setBus(A, Math.min(7, maxA)); this.setBus(B, Math.min(5, maxB));
    if (this.sub && maxA >= 7) { this.setBus(A, 7); this.setBus(B, Math.min(5, maxB)); }
    this.ui.append(el('p', 'ask', 'Pick two numbers. The chip works out the answer with its gates.'));
    const row = el('div', 'nums');
    this.sa = this.stepper('first number', () => busVal(A, this.inputs), n => this.setBus(A, n), maxA);
    this.sb = this.stepper('second number', () => busVal(B, this.inputs), n => this.setBus(B, n), maxB);
    this.opEl = el('div', 'op', '+'); this.ansEl = el('div', 'answer');
    row.append(this.sa.w, this.opEl, this.sb.w, el('div', 'op', '='), this.ansEl);
    this.ui.append(row);
    const ex = el('div', 'toggles');
    if ('op' in this.inputs) ex.append(this.toggle('take away instead', 'op'));
    if ('cin' in this.inputs) ex.append(this.toggle('plus one extra', 'cin'));
    if (ex.childElementCount) this.ui.append(ex);
    this.vEl = el('div', 'vrow'); this.ui.append(this.vEl);
  }
  buildLock() {
    const sigs = this.ib.map(b => b.name), k = sigs.length, max = 2 ** k - 1, t = this.run.order?.title || '';
    this.lockSigs = sigs;
    this.open = codesIn(/(?:opens only for|green light for) codes? ([\d,\sand]+)/i, t);
    this.red = codesIn(/red light for codes? ([\d,\sand]+)/i, t);
    const pick = (this.open || []).slice().sort((a, b) => Math.abs(a - 7) - Math.abs(b - 7))[0] ?? 0;
    this.setCode(pick);
    this.ui.append(el('p', 'ask', 'Dial a code. Watch whether the door opens.'));
    const row = el('div', 'nums');
    this.sc = this.stepper('code', () => this.code(), n => this.setCode(n), max);
    row.append(this.sc.w); this.ui.append(row);
    const tg = el('div', 'toggles'); sigs.forEach(s => tg.append(this.toggle(this.names[s], s))); this.ui.append(tg);
    this.ui.append(el('p', 'bitcap', 'the switches add up to the code'));
    const lr = el('div', 'lamps'), outs = Object.keys(this.flat.outputs);
    outs.forEach(s => lr.append(this.lamp(s === 'y' ? 'opens' : this.names[s], s, 'big ' + (s === 'red' ? 'red' : 'green'))));
    this.ui.append(lr);
    this.lineEl = el('p', 'lockline'); this.ui.append(this.lineEl);
    this.vEl = el('div', 'vrow'); this.ui.append(this.vEl);
  }
  code() { return this.lockSigs.reduce((a, s) => a * 2 + (this.inputs[s] ? 1 : 0), 0); }
  setCode(n) { const k = this.lockSigs.length; this.lockSigs.forEach((s, i) => this.set(s, (n >> (k - 1 - i)) & 1)); }
  buildSeq() {
    this.ui.append(el('p', 'ask', 'Press Tick to move the chip one step forward.'));
    const q = this.ob.find(b => b.bus);
    if (q) { this.countEl = el('div', 'count'); this.ui.append(this.countEl, this.bitLamps(q)); }
    const lr = el('div', 'lamps');
    this.ob.filter(b => b.single).forEach(b => { const nm = this.names[b.name]; lr.append(this.lamp(nm, b.name, 'big ' + (/green/.test(nm) ? 'green' : /red/.test(nm) ? 'red' : /yellow/.test(nm) ? 'yellow' : ''))); });
    if (lr.childElementCount) this.ui.append(lr);
    if (this.ib.length) { const tg = el('div', 'toggles'); this.ib.forEach(b => b.bits.forEach(x => tg.append(this.toggle(this.names[x.sig] || 'switch', x.sig)))); this.ui.append(tg); }
    const tk = el('div', 'tick');
    const b1 = el('button', 'btn primary'); b1.type = 'button'; b1.innerHTML = icon('play') + '<span>Tick</span>';
    const b2 = el('button', 'btn'); b2.type = 'button'; b2.innerHTML = icon('rotate-ccw') + '<span>Start over</span>';
    b1.addEventListener('click', () => { this.clock(); this.emit('tick'); }); b2.addEventListener('click', () => { this.reset(); this.emit('reset'); });
    this.tickEl = el('span', 'note'); tk.append(b1, b2); this.ui.append(tk, this.tickEl);
  }
  buildGeneric() {
    this.ui.append(el('p', 'ask', 'Flip the switches. Watch the lights.'));
    const row = el('div', 'nums'); this.steps = [];
    this.parity = /parity/i.test(this.run.order?.title || '');
    if (this.parity) { const tg = el('div', 'toggles'); this.ib.forEach(b => b.bits.forEach(x => tg.append(this.toggle(this.names[x.sig], x.sig)))); this.ui.append(tg); }
    this.ib.filter(b => b.bus && !this.parity).forEach(b => {
      const st = this.stepper(this.names[b.bits[0].sig].split(' · ')[0] + ' number', () => busVal(b, this.inputs), n => this.setBus(b, n), 2 ** b.bits.length - 1);
      row.append(st.w); this.steps.push({ st, b });
    });
    if (row.childElementCount) this.ui.append(row);
    const singles = this.ib.filter(b => b.single);
    if (singles.length) { const tg = el('div', 'toggles'); singles.forEach(b => tg.append(this.toggle(this.names[b.name], b.name))); this.ui.append(tg); }
    const lr = el('div', 'lamps'); this.ob.forEach(b => b.bits.forEach(x => lr.append(this.lamp(this.names[x.sig], x.sig, 'big'))));
    this.ui.append(lr);
    this.vEl = el('div', 'vrow'); this.ui.append(this.vEl);
  }
  verdict(ok) { this.vEl.innerHTML = ok == null ? '' : `<span class="verdict ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'x')}${ok ? 'right' : 'wrong'}</span>`; icons(); }
  clock() {
    const r = simulate(this.flat, this.inputs, this.state), ns = {};
    this.flat.flipflops.forEach(f => { ns[f.name] = r.v[f.d] ? 1 : 0; });
    this.state = ns; this.ticks++; this.update();
  }
  update() {
    if (this.dead) return;
    const r = simulate(this.flat, this.inputs, this.state), o = r.outs, order = this.run.order || {};
    this.sch.light(r.v);
    (this.tgs || []).forEach(({ b, sig }) => { b.classList.toggle('on', !!this.inputs[sig]); b.setAttribute('aria-pressed', this.inputs[sig] ? 'true' : 'false'); });
    (this.lps || []).forEach(({ l, sig }) => l.classList.toggle('on', !!o[sig]));
    const tc = truthCheck(order, this.inputs, o);
    if (this.kind === 'calc') {
      const a = busVal(this.A, this.inputs), b = busVal(this.B, this.inputs), n = this.Sb.bits.length, M = 2 ** n, s = busVal(this.Sb, o);
      const cin = this.inputs.cin ? 1 : 0, sub = this.sub || !!this.inputs.op;
      this.sa.v.textContent = a; this.sb.v.textContent = b; this.opEl.textContent = sub ? '−' : '+';
      let shown = s, ok;
      if (sub) ok = s === (((a - b - cin) % M) + M) % M;
      else { shown = s + ((o.cout ? 1 : 0) << n) * ('cout' in o ? 1 : 0); ok = 'cout' in o ? shown === a + b + cin : s === (a + b + cin) % M; }
      this.ansEl.textContent = shown + (cin && !sub ? '' : '');
      this.ansEl.title = `${a} ${sub ? '−' : '+'} ${b}${cin ? ' + 1' : ''} = ${shown}`;
      this.verdict(tc ?? ok);
    } else if (this.kind === 'lock') {
      const c = this.code(); this.sc.v.textContent = c;
      const outs = Object.keys(o);
      let said, ok = null;
      if (outs.length === 1) {
        const y = !!o[outs[0]]; said = y ? 'opens' : 'stays shut';
        if (this.open) ok = y === this.open.includes(c);
      } else {
        const g = !!o.green, rd = !!o.red; said = g && rd ? 'both lights' : g ? 'green light' : rd ? 'red light' : 'no light';
        if (this.open && this.red) ok = g === this.open.includes(c) && rd === this.red.includes(c);
      }
      this.lineEl.innerHTML = `code <b>${c}</b> → <b>${said}</b>`;
      this.verdict(tc ?? ok);
    } else if (this.kind === 'seq') {
      const q = this.ob.find(b => b.bus);
      if (q && this.countEl) this.countEl.textContent = busVal(q, o);
      this.tickEl.textContent = `${this.ticks} tick${this.ticks === 1 ? '' : 's'} so far`;
    } else {
      (this.steps || []).forEach(({ st, b }) => { st.v.textContent = busVal(b, this.inputs); });
      const t = order.title || '', outs = Object.keys(o), A = this.ib.find(b => b.bus && b.name === 'a'), B = this.ib.find(b => b.bus && b.name === 'b');
      let ok = null;
      if (outs.length === 1 && /bigger/i.test(t) && A && B) ok = !!o[outs[0]] === busVal(A, this.inputs) > busVal(B, this.inputs);
      if (outs.length === 1 && this.parity) { const on = Object.values(this.inputs).filter(Boolean).length; ok = !!o[outs[0]] === (/odd/i.test(t) ? on % 2 === 1 : on % 2 === 0); }
      this.verdict(tc ?? ok);
    }
  }
}

/* ═════════ the compare page ═════════ */
const SAMPLE = new URL('../samples/run.sample.json', location.href).href;
const LIVE_FB = new URL('../samples/live_fallback.json', location.href).href;
const passed = r => !!r?.inspection?.pass;
const vlabel = v => 'v' + verNum(v);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function logLine(e, run) {
  switch (e.type) {
    case 'order': return 'Order received';
    case 'spawn': return `${ROLE[e.role] || cap(e.role || e.agent || 'Helper')} started`;
    case 'plan': return `Plan: ${plural((e.parts || []).length, 'block')}`;
    case 'place': return `Placed ${e.kind === 'part' ? partLabel(run?.blueprint?.instances?.find(i => i.name === e.block)?.part || e.block) : (GATE_WORD[String(e.label || '').toUpperCase().replace(/\d+$/, '')] || e.label || e.block)}`;
    case 'wire': return `Wired ${e.from} to ${e.to}`;
    case 'test': { const m = /(\d+)\s*\/\s*(\d+)/.exec(e.summary || ''); if (m) return `Checked: ${m[1]} of ${m[2]} answers right`;
      if (e.expected != null) return `Checked: wanted ${e.expected}, got ${e.got}`; return 'Checked the answers'; }
    case 'fail': return `Wrong: ${plainNote(e.note)}`;
    case 'retry': return 'Trying again';
    case 'pass': return 'Passed';
    case 'lesson': return 'Wrote a lesson';
    case 'spiral': return 'Got stuck thinking in circles';
    case 'human_ping': return 'Asked a person for help';
    case 'done': return 'Done';
    default: return String(e.type || 'step');
  }
}

/* ───────── which runs exist, per version ───────── */
function versionsWithExam(d) {
  const ex = Object.keys(d?.exam || {});
  let vs = S.apiMode ? ex : [...new Set([...ex, ...(d?.versions || []), ...Object.keys(runPool())])];
  if (!vs.length) vs = d?.versions || [];
  return vs.sort((a, b) => verNum(a) - verNum(b));
}
function runPool() {            // version → order id → ChipRun (exam runs win)
  const d = S.data || {}, pool = {};
  const put = r => { if (!r?.version || !r.order) return; const id = r.order.id || r.run_id; (pool[r.version] ||= {}); if (!pool[r.version][id]) pool[r.version][id] = r; };
  Object.entries(d.exam || {}).forEach(([v, e]) => (e.runs || []).forEach(r => put({ version: v, ...r })));
  (d.shifts || []).forEach(s => { (s.practice || []).forEach(put); const v = s.validation; if (v) [...(v.old || []), ...(v.new || [])].forEach(put); });
  if (d.live) put(d.live);
  if (S.extra) put(S.extra);
  return pool;
}
function pastOrders() {
  if (Array.isArray(S.menu) && S.menu.length) return S.menu.map(m => ({ id: m.id, title: m.title, rung: m.rung }));
  const seen = new Map();
  Object.values(S.data?.exam || {}).forEach(e => (e.runs || []).forEach(r => { const id = r.order?.id; if (id && !seen.has(id)) seen.set(id, { id, title: r.order.title }); }));
  if (!seen.size || !S.apiMode) Object.values(runPool()).forEach(m => Object.values(m).forEach(r => { const id = r.order?.id; if (id && !seen.has(id)) seen.set(id, { id, title: r.order.title }); }));
  return [...seen.values()];
}
function pillWords(title) {
  const [nm, ic] = chipName(title), t = String(title || '');
  const codes = codesIn(/(?:opens only for|green light for|for) codes? ([\d,\sand]+)/i, t);
  let extra = codes ? codes.join(', ') : '';
  if (!extra) { const m = /(\d+)-bit/.exec(t); extra = /^calculator/i.test(t) ? `${/subtract/i.test(t) ? 'takes away' : 'adds'}${m ? ' · ' + m[1] + ' switches each' : ''}` : chipDesc(t); }
  if (extra.length > 34) extra = extra.slice(0, 32).replace(/\s+\S*$/, '') + '…';
  return { nm, ic, extra };
}
function versionTag(v) {
  if (verNum(v) === 1) return 'the bare team';
  const sn = S.snaps[v];
  if (sn) return `${plural((sn.playbook || []).length, 'lesson')}, ${plural((sn.library || []).length, 'part')}`;
  if (S.lib && (S.lib.lessons.length || Object.keys(S.lib.parts).length)) return `${plural(S.lib.lessons.filter(l => l.active !== false).length, 'lesson')}, ${plural(Object.keys(S.lib.parts).length, 'part')}`;
  const n = (S.data?.shifts || []).filter(s => verNum(s.version) < verNum(v)).reduce((a, s) => a + (s.lessons_added || []).length, 0);
  return n ? `${plural(n, 'lesson')} learned` : 'a later version';
}

/* ───────── one column ───────── */
class Column {
  constructor(side) {
    this.side = side; this.host = $('#col' + side); this.run = null; this.sig = ''; this.version = null;
    this.host.innerHTML = `<div class="chead"><div><h2></h2><p class="tagline"></p></div><span class="badge"></span></div>
      <p class="never" hidden></p>
      <div class="canvas"><div class="stamp" hidden></div></div>
      <div class="under"><p class="caption">&nbsp;</p><button class="btn small" type="button">${icon('rotate-ccw')}<span>Replay</span></button></div>
      <div class="loghead"><span>The team's work</span><span class="live" hidden></span></div>
      <ol class="log"></ol>
      <div class="loghead"><span>Agents on the job</span></div>
      <div class="agents"></div>
      <div class="loghead"><span>What this version knew before it started</span></div>
      <div class="knew"></div>
      <div class="benchhead">${icon('pointer')}<span>Try it</span></div>
      <div class="bench"></div>`;
    this.canvas = $('.canvas', this.host); this.stamp = $('.stamp', this.host); this.cap = $('.caption', this.host);
    this.logEl = $('.log', this.host); this.liveDot = $('.loghead .live', this.host); this.benchEl = $('.bench', this.host);
    this.never = $('.never', this.host); this.agentsEl = $('.agents', this.host); this.knewEl = $('.knew', this.host);
    try { this.replay = new Replay3D(this.canvas); } catch (e) { this.replay = null; this.canvas.append(el('p', 'empty', '3D view needs WebGL.')); }
    if (this.replay) {
      this.replay.onCaption = (t, cls) => { this.cap.textContent = t || ' '; this.cap.className = 'caption ' + (cls || ''); };
      this.replay.onStamp = kind => {
        const s = this.stamp, ins = this.run?.inspection;
        if (!kind) { s.hidden = true; return; }
        s.className = 'stamp ' + (kind === 'pass' ? '' : 'bad');
        s.innerHTML = kind === 'pass' ? `${icon('check')}<span>All ${ins?.correct?.total ?? ''} right</span>`
          : `${icon('x')}<span>Not passed${ins?.correct?.total ? `: wrong on ${ins.correct.total - ins.correct.passed}` : ''}</span>`;
        s.hidden = false; void s.offsetWidth; s.classList.add('show'); icons();
      };
    }
    $('.under .btn', this.host).addEventListener('click', () => this.replay?.replay());
  }
  head(v, state) {
    $('h2', this.host).textContent = `Version ${verNum(v) || '—'}`;
    $('.tagline', this.host).textContent = v ? versionTag(v) : '';
    const b = $('.badge', this.host);
    b.className = 'badge ' + (state || '');
    b.innerHTML = state === 'ok' ? `${icon('check')}<span>passed</span>` : state === 'bad' ? `${icon('x')}<span>failed</span>` : state === 'wait' ? `${icon('loader')}<span>building…</span>` : '';
    icons();
  }
  empty(v, line, state) {
    const key = `${v}|${line}|${state || ''}`;
    if (!this.run && this.emptyKey === key) return;
    this.emptyKey = key; this.run = null; this.sig = ''; this.bench = null; this.version = v;
    this.head(v, state || ''); this.never.hidden = false; this.never.textContent = line;
    this.host.classList.add('isempty');
    this.replay?.clear(); this.replay?.onStamp(null); this.replay?.onCaption('', '');
    this.logEl.innerHTML = ''; this.benchEl.innerHTML = ''; this.liveDot.hidden = true;
    this.agentsEl.innerHTML = ''; this.knewEl.innerHTML = ''; this.agentSig = ''; this.knewSig = '';
    const other = cols[this.side === 'A' ? 'B' : 'A']; if (other?.run) other.renderKnew();
  }
  show(run, v, live) {
    const running = live && run.status !== 'done' && !run.inspection;
    const sig = `${v}|${run.run_id}|${(run.events || []).length}|${passed(run)}|${JSON.stringify(run.blueprint || null).length}|${running}`;
    const same = this.run && this.run.run_id === run.run_id && this.version === v;
    if (same && sig === this.sig) return false;
    const prevBp = same && this.run?.blueprint ? JSON.stringify(this.run.blueprint) : null;
    this.never.hidden = true; this.host.classList.remove('isempty'); this.emptyKey = null;
    this.run = run; this.sig = sig; this.version = v;
    this.head(v, running ? 'wait' : passed(run) ? 'ok' : 'bad');
    this.liveDot.hidden = !running;
    if (this.replay) { if (same && live) this.replay.follow(run); else { this.replay.load(run, live); this.replay.paused = false; } }
    // the log: append only what is new
    const have = same ? this.logEl.childElementCount : 0; if (!same) this.logEl.innerHTML = '';
    (run.events || []).slice(have).forEach((e, k) => {
      const li = el('li', e.type === 'fail' || e.type === 'spiral' ? 'bad' : e.type === 'pass' ? 'ok' : '');
      li.append(el('span', 'n', String(have + k + 1)), el('span', null, logLine(e, run))); this.logEl.append(li);
    });
    this.logEl.scrollTop = this.logEl.scrollHeight;
    const bp = run.blueprint ? JSON.stringify(run.blueprint) : null;
    if (!same || bp !== prevBp || !this.bench) {
      if (!bp && running) { this.benchEl.innerHTML = ''; this.benchEl.append(el('p', 'empty', 'The test bench appears once the team hands in a plan.')); this.bench = null; }
      else { this.bench = new Bench(this.benchEl, run); this.bench.onChange = (kind, b) => linkFrom(this, kind, b); }
    }
    this.renderAgents(run, running);
    this.renderKnew();
    const other = cols[this.side === 'A' ? 'B' : 'A']; if (other?.run) other.renderKnew();
    icons();
    return true;
  }
  /* who worked on this chip: one row per agent the team spawned, joined to the model call it made */
  renderAgents(run, running) {
    const spawns = (run.events || []).filter(e => e.type === 'spawn'), calls = run.calls || [];
    const sig = `${run.run_id}|${spawns.length}|${calls.length}|${running}`;
    if (sig === this.agentSig) return; this.agentSig = sig;
    const host = this.agentsEl; host.innerHTML = '';
    if (!spawns.length) { host.append(el('p', 'empty', running ? 'The planner is about to start.' : 'No agent record for this chip.')); return; }
    spawns.forEach((e, i) => {
      const c = calls[i], part = (e.agent || '').includes(':') ? (e.agent.split(':')[1] || '').replace(/_/g, ' ') : '';
      const who = (ROLE[e.role] || e.role || 'Agent') + (part ? ` · ${part}` : '');
      const model = /Lightning/i.test(e.model || '') ? 'Lightning 30B' : /Super/i.test(e.model || '') ? 'Super 120B' : (e.model || '').split('/').pop();
      const state = c ? (c.spiral ? 'stuck' : c.error ? 'error' : 'done') : (running && i === spawns.length - 1 ? 'working' : 'done');
      const row = el('div', 'agent ' + state);
      const stat = c ? `${Math.round(c.time_s || 0)} s · ${Math.round((c.thinking_chars || 0) / 1000)}k letters of thinking` : state === 'working' ? 'working…' : '';
      row.innerHTML = `<span class="ai">${icon(e.role === 'architect' ? 'route' : e.role === 'assembler' ? 'cable' : e.role === 'investigator' ? 'search' : 'puzzle')}</span>
        <span class="aw">${who}<small>${model}${stat ? ' · ' + stat : ''}</small></span>
        <span class="as">${state === 'stuck' ? 'got stuck' : state === 'error' ? 'hit an error' : state === 'working' ? 'working…' : 'done'}</span>`;
      host.append(row);
    });
  }
  /* the lessons and shelf parts this version read before working, with the ones that answered a failure called out */
  renderKnew() {
    const run = this.run, v = this.version; if (!run || !v) return;
    const other = cols[this.side === 'A' ? 'B' : 'A'], orun = other?.run && other.run.run_id !== run.run_id ? other.run : null;
    const sn = S.snaps[v], ids = sn?.playbook || [], libL = S.lib?.lessons || [];
    const lessons = ids.map(id => libL.find(l => l.id === id)).filter(Boolean);
    const parts = sn?.library || [];
    const cats = evs => new Set((evs || []).filter(e => e.type === 'fail').map(e => e.category).concat((evs || []).some(e => e.type === 'spiral') ? ['spiral'] : []));
    const theirs = orun ? cats(orun.events) : new Set(), mine = cats(run.events);
    const used = new Set((run.blueprint?.instances || []).map(i => i.part));
    const sig = `${run.run_id}|${v}|${ids.join()}|${parts.join()}|${[...theirs].join()}|${[...mine].join()}|${passed(run)}|${libL.length}`;
    if (sig === this.knewSig) return; this.knewSig = sig;
    const host = this.knewEl; host.innerHTML = '';
    if (!sn && verNum(v) !== 1 && !libL.length) { host.append(el('p', 'empty', 'Lesson records for this version are not loaded.')); return; }
    if (!lessons.length && !parts.length) { host.append(el('p', 'empty', 'Started with an empty notebook: no lessons, nothing on the shelf.')); return; }
    const ul = el('ul', 'lessons'), groups = new Map();           // one line per kind of lesson, not per lesson
    lessons.forEach(l => { const g = groups.get(l.category) || { n: 0, hits: 0, cat: l.category, pitfall: l.pitfall }; g.n++; g.hits += l.hits || 0; groups.set(l.category, g); });
    [...groups.values()].sort((a, b) => b.hits - a.hits).forEach(g => {
      const helped = passed(run) && (theirs.has(g.cat) || mine.has(g.cat));
      const li = el('li', helped ? 'helped' : '');
      let why = '';
      if (helped && theirs.has(g.cat)) why = `${vlabel(other.version)} ${g.cat === 'spiral' ? 'got stuck thinking' : 'hit this'} on this very order`;
      else if (helped) why = `this chip ${g.cat === 'spiral' ? 'got stuck' : 'hit this'} on an early try, then got it right`;
      li.innerHTML = `<span class="li">${icon(helped ? 'check' : 'book-open')}</span><span>${LESSON_PLAIN[g.cat] || g.pitfall}<small> · ${g.n > 1 ? g.n + ' lessons' : '1 lesson'}${g.hits ? `, used ${g.hits}×` : ''}</small>${why ? `<em>helped: ${why}</em>` : ''}</span>`;
      ul.append(li);
    });
    if (lessons.length) host.append(ul);
    if (parts.length) {
      const row = el('div', 'shelf'), byLabel = new Map();
      row.append(el('span', 'sl', 'On the shelf:'));
      parts.forEach(id => { const k = partLabel(id), g = byLabel.get(k) || { n: 0, used: false }; g.n++; g.used = g.used || used.has(id); byLabel.set(k, g); });
      byLabel.forEach((g, k) => { const c = el('span', 'part' + (g.used ? ' used' : '')); c.innerHTML = `${icon('package')}${k}${g.n > 1 ? ` ×${g.n}` : ''}${g.used ? '<small>used here</small>' : ''}`; row.append(c); });
      host.append(row);
    }
    if (!lessons.length && verNum(v) === 1) host.prepend(el('p', 'empty', 'No lessons yet: the bare team.'));
  }
}
const cols = {};
function linkFrom(col, kind, b) {
  if (!S.link) return;
  const other = col === cols.A ? cols.B : cols.A;
  if (!other.bench || other.bench.dead) return;
  other.bench.quiet = true;
  try { other.bench.follow(kind, b); } finally { other.bench.quiet = false; }
}

/* ───────── verdict ───────── */
function sideWords(col) {
  const v = vlabel(col.version), r = col.run;
  if (!r) return { line: S.mode === 'own' ? `${v} still building…` : `${v} never built this one` };
  const ins = r.inspection, tries = r.attempts || (r.events || []).filter(e => e.type === 'retry').length + 1;
  if (!ins && r.status !== 'done') return { line: `${v} still building…` };
  if (!ins) return { line: `${v} handed nothing in` };
  const c = ins.correct || {}, gates = ins.gates || 0;
  let line;
  if (ins.pass) line = `${v} right on all ${c.total ?? ''}`.trim();
  else if (!r.blueprint) line = `${v} handed in no chip`;
  else if (c.total) line = `${v} wrong on ${c.total - (c.passed || 0)} of ${c.total} answers`;
  else line = `${v} never got a working chip`;
  if (!ins.pass && tries >= 3) line += `, gave up after ${tries} tries`;
  return { line, gates: gates > 0 ? gates : null, v };
}
function renderVerdict() {
  const host = $('#verdict');
  if (!cols.A.version && !cols.B.version) { host.textContent = 'Pick an order to compare.'; return; }
  const a = sideWords(cols.A), b = sideWords(cols.B), parts = [a.line, b.line];
  const g = [a, b].filter(x => x.gates).sort((x, y) => x.gates - y.gates);
  if (g.length === 2 && g[0].v !== g[1].v) parts.push(`${g[0].v} used ${g[0].gates} blocks, ${g[1].v} used ${g[1].gates}`);
  else if (g.length === 2) parts.push(`each used ${g[0].gates === g[1].gates ? g[0].gates : g[0].gates + ' and ' + g[1].gates} blocks`);
  else if (g.length === 1) parts.push(`${g[0].v} used ${g[0].gates} blocks`);
  host.textContent = parts.join(' · ');
}

/* ───────── order box ───────── */
function fillVersions() {
  const vs = versionsWithExam(S.data), key = vs.join(',');
  if (key === S.vkey) return; S.vkey = key;
  const want = { A: S.vA || params.get('a'), B: S.vB || params.get('b') };
  ['A', 'B'].forEach(side => {
    const sel = $('#ver' + side); sel.innerHTML = '';
    vs.forEach(v => { const o = el('option', null, `Version ${verNum(v)}`); o.value = v; sel.append(o); });
    const pick = vs.find(v => v === want[side] || vlabel(v) === want[side]) || (side === 'A' ? vs[0] : vs[vs.length - 1]);
    if (pick) sel.value = pick;
  });
  S.vA = $('#verA').value || null; S.vB = $('#verB').value || null;
}
function renderPills() {
  const host = $('#pills'), list = pastOrders(); host.innerHTML = '';
  list.forEach(o => {
    const { nm, ic, extra } = pillWords(o.title);
    const b = el('button', 'pillbtn' + (S.mode === 'past' && S.orderId === o.id ? ' on' : '')); b.type = 'button'; b.title = o.title || o.id;
    b.innerHTML = `${icon(ic)}<b></b><span></span>`; b.querySelector('b').textContent = nm; b.querySelector('span').textContent = extra;
    b.addEventListener('click', () => { S.mode = 'past'; S.orderId = o.id; $('#orderIn').value = o.title || o.id; $('#ownNote').innerHTML = ''; renderPills(); showPast(); });
    host.append(b);
  });
  if (!list.length) host.append(el('p', 'empty', 'No past orders yet. The exam has not run.'));
  icons();
}
function syncUrl() {
  const u = new URL(location.href);
  if (S.mode === 'past' && S.orderId) u.searchParams.set('order', S.orderId); else u.searchParams.delete('order');
  if (S.vA) u.searchParams.set('a', vlabel(S.vA));
  if (S.vB) u.searchParams.set('b', vlabel(S.vB));
  history.replaceState(null, '', u);
}
function orderTitle(id) { return pastOrders().find(o => o.id === id)?.title || id; }
function showPast() {
  const pool = runPool(), t = orderTitle(S.orderId);
  $('#orderTitle').textContent = S.orderId ? `${chipName(t)[0]} · ${chipDesc(t)}` : '';
  [['A', S.vA], ['B', S.vB]].forEach(([side, v]) => {
    const r = v && S.orderId ? pool[v]?.[S.orderId] : null;
    if (r) cols[side].show(r, v, false); else cols[side].empty(v, `${vlabel(v)} never built this one`);
  });
  renderVerdict(); syncUrl();
}
function showOwn() {
  const d = S.data || {}, own = S.own; if (!own) return;
  $('#orderTitle').textContent = `Your order · ${own.note}`;
  [['A', S.vA], ['B', S.vB]].forEach(([side, v]) => {
    const id = own.ids[side];
    const r = d.live_runs?.[id] || (d.live?.run_id === id ? d.live : null);
    if (r) cols[side].show({ version: v, ...r }, v, true);
    else cols[side].empty(v, `${vlabel(v)} is waiting for the factory to pick the order up…`, 'wait');
  });
  renderVerdict(); syncUrl();
}
async function buildBoth(ev) {
  ev?.preventDefault();
  S.vA = $('#verA').value; S.vB = $('#verB').value;
  const note = $('#orderIn').value.trim(), msg = $('#ownNote');
  const match = pastOrders().find(o => (o.title || '').toLowerCase() === note.toLowerCase() || o.id === note);
  if (match) { S.mode = 'past'; S.orderId = match.id; msg.innerHTML = ''; renderPills(); showPast(); return; }
  if (!note) { msg.textContent = 'Pick a past order, or type what you want built.'; return; }
  if (!S.apiMode) {
    msg.innerHTML = '<span>The order server isn’t running here, so new orders can’t be built right now.</span>';
    const b = el('button', 'btn small'); b.type = 'button'; b.innerHTML = icon('history') + '<span>Show a past order instead</span>';
    b.addEventListener('click', () => { const o = pastOrders()[0]; if (!o) return; S.mode = 'past'; S.orderId = S.orderId || o.id; $('#orderIn').value = orderTitle(S.orderId); msg.innerHTML = ''; renderPills(); showPast(); });
    msg.append(b); icons(); return;
  }
  msg.textContent = 'Sending the order to both versions…';
  try {
    const send = async v => { const r = await fetch('/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note, version: v }) });
      if (!r.ok) throw new Error('refused'); const j = await r.json(); if (!j.run_id) throw new Error('no id'); return j.run_id; };
    const [ia, ib] = await Promise.all([send(S.vA), send(S.vB)]);
    S.mode = 'own'; S.own = { note, ids: { A: ia, B: ib } }; S.orderId = null;
    msg.textContent = `Ordered from ${vlabel(S.vA)} and ${vlabel(S.vB)}. Both start in a moment.`;
    renderPills(); showOwn();
  } catch (e) { msg.textContent = 'The order didn’t go through. Try again in a moment.'; }
}

/* ═════════ data ═════════ */
async function detectMode() {
  if (params.get('data') === 'sample') return false;
  try { const r = await fetch(location.href, { method: 'GET', cache: 'no-store' });
    if (/SimpleHTTP|http\.server/i.test(r.headers.get('server') || '')) return false; } catch (e) { /* offline */ }
  return true;
}
async function getText(u) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.text(); } catch (e) { /* next */ } return null; }
async function getJSON(u) { const t = await getText(u); if (!t) return null; try { return JSON.parse(t); } catch (e) { return null; } }
async function loadExtras() {
  if (!S.apiMode) return;                 // under http.server these are not served; skip them (no 404s in the console)
  const [menu, lib] = await Promise.all([getJSON('/menu.json'), getJSON('/library.json')]);
  if (Array.isArray(menu)) S.menu = menu;
  if (lib) S.lib = { parts: lib.parts || {}, lessons: lib.lessons || [] };
}
async function loadSnaps() {
  if (!S.apiMode) return;
  const vs = versionsWithExam(S.data).filter(v => !(v in S.snaps));
  await Promise.all(vs.map(async v => { S.snaps[v] = await getJSON(`/snapshots/${vlabel(v)}.json`); }));
}
async function poll() {
  let text = null;
  for (const u of S.apiMode ? ['/run.json', SAMPLE] : [SAMPLE]) { text = await getText(u); if (text) break; }
  if (!text || text === S.lastText) return false;
  let d; try { d = JSON.parse(text); } catch (e) { return false; }
  S.lastText = text; S.data = d;
  fillVersions(); renderPills();
  if (S.mode === 'own') showOwn(); else if (S.orderId) showPast();
  return true;
}

/* ═════════ boot ═════════ */
async function boot() {
  icons();
  cols.A = new Column('A'); cols.B = new Column('B');
  window.__autofab = { S, cols };
  $('#orderForm').addEventListener('submit', buildBoth);
  ['A', 'B'].forEach(side => $('#ver' + side).addEventListener('change', () => {
    S.vA = $('#verA').value; S.vB = $('#verB').value;
    if (S.mode === 'past' && S.orderId) showPast(); else syncUrl();
  }));
  $('#orderIn').addEventListener('input', () => {
    const t = $('#orderIn').value.trim().toLowerCase();
    if (S.orderId && t !== String(orderTitle(S.orderId)).toLowerCase()) $('#pills .on')?.classList.remove('on');
  });
  $('#link').addEventListener('change', e => { S.link = e.target.checked; if (S.link && cols.A.bench && cols.B.bench) linkFrom(cols.A, 'inputs', cols.A.bench); });
  $('#back').addEventListener('click', async e => {             // dash.html when it exists, else home.html
    e.preventDefault();
    try { const r = await fetch('dash.html', { method: 'HEAD', cache: 'no-store' }); location.href = r.ok ? 'dash.html' : 'home.html'; } catch (er) { location.href = 'home.html'; }
  });

  S.apiMode = await detectMode();
  if (!S.apiMode) S.extra = await getJSON(LIVE_FB);
  await loadExtras();
  await poll();
  await loadSnaps();
  // first view: ?order=…, else the sample's calculator demo pair, else the first past order both versions built
  const list = pastOrders(), pool = runPool(), want = params.get('order');
  let pick = want && list.find(o => o.id === want);
  if (!pick && !S.apiMode) pick = list.find(o => pool[S.vA]?.[o.id] && /^calculator/i.test(o.title || '')) || null;
  if (!pick) pick = list.find(o => pool[S.vA]?.[o.id] && pool[S.vB]?.[o.id]) || list.find(o => pool[S.vA]?.[o.id] || pool[S.vB]?.[o.id]) || list[0];
  if (pick) { S.mode = 'past'; S.orderId = pick.id; $('#orderIn').value = pick.title || pick.id; renderPills(); showPast(); }
  else renderVerdict();
  if (S.apiMode) [cols.A, cols.B].forEach(c => c.head(c.version, c.run ? (passed(c.run) ? 'ok' : 'bad') : ''));
  setInterval(poll, 2000);
  if (S.apiMode) setInterval(async () => { await loadExtras(); await loadSnaps(); }, 15000);
  let last = performance.now();
  const step = () => { const now = performance.now(), dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now; cols.A.replay?.tick(dt); cols.B.replay?.tick(dt); };
  const loop = () => { step(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => { if (performance.now() - last > 300) step(); }, 120);
}
boot();
