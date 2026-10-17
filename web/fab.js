/* AutoFab · Fab — the main dashboard (warm glass theme, one amber accent).
   Board (3D), Schematic, flatten/simulate, TestBench, synthEvents and describe() are copied from web/ops.js
   (itself copied from present.js); do not edit them there. Every number shown comes from run.json or /library.json. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ───────────────────────── helpers ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };
const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const verNum = v => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
const params = new URLSearchParams(location.search);
const S = { lights: false, data: null, chips: [], chip: null, apiMode: null, lastText: '', extra: null, lib: null, team: null,
  tab: '3d', ver: 'all', cmpA: null, cmpB: null, link: true, chipSig: '', view: 'fab', watch: null };

/* ───────────────────────── 3D board (from web/index.html) ───────────────────────── */
// The composer clears a linear target and OutputPass encodes again, so the clear colour must be pre-decoded twice
const dec = v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
const clearCol = hex => new THREE.Color().setRGB(...[(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => dec(dec(v / 255))), THREE.LinearSRGBColorSpace);
const BG = clearCol(0x0e0b08), BG_DARK = clearCol(0x020305);
const BLACK = new THREE.Color(0, 0, 0), BLOOM = 1;
const COL = { build: '#f5b847', pass: '#8ee36b', fail: '#ff6b6b', repair: '#ffd27a', lit: '#ffe6a8', pad: '#8a6a3a' };
const TRACE = { build: '#ffd27a', calm: '#9a7a48', bad: '#ff6b6b', repair: '#ffd27a', pass: '#6fbf52' };
const SIZE = { part: { w: 2.3, h: .8, d: 1.5, sx: 3.6, sz: 3.0, per: 5 },
               gate: { w: 1.5, h: .6, d: 1.05, sx: 2.5, sz: 2.1, per: 7 },
               result: { w: 4.4, h: .7, d: 1.5 } };
const MIN_GAP = { order: .6, spawn: .2, plan: .8, place: .5, wire: .3, test: 2.0, fail: 1.4, retry: .9,
                  pass: 1.2, lesson: 1.0, spiral: 1.0, human_ping: 1.0, done: .5 };
const GAP_CAP = 3, GAP_CAP_SPIRAL = 5, Y_TRACE = .05;
const portOff = p => { let h = 7; for (const c of String(p)) h = (h * 31 + c.charCodeAt(0)) | 0; return (((h % 5) + 5) % 5 - 2) * .22; };
const laneOff = i => ((i % 5) - 2) * .13;

function effTimes(events) {        // pacing only: caps long waits, spaces events out so each animation is visible
  const out = []; let e = 0;
  events.forEach((ev, i) => {
    if (i) {
      const prev = events[i - 1], gap = Math.max(0, (ev.t ?? 0) - (prev.t ?? 0));
      const cap = ev.type === 'spiral' ? GAP_CAP_SPIRAL : GAP_CAP;
      e += Math.max(Math.min(gap, cap), MIN_GAP[prev.type] ?? .2);
    }
    out.push(e);
  });
  return out;
}
const disposeTree = o => o.traverse(c => { c.geometry?.dispose?.(); c.material?.dispose?.(); if (c.isCSS2DObject) c.element.remove(); });

class Board {
  constructor(host) {
    this.host = host; host.innerHTML = '';
    this.gl = el('div', 'gl'); this.labels = el('div', 'labels');
    host.append(this.gl);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.bg = S.lights ? BG_DARK : BG;
    this.renderer.setClearColor(this.bg, 1);
    this.gl.append(this.renderer.domElement);
    this.labelR = new CSS2DRenderer({ element: this.labels }); this.gl.append(this.labels);

    this.scene = new THREE.Scene();
    this.S = 8; this.camera = new THREE.OrthographicCamera(-this.S, this.S, this.S, -this.S, .1, 200);
    this.camDir = new THREE.Vector3(1, 1, 1).normalize();
    this.camera.position.copy(this.camDir).multiplyScalar(40); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false; this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * .47;
    this.controls.minZoom = .3; this.controls.maxZoom = 8;
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.scene.add(new THREE.HemisphereLight(0xffe2b8, 0x120c08, .9));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(6, 12, 4); this.scene.add(dl);

    // board group: rotated 45° about Y so local +x reads left→right on screen under the (1,1,1) iso camera
    this.group = new THREE.Group(); this.group.rotation.y = Math.PI / 4; this.scene.add(this.group);
    const slab = new THREE.Mesh(new RoundedBoxGeometry(46, .5, 30, 3, .1),
      new THREE.MeshStandardMaterial({ color: 0x1a130d, roughness: .9, metalness: 0 }));
    slab.position.set(8, -.27, 2); this.group.add(slab);
    const grid = new THREE.GridHelper(44, 44, 0x3a2a18, 0x241a10); grid.position.set(8, 0, 2);
    grid.scale.z = 30 / 44; this.group.add(grid);
    this.content = new THREE.Group(); this.group.add(this.content);

    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, .06, 12, 64), new THREE.MeshBasicMaterial({ color: COL.lit, toneMapped: false }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = .1; this.ring.layers.enable(BLOOM); this.ring.visible = false; this.group.add(this.ring);
    this.pulseMesh = new THREE.Mesh(new THREE.SphereGeometry(.24, 20, 16), new THREE.MeshBasicMaterial({ color: COL.lit, toneMapped: false }));
    this.pulseMesh.layers.enable(BLOOM); this.pulseMesh.visible = false; this.group.add(this.pulseMesh);

    this.nowMs = 0; this.onEvent = null;
    this.initPost();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.gl);
    this.resetScene(); this.resize();
  }
  setLights(on) { this.bg = on ? BG_DARK : BG; this.bloomPass.strength = on ? .65 : .5; }

  initPost() {
    const r = this.renderer;
    this.bloomLayer = new THREE.Layers(); this.bloomLayer.set(BLOOM);
    this.darkMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.stash = new Map();
    this.bloomComposer = new EffectComposer(r); this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), S.lights ? .65 : .5, .35, .05);
    this.bloomComposer.addPass(this.bloomPass);
    const mix = new ShaderPass(new THREE.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: this.bloomComposer.renderTarget2.texture } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D baseTexture;uniform sampler2D bloomTexture;varying vec2 vUv;' +
        'void main(){gl_FragColor=texture2D(baseTexture,vUv)+texture2D(bloomTexture,vUv);}' }), 'baseTexture');
    mix.needsSwap = true;
    this.finalComposer = new EffectComposer(r);
    this.finalComposer.addPass(new RenderPass(this.scene, this.camera));
    this.finalComposer.addPass(mix);
    this.finalComposer.addPass(new OutputPass());
  }
  darken(o) {
    if (o.isMesh && !o.isLine2 && !this.bloomLayer.test(o.layers)) { this.stash.set(o, o.material); o.material = this.darkMat; }
    else if ((o.isLine || o.isLineSegments || o.isLine2) && !this.bloomLayer.test(o.layers)) { this.stash.set(o, o.visible); o.visible = false; }
  }
  restore() { this.stash.forEach((v, o) => { if (typeof v === 'boolean') o.visible = v; else o.material = v; }); this.stash.clear(); }
  render() {
    this.renderer.setClearColor(BLACK, 1);
    this.scene.traverse(o => this.darken(o));
    this.bloomComposer.render();
    this.restore();
    this.renderer.setClearColor(this.bg, 1);
    this.finalComposer.render();
    this.labelR.render(this.scene, this.camera);
  }
  resize() {
    const w = this.gl.clientWidth, h = this.gl.clientHeight; if (w < 4 || h < 4) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.bloomComposer.setSize(w, h); this.finalComposer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    this.labelR.setSize(w, h);
    const a = w / h; this.camera.left = -this.S * a; this.camera.right = this.S * a; this.camera.top = this.S; this.camera.bottom = -this.S;
    this.camera.updateProjectionMatrix();
    this.content.traverse(o => { if (o.isLine2) o.material.resolution.set(w, h); });
    this.fitDirty = true;
  }

  resetScene() {
    while (this.content.children.length) disposeTree(this.content.children.pop());
    this.labels.innerHTML = '';
    this.blocks = new Map(); this.slotOf = new Map(); this.nextSlot = 0; this.planned = []; this.kind = 'part';
    this.result = null; this.pads = new Map(); this.wires = []; this.pulse = null;
    this.attempt = 1; this.pendingDesigners = 0; this.liveSpiral = false; this.bounds = null; this.redesign = false;
    this.ring.visible = false; this.pulseMesh.visible = false;
    this.fitDirty = true; this.userMoved = false; this.testEv = null;
  }

  /* play events [0, end); events before `start` are applied at once (the order scene already told that part) */
  play(run, { start = 0, end } = {}) {
    this.run = run;
    this.resetScene();
    const all = run.events || [];
    this.events = all.slice(0, end == null ? all.length : end);
    const eff = effTimes(this.events), s = Math.min(start, eff.length);
    const off = s > 0 ? eff[s - 1] : 0;
    this.eff = eff.map(t => Math.max(0, t - off));
    this.endVt = this.eff.length ? this.eff[this.eff.length - 1] : 0;
    this.vt = 0; this.idx = 0; this.finished = !this.events.length; this.lastT = 0; this.waitSpiral = null;
    this.verdict = {};
    all.forEach(ev => { if (ev.type === 'pass' || ev.type === 'fail') this.verdict[ev.attempt ?? 1] = ev.type; });
  }
  get progress() { return this.endVt ? clamp(this.vt / this.endVt, 0, 1) : (this.finished ? 1 : 0); }
  get settled() { return this.finished && !this.pulse; }
  tick(dt, speed) {
    this.nowMs += dt * 1000;
    const dv = dt * speed;
    if (this.events && !this.finished) {
      this.vt += dv;
      while (this.idx < this.events.length && this.eff[this.idx] <= this.vt) this.apply(this.events[this.idx++]);
      if (this.idx >= this.events.length) this.finished = true;
      const nx = this.events[this.idx];
      if (nx && nx.type === 'spiral' && this.idx > 0) {
        const a = this.eff[this.idx - 1], b = this.eff[this.idx];
        this.waitSpiral = { p: Math.min(1, (this.vt - a) / Math.max(.01, b - a)) };
      } else this.waitSpiral = null;
    }
    this.animate(dt, dv);
  }

  apply(ev) {
    this.lastT = ev.t ?? this.lastT;
    switch (ev.type) {
      case 'spawn': if (ev.role === 'designer') this.pendingDesigners++; this.updateRing(); break;
      case 'plan':
        this.planned = ev.parts || []; this.planned.forEach(n => this.slot(n));
        this.ensureResult(); this.relayout(); break;
      case 'place': this.place(ev); break;
      case 'wire': this.addWire(ev); break;
      case 'test': this.startTest(ev); break;
      case 'fail': this.fail(ev); break;
      case 'retry': this.retry(ev); break;
      case 'pass': this.passed(ev); break;
      case 'spiral': this.liveSpiral = true; this.updateRing(); break;
      case 'done': this.finish(); break;
    }
    this.onEvent?.(ev, this);
  }
  slot(name) { if (!this.slotOf.has(name)) this.slotOf.set(name, this.nextSlot++); return this.slotOf.get(name); }
  realCount() { return this.blocks.size - (this.result ? 1 : 0); }
  updateRing() { this.ring.visible = this.realCount() === 0 && this.pendingDesigners > 0;
    this.ring.material.color.set(this.liveSpiral ? COL.fail : COL.lit); }

  dropBlock(name) { const b = this.blocks.get(name); if (!b) return; this.content.remove(b.mesh); disposeTree(b.mesh); this.blocks.delete(name); }
  clearDesign() {          // a retry that re-places blocks is a new design: clear the old one
    [...this.blocks.keys()].forEach(n => { if (n !== 'RESULT') this.dropBlock(n); });
    this.wires.forEach(w => this.killWire(w)); this.wires = [];
    this.pads.forEach(p => { this.content.remove(p.mesh); disposeTree(p.mesh); }); this.pads.clear();
  }
  place(ev) {
    const kind = ev.kind === 'gate' ? 'gate' : 'part';
    if (this.blocks.has(ev.block)) { if (this.redesign) this.clearDesign(); else this.dropBlock(ev.block); }
    this.redesign = false;
    if (this.realCount() === 0) this.kind = kind;
    this.pendingDesigners = Math.max(0, this.pendingDesigners - 1);
    const b = this.makeBlock(ev.block, kind, ev.label || ev.block);
    b.slot = this.slot(ev.block); b.born = this.nowMs;
    this.blocks.set(ev.block, b);
    this.ensureResult(); this.relayout(); this.updateRing();
  }
  ensureResult() {
    if (this.result) return;
    const b = this.makeBlock('RESULT', 'result', 'RESULT'); b.born = this.nowMs; b.isResult = true;
    this.result = b; this.blocks.set('RESULT', b);
    b.label.element.className = 'lbl result';
  }
  makeBlock(name, kind, label) {
    const sp = SIZE[kind];
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: new THREE.Color(COL.build), emissiveIntensity: 2,
      toneMapped: false, roughness: .45, metalness: .15 });
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(sp.w, sp.h, sp.d, 4, .14), mat);
    mesh.layers.enable(BLOOM); mesh.scale.setScalar(1.4); mesh.position.y = sp.h / 2 + 1.2;
    const lab = new CSS2DObject(el('div', 'lbl' + (kind === 'gate' ? ' small' : ''), label));
    lab.position.set(0, sp.h / 2 + .25, 0); mesh.add(lab);
    this.content.add(mesh);
    return { name, kind, sp, mesh, mat, label: lab, state: 'build', cur: new THREE.Color(COL.build), lit: 0, born: 0, pos: new THREE.Vector3(), slot: -1 };
  }
  cellPos(b) { const S2 = SIZE[this.kind]; return { x: (b.slot % S2.per) * S2.sx, z: Math.floor(b.slot / S2.per) * S2.sz }; }
  relayout() {
    const S2 = SIZE[this.kind];
    let maxCol = 0, maxRow = 0;
    this.blocks.forEach(b => { if (b.isResult) return; const c = this.cellPos(b); b.pos.set(c.x, 0, c.z);
      maxCol = Math.max(maxCol, b.slot % S2.per); maxRow = Math.max(maxRow, Math.floor(b.slot / S2.per)); });
    this.slotOf.forEach(s => { maxCol = Math.max(maxCol, s % S2.per); maxRow = Math.max(maxRow, Math.floor(s / S2.per)); });
    this.cols = maxCol + 1; this.rows = maxRow + 1;
    if (this.result) this.result.pos.set(this.cols * S2.sx + 1.2, 0, 0);
    this.blocks.forEach(b => { b.mesh.position.x = b.pos.x; b.mesh.position.z = b.pos.z; });
    this.rebuildPads(); this.rebuildTraces(); this.computeBounds();
  }

  isOut(sig) { return (this.run.order?.outputs || []).includes(sig); }
  endpoint(tok) {
    const [a, p] = String(tok).split('.');
    if (p !== undefined && this.blocks.has(a) && a !== 'RESULT') return { kind: 'pin', b: this.blocks.get(a), port: p };
    return { kind: 'pad', sig: tok };
  }
  padFor(sig, io, anchor) {
    let p = this.pads.get(sig); if (p) return p;
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(.9, .22, .5, 3, .06),
      new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: new THREE.Color(COL.pad), emissiveIntensity: 2, toneMapped: false }));
    mesh.layers.enable(BLOOM);
    const lab = new CSS2DObject(el('div', 'lbl pad', sig)); lab.position.set(0, .35, 0); mesh.add(lab);
    this.content.add(mesh);
    const same = [...this.pads.values()].filter(q => q.io === io);
    let x = anchor + portOff(sig) * 2, tries = 0;
    while (same.some(q => Math.abs(q.x - x) < .95) && tries++ < 40) x += .95;
    p = { sig, io, mesh, x, z: 0 }; this.pads.set(sig, p); return p;
  }
  rebuildPads() {
    const S2 = SIZE[this.kind], d = S2.d;
    const back = -d / 2 - 1.9, front = (this.rows - 1) * S2.sz + d / 2 + 1.9;
    this.pads.forEach(p => { p.z = p.io === 'in' ? back : front; p.mesh.position.set(p.x, .11, p.z); });
  }

  addWire(ev) {
    const to = this.endpoint(ev.to), fr = this.endpoint(ev.from);
    if (to.kind === 'pad' && fr.kind === 'pad') return;
    // repairing: a new wire into a pin wired in an earlier attempt replaces the old one
    const old = this.wires.findIndex(w => w.to === ev.to && w.attempt < this.attempt);
    let repair = false;
    if (old >= 0) { this.killWire(this.wires[old]); this.wires.splice(old, 1); repair = true; }
    if (fr.kind === 'pad') this.padFor(fr.sig, this.isOut(fr.sig) ? 'out' : 'in', to.kind === 'pin' ? to.b.pos.x : 0);
    if (to.kind === 'pad') this.padFor(to.sig, this.isOut(to.sig) ? 'out' : 'in', fr.kind === 'pin' ? fr.b.pos.x : 0);
    this.wires.push({ from: ev.from, to: ev.to, fr, tn: to, lane: this.wires.length, state: repair ? 'repair' : 'build', line: null,
      attempt: this.attempt, born: this.nowMs, prog: 0, color: new THREE.Color(repair ? TRACE.repair : TRACE.build), width: 3, pts: null });
    this.relayout();
  }
  killWire(w) { if (w.line) { this.content.remove(w.line); w.line.geometry.dispose(); w.line.material.dispose(); w.line = null; } }
  pinPos(e, side) { const b = e.b, z = b.pos.z + portOff(e.port); return side === 'L' ? [b.pos.x - b.sp.w / 2, z] : [b.pos.x + b.sp.w / 2, z]; }
  route(w) {
    const S2 = SIZE[this.kind], f = w.fr, t = w.tn, ln = w.lane, lo = laneOff(ln);
    const y = Y_TRACE, P = [], push = (x, z) => P.push([x, y, z]);
    if (f.kind === 'pin' && t.kind === 'pin') {
      const [sx, sz] = this.pinPos(f, 'R'), [tx, tz] = this.pinPos(t, 'L');
      const g1 = f.b.pos.x + S2.sx / 2 + lo, g2 = t.b.pos.x - S2.sx / 2 + lo;
      push(sx, sz);
      if (Math.abs(g1 - g2) < .01 && f.b.pos.z === t.b.pos.z) { push(g1, sz); push(g1, tz); }
      else { const zc = t.b.pos.z + t.b.sp.d / 2 + .5 + Math.abs(lo); push(g1, sz); push(g1, zc); push(g2, zc); push(g2, tz); }
      push(tx, tz);
    } else if (f.kind === 'pad') {
      const p = this.pads.get(f.sig), [tx, tz] = this.pinPos(t, 'L');
      const lane = p.z + .6 + Math.abs(lo) * 2 + (ln % 4) * .14, g = t.b.pos.x - S2.sx / 2 + lo;
      push(p.x, p.z + .25); push(p.x, lane); push(g, lane); push(g, tz); push(tx, tz);
    } else {
      const p = this.pads.get(t.sig), [sx, sz] = this.pinPos(f, 'R');
      const g = f.b.pos.x + S2.sx / 2 + lo, lane = p.z - .6 - (ln % 4) * .14;
      push(sx, sz); push(g, sz); push(g, lane); push(p.x, lane); push(p.x, p.z - .25);
    }
    return P;
  }
  densify(P) {
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / .12));
      for (let k = 0; k < n; k++) out.push(a[0] + (b[0] - a[0]) * k / n, a[1], a[2] + (b[2] - a[2]) * k / n);
    }
    const l = P[P.length - 1]; out.push(l[0], l[1], l[2]);
    return out;
  }
  rebuildTraces() {
    this.wires.forEach(w => {
      this.killWire(w);
      if ((w.fr.kind === 'pad' && !this.pads.has(w.fr.sig)) || (w.tn.kind === 'pad' && !this.pads.has(w.tn.sig))) return;
      w.pts = this.densify(this.route(w));
      const g = new LineGeometry(); g.setPositions(w.pts);
      const m = new LineMaterial({ color: w.color.getHex(), linewidth: w.width, worldUnits: false, toneMapped: false });
      m.resolution.set(this.w || 100, this.h || 100);
      w.nseg = w.pts.length / 3 - 1;
      w.line = new Line2(g, m); w.line.layers.enable(BLOOM); w.line.frustumCulled = false;
      g.instanceCount = Math.max(0, Math.ceil(w.nseg * w.prog));
      this.content.add(w.line);
    });
  }
  setWire(w, st) { w.state = st; w.width = st === 'bad' ? 5 : 3; if (w.line) w.line.material.linewidth = w.width; }

  startTest(ev) {
    this.ensureResult(); this.relayout();
    this.blocks.forEach(b => { if (!b.isResult) b.state = 'build'; });
    this.wires.forEach(w => { if (w.state === 'bad' || w.state === 'repair') this.setWire(w, 'calm'); });
    this.result.state = 'build'; this.result.label.element.className = 'lbl result';
    this.result.label.element.textContent = 'testing…';
    const pts = []; [...this.blocks.values()].filter(b => !b.isResult).sort((a, c) => a.slot - c.slot).forEach(b =>
      pts.push(new THREE.Vector3(b.pos.x, 1.35, b.pos.z)));
    pts.push(new THREE.Vector3(this.result.pos.x, 1.35, this.result.pos.z));
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    this.pulse = { path: pts.length > 1 ? path : null, u: 0, dur: 1.7, ev };
    this.pulseMesh.visible = !!this.pulse.path;
    this.testEv = ev;
    if (!this.pulse.path) { this.pulse = null; this.showResult(ev); }
    this.attempt = ev.attempt || this.attempt;
  }
  fmtInputs(ev) {
    const v = Object.values(ev.inputs || {});
    return (this.run.order?.rung === 1 && v.length === 2) ? `${v[0]} + ${v[1]}` : v.length ? v.join(', ') : 'test';
  }
  showResult(ev) {
    const v = ev.expected != null ? (ev.got === ev.expected ? 'pass' : 'fail') : this.verdict[ev.attempt ?? 1];
    const r = this.result.label.element;
    r.textContent = (ev.summary || `${this.fmtInputs(ev)} = ${ev.got ?? '?'}`) + (v === 'pass' ? ' ✓' : v === 'fail' ? ' ✗' : '');
    r.className = 'lbl result ' + (v === 'pass' ? 'ok' : v === 'fail' ? 'bad' : '');
    this.result.state = v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : 'build';
  }
  fail(ev) {
    if (this.testEv && this.testEv.attempt === ev.attempt && this.pulse) { this.pulse = null; this.pulseMesh.visible = false; this.showResult(this.testEv); }
    if (this.result && this.result.state !== 'fail') this.result.state = 'fail';
    (ev.bad_blocks || []).forEach(n => { const b = this.blocks.get(n); if (b) b.state = 'fail'; });
    const bad = new Set((ev.bad_wires || []).map(p => p.join('|')));
    this.wires.forEach(w => { if (bad.has(w.from + '|' + w.to)) this.setWire(w, 'bad'); });
    this.attempt = ev.attempt || this.attempt;
    if (this.realCount() === 0 && this.result) { const r = this.result.label.element; r.textContent = 'no answer ✗'; r.className = 'lbl result bad'; }
    if (!(ev.bad_blocks || []).length) { this.liveSpiral = true; this.updateRing(); }
  }
  retry(ev) {
    this.attempt = ev.attempt || this.attempt + 1; this.redesign = true;
    this.blocks.forEach(b => { if (b.state === 'fail' && !b.isResult) b.state = 'repair'; });
    this.wires.forEach(w => { if (w.state === 'bad') this.setWire(w, 'repair'); });
    this.liveSpiral = false; this.ring.material.color.set(COL.repair);
    if (this.realCount() === 0) { this.pendingDesigners = Math.max(1, this.pendingDesigners); this.ring.visible = true; this.ring.material.color.set(COL.repair); }
  }
  passed() {
    this.blocks.forEach(b => { b.state = 'pass'; });
    this.wires.forEach(w => this.setWire(w, 'pass'));
    if (this.pulse) { this.pulse = null; this.pulseMesh.visible = false; if (this.testEv) this.showResult(this.testEv); }
    this.ring.visible = false;
  }
  finish() { this.pendingDesigners = 0; this.updateRing(); }

  animate(dt, dv) {
    const now = this.nowMs, tsec = now / 1000;
    this.blocks.forEach(b => {
      const k = ease((now - b.born) / 250);
      b.mesh.scale.setScalar(1.4 - .4 * k); b.mesh.position.y = b.sp.h / 2 + (1 - k) * 1.2;
      const tgt = new THREE.Color(b.isResult && b.state === 'build' ? COL.build : COL[b.state] || COL.build);
      if (b.lit > 0) tgt.lerp(new THREE.Color(COL.lit), Math.min(1, b.lit));
      b.cur.lerp(tgt, 1 - Math.exp(-dt * 12));
      b.mat.emissive.copy(b.cur).multiplyScalar(.2); b.mat.color.copy(b.cur).multiplyScalar(.12);
      b.mat.emissiveIntensity = 2 * (b.state === 'fail' ? .75 + .25 * Math.sin(tsec * 9) : b.state === 'repair' ? .85 + .15 * Math.sin(tsec * 5) : 1);
      b.lit = Math.max(0, b.lit - dt * 2.5);
    });
    this.pads.forEach(p => { p.mesh.material.emissiveIntensity = 1.6; });
    this.wires.forEach(w => {
      if (!w.line) return;
      w.prog = Math.min(1, (now - w.born) / 400);
      w.line.geometry.instanceCount = Math.max(0, Math.ceil(w.nseg * w.prog));
      let g = TRACE[w.state] || TRACE.calm;
      if (w.state === 'build' && now - w.born > 900) g = TRACE.calm;
      w.color.lerp(new THREE.Color(g), 1 - Math.exp(-dt * 6));
      w.line.material.color.copy(w.color);
      if (w.state === 'build' && now - w.born > 900) w.state = 'calm';
    });
    if (this.pulse && this.pulse.path) {
      this.pulse.u = Math.min(1, this.pulse.u + dv / this.pulse.dur);
      const p = this.pulse.path.getPoint(this.pulse.u); this.pulseMesh.position.copy(p);
      this.pulseMesh.scale.setScalar(1 + .25 * Math.sin(tsec * 18));
      this.blocks.forEach(b => { if (!b.isResult && b.pos.distanceTo(new THREE.Vector3(p.x, 0, p.z)) < 1.3) b.lit = 1; });
      if (this.pulse.u >= 1) { this.pulseMesh.visible = false; const ev = this.pulse.ev; this.pulse = null; this.showResult(ev); }
    }
    if (this.ring.visible) {
      const c = this.slotOf.size ? new THREE.Vector3() : (this.fitCenter || new THREE.Vector3()); this.ring.position.set(c.x, .1, c.z);
      this.ring.scale.setScalar(1 + .2 * Math.sin(tsec * (this.liveSpiral ? 7 : 2.5)) + (this.waitSpiral ? this.waitSpiral.p * .6 : 0));
    }
    this.fitCamera(dt);
    this.controls.update();
    this.render();
  }

  computeBounds() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x, z, hw, hd) => { x0 = Math.min(x0, x - hw); x1 = Math.max(x1, x + hw); z0 = Math.min(z0, z - hd); z1 = Math.max(z1, z + hd); };
    this.blocks.forEach(b => add(b.pos.x, b.pos.z, b.sp.w / 2, b.sp.d / 2));
    this.pads.forEach(p => add(p.x, p.z, .6, .4));
    const S2 = SIZE[this.kind];          // planned parts that have not landed yet keep their place on the board
    this.slotOf.forEach(s => add((s % S2.per) * S2.sx, Math.floor(s / S2.per) * S2.sz, S2.w / 2, S2.d / 2));
    if (!isFinite(x0)) { x0 = -5; x1 = 5; z0 = -2.5; z1 = 2.5; }
    this.bounds = { x0: x0 - 1.6, x1: x1 + 1.2, z0: z0 - 1.2, z1: z1 + 1.2 };
    this.fitDirty = true;
  }
  fitCamera(dt) {
    if (!this.w) return;
    if (!this.bounds) this.computeBounds();
    const b = this.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const c = new THREE.Vector3(cx, .4, cz); this.group.localToWorld(c); this.fitCenter = new THREE.Vector3(cx, 0, cz);
    const dir = this.userMoved ? this.camera.position.clone().sub(this.controls.target).normalize() : this.camDir;
    const cam = new THREE.Object3D(); cam.position.copy(c).addScaledVector(dir, 40); cam.lookAt(c); cam.updateMatrixWorld();
    const inv = cam.matrixWorld.clone().invert();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [0, 1.6]) {
      const v = new THREE.Vector3(x, y, z); this.group.localToWorld(v); v.applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    const nw = Math.max((maxX - minX) * 1.08, 11), nh = Math.max(maxY - minY, 5.5) + 1.8;
    const a = this.w / this.h, zoom = Math.min(2 * this.S * a / nw, 2 * this.S / nh);
    const k = this.fitDirty ? 1 - Math.exp(-dt * 4) : 1;
    this.controls.target.lerp(c, k); this.camera.zoom += (zoom - this.camera.zoom) * k;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, 40);
    this.camera.updateProjectionMatrix();
    if (Math.abs(this.camera.zoom - zoom) < .002 && this.controls.target.distanceTo(c) < .01) this.fitDirty = false;
  }
}

/* ───────────────────────── 2D gate schematic from the blueprint ───────────────────────── */
const OUT_PORT = /^(sum|s|cout|co|carry|carry_?out|y|q|qn|out|o|z|eq|gt|lt|diff|bout|borrow|result)\d*$/i;
const NODE_SZ = { in: [64, 22], out: [64, 22], gate: [60, 40], ff: [72, 44] };
const curveX = (x0, y) => { const t = y / 40; return x0 + 28 * t * (1 - t); };
const GATE = {          // IEEE distinctive shapes in a 60×40 cell; inputs enter on the left, output leaves at (60,20)
  AND:  { body: 'M8,0 H30 A20,20 0 0 1 30,40 H8 Z', inX: () => 8, outX: 50 },
  NAND: { body: 'M8,0 H28 A20,20 0 0 1 28,40 H8 Z', bubble: 52, inX: () => 8, outX: 56 },
  OR:   { body: 'M6,0 Q20,20 6,40 Q34,40 52,20 Q34,0 6,0 Z', inX: y => curveX(6, y), outX: 52 },
  XOR:  { body: 'M12,0 Q26,20 12,40 Q40,40 56,20 Q40,0 12,0 Z', arc: 'M5,0 Q19,20 5,40', inX: y => curveX(5, y), outX: 56 },
  NOT:  { body: 'M8,4 L44,20 L8,36 Z', bubble: 48, inX: () => 8, outX: 52 },
};
function placeCol(items, gapOf) {        // keep order, honour gaps, stay as close as possible to each wanted y (weighted isotonic fit)
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
const plen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
const txt = (g, x, y, s, cls, anchor) => { const t = sv('text', { x: x.toFixed(1), y: y.toFixed(1), class: cls, 'text-anchor': anchor || 'start' }, g); t.textContent = s; return t; };
const lead = (g, x0, y, x1) => sv('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'lead' }, g);

class Schematic {
  constructor(run) { this.run = run; this.bp = run.blueprint || {}; this.outlines = new Map(); this.build(); this.layout(); }

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
    const outMap = Array.isArray(bp.outputs) ? Object.fromEntries(bp.outputs.map(s => [s, s])) : (bp.outputs || {});
    const outSigs = new Set(Object.values(outMap));
    (bp.instances || []).forEach(inst => {            // a library part is one box with its port names
      const ins = [], outs = [];
      Object.entries(inst.wire || {}).forEach(([p, s]) => {
        const isOut = !drivers.has(s) && (OUT_PORT.test(p) || outSigs.has(s));
        (isOut ? outs : ins).push({ key: `${inst.name}.${p}`, sig: s, name: p });
      });
      add({ id: inst.name, kind: 'inst', label: String(inst.name).toUpperCase(), part: inst.part, ins, outs });
    });
    nodes.forEach(n => { if (n.kind === 'inst') n.outs.forEach(o => { if (!drivers.has(o.sig)) drivers.set(o.sig, o); }); });
    Object.entries(outMap).forEach(([name, s]) => add({ id: 'out:' + name, kind: 'out', label: name, ins: [{ key: 'out:' + name, sig: s, name }] }));
    [...nodes.values()].forEach(n => n.ins.forEach(p => {        // undriven signals get their own little source pin
      if (p.sig == null || drivers.has(p.sig) || nodes.has('in:' + p.sig)) return;
      const c = add({ id: 'in:' + p.sig, kind: 'in', label: String(p.sig), konst: true, idx: 900, outs: [{ key: 'in:' + p.sig, sig: p.sig, name: p.sig }] });
      drivers.set(p.sig, c.outs[0]); }));

    this.edges = []; this.edgeInto = new Map(); this.badEdges = new Map();
    nodes.forEach(n => n.ins.forEach(p => { const s = drivers.get(p.sig); if (!s) return;
      const e = { id: p.key, src: s, dst: p, bad: false }; this.edges.push(e); this.edgeInto.set(p.key, e); }));
    (this.run.events || []).forEach(ev => {          // the wrong wires the inspector named are drawn too (hidden until their fail)
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
    // columns by logic depth
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

    // sizes and pin offsets
    nodes.forEach(n => {
      if (n.kind === 'inst') { n.w = 108; n.h = Math.max(n.ins.length, n.outs.length, 2) * 22 + 14; } else [n.w, n.h] = NODE_SZ[n.kind];
      const spread = (arr, x, cy, pitch) => arr.forEach((p, i) => { p.ox = x; p.oy = cy + (i - (arr.length - 1) / 2) * pitch; });
      if (n.kind === 'in') spread(n.outs, n.w, n.h / 2, 0);
      else if (n.kind === 'out') spread(n.ins, 0, n.h / 2, 0);
      else if (n.kind === 'gate') { spread(n.ins, 0, 20, n.ins.length > 2 ? 32 / (n.ins.length - 1) : 20); spread(n.outs, n.w, 20, 0); }
      else if (n.kind === 'ff') { spread(n.ins, 0, 22, 0); spread(n.outs, n.w, 22, 0); }
      else { spread(n.ins, 0, n.h / 2, 22); spread(n.outs, n.w, n.h / 2, 22); }
    });

    // long wires get a lane (a dummy) in every column they cross, so they run between boxes, never through them
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
    const gapOf = (a, b) => a.kind === 'dummy' && b.kind === 'dummy' ? 6 : (a.kind === 'dummy' || b.kind === 'dummy') ? 10 : 18;
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

    // channels between columns: one vertical track per net
    const colW = cols.map(col => Math.max(20, ...col.filter(it => it.kind === 'node').map(it => it.w)));
    const chans = Array.from({ length: ncol }, () => new Map());
    edges.forEach(e => { if (e.ct <= e.cs) return;
      for (let c = e.cs + 1; c <= e.ct; c++) {
        const entry = c - 1 === e.cs ? pinY(e.src) : e.lanes[c - e.cs - 2].y + 4;
        const exit = c === e.ct ? pinY(e.dst) : e.lanes[c - e.cs - 1].y + 4;
        let t = chans[c].get(e.chain); if (!t) chans[c].set(e.chain, t = { entry, exits: new Set() }); t.exits.add(exit);
      } });
    const TR = 9;
    const chW = chans.map((m, c) => c === 0 ? 0 : Math.max(46, 28 + (m.size - 1) * TR));
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

    // orthogonal routes
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
      } else {            // feedback (flip-flops): around the bottom
        const ly = maxY + 24 + (back++) * 8;
        pts = [s, [s[0] + 12, s[1]], [s[0] + 12, ly], [t[0] - 12, ly], [t[0] - 12, t[1]], t];
      }
      e.pts = simplify(pts); e.len = Math.max(1, plen(e.pts));
    });
    // junction dots where a net branches off its trunk
    this.junctions = [];
    chans.forEach((m, c) => m.forEach((t, chain) => {
      if (chain.startsWith('bad:')) return;
      const ys = [t.entry, ...t.exits], lo = Math.min(...ys), hi = Math.max(...ys);
      new Set(ys).forEach(yy => { if (yy > lo + .5 && yy < hi - .5) this.junctions.push([trackX(c, chain), yy]); });
    }));
    this.box = { x0: -50, y0: -34, x1: x + 70, y1: maxY + 30 + back * 8 };
  }

  draw(host) {
    host.innerHTML = '';
    const b = this.box, W = b.x1 - b.x0, H = b.y1 - b.y0;
    const svg = this.svg = sv('svg', { viewBox: `${b.x0} ${b.y0} ${W} ${H}`, class: 'sch', role: 'img', 'aria-label': 'gate schematic' }, host);
    this.vb = [W, H];
    const gW = sv('g', {}, svg), gN = sv('g', {}, svg), gL = sv('g', {}, svg), gB = sv('g', {}, svg);
    this.gHl = sv('g', {}, svg);
    this.edges.forEach(e => {
      const p = sv('path', { d: 'M' + e.pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L'), class: e.bad ? 'w bad-w hidden' : 'w' }, e.bad ? gB : gW);
      p.style.setProperty('--len', e.len.toFixed(1));
      p.addEventListener('animationend', ev => { if (ev.animationName === 'draw') p.classList.remove('draw'); });
      e.el = p;
    });
    this.junctions.forEach(([x, y]) => sv('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6, class: 'dot' }, gW));
    this.nodes.forEach(n => this.drawNode(n, gN));
    // small net names at internal sources
    this.nodes.forEach(n => {
      if (n.kind === 'in' || n.kind === 'out') return;
      n.outs.forEach(o => {
        const sinks = this.edges.filter(e => !e.bad && e.src === o);
        if (!sinks.length || sinks.every(e => e.dst.node.kind === 'out' && e.dst.node.label === o.sig)) return;
        txt(gL, n.x + o.ox + 5, n.y + o.oy - 5, String(o.sig), 'sig');
      });
    });
    return svg;
  }
  drawNode(n, parent) {
    const g = sv('g', { transform: `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})` }, parent); n.el = g;
    if (n.kind === 'in') { sv('circle', { cx: n.w - 2, cy: n.h / 2, r: 3, class: 'pin' }, g); txt(g, n.w - 10, n.h / 2 + 4.5, n.label, 'io' + (n.konst ? ' konst' : ''), 'end'); return; }
    if (n.kind === 'out') { sv('circle', { cx: 2, cy: n.h / 2, r: 3, class: 'pin' }, g); txt(g, 10, n.h / 2 + 4.5, n.label, 'io'); return; }
    if (n.kind === 'gate') {
      const G = GATE[n.type];
      if (!G) { n.ins.forEach(p => lead(g, 0, p.oy, 8)); sv('rect', { x: 8, y: 0, width: 44, height: 40, rx: 4, class: 'sym' }, g); txt(g, 30, 24, n.type || '?', 'port', 'middle'); lead(g, 52, 20, 60); return; }
      n.ins.forEach(p => lead(g, 0, p.oy, G.inX(p.oy)));
      if (G.arc) sv('path', { d: G.arc, class: 'sym arc' }, g);
      sv('path', { d: G.body, class: 'sym' }, g);
      if (G.bubble) sv('circle', { cx: G.bubble, cy: 20, r: 4, class: 'sym' }, g);
      lead(g, G.outX, 20, 60);
      return;
    }
    if (n.kind === 'ff') {
      lead(g, 0, 22, 8); lead(g, 64, 22, 72);
      sv('rect', { x: 8, y: 0, width: 56, height: 44, rx: 4, class: 'sym' }, g);
      sv('path', { d: 'M8,34 L15,38 L8,42', class: 'sym arc' }, g);
      txt(g, 13, 26, 'D', 'port'); txt(g, 59, 26, 'Q', 'port', 'end'); txt(g, 36, -6, n.label, 'sig', 'middle');
      return;
    }
    sv('rect', { x: 0, y: 0, width: n.w, height: n.h, rx: 6, class: 'sym box' }, g);
    txt(g, n.w / 2, n.h / 2 + 5.5, n.label, 'iname', 'middle');
    if (n.part) txt(g, n.w / 2, -6, String(n.part).replace(/_/g, ' '), 'part', 'middle');
    n.ins.forEach(p => { sv('circle', { cx: 0, cy: p.oy, r: 2.4, class: 'pin' }, g); txt(g, 6, p.oy + 3.5, p.name, 'port'); });
    n.outs.forEach(p => { sv('circle', { cx: n.w, cy: p.oy, r: 2.4, class: 'pin' }, g); txt(g, n.w - 6, p.oy + 3.5, p.name, 'port', 'end'); });
  }
  fit() {
    if (!this.svg) return;
    const [W, H] = this.vb, sc = Math.min(innerWidth * .9 / W, innerHeight * .6 / H, 2.1);
    this.svg.setAttribute('width', Math.round(W * sc)); this.svg.setAttribute('height', Math.round(H * sc));
    this.svg.style.setProperty('--sw', (2 / sc).toFixed(3));
  }

  /* states, driven by the run's events */
  outline(name, cls) {
    const n = this.nodes.get(name); if (!n) return;
    let r = this.outlines.get(name);
    if (!r) { r = sv('rect', { x: n.x - 7, y: n.y - 7, width: n.w + 14, height: n.h + 14, rx: 9 }, this.gHl); this.outlines.set(name, r); }
    r.setAttribute('class', 'hl ' + cls);
  }
  drawIn(e, cls) { e.el.classList.remove('hidden', 'gone', 'draw'); void e.el.getBoundingClientRect(); e.el.classList.add(cls, 'draw'); }
  fail(ev) {
    this.svg.classList.remove('pass', 'testing');
    (ev.bad_wires || []).forEach(w => {
      if (!Array.isArray(w)) return;
      const e = this.badEdges.get(w[0] + '>' + w[1]); if (!e) return;
      const good = this.edgeInto.get(e.dst.key); if (good) good.el.classList.add('hidden');
      e.el.classList.remove('hidden', 'gone');
    });
    (ev.bad_blocks || []).forEach(n => this.outline(n, 'bad'));
  }
  retry() { this.svg.classList.remove('testing'); this.outlines.forEach(r => { if (r.getAttribute('class').includes('bad')) r.setAttribute('class', 'hl amb'); }); }
  wire(ev) {
    const d = this.resolveDst(ev.to); if (!d) return;
    const bads = [...this.badEdges.values()].filter(e => e.dst === d && !e.el.classList.contains('hidden') && !e.el.classList.contains('gone'));
    bads.forEach(e => e.el.classList.add('gone'));
    const good = this.edgeInto.get(d.key);
    if (good && (bads.length || good.el.classList.contains('hidden'))) this.drawIn(good, 'repair');
  }
  isRepair(ev) { const d = this.resolveDst(ev.to); return !!d && [...this.badEdges.values()].some(e => e.dst === d); }
  test() { this.svg.classList.add('testing'); }
  pass() {
    this.svg.classList.remove('testing'); this.svg.classList.add('pass');
    this.badEdges.forEach(e => e.el.classList.add('gone'));
    this.edges.forEach(e => { if (!e.bad && e.el.classList.contains('hidden')) e.el.classList.remove('hidden'); });
    this.outlines.forEach(r => r.setAttribute('class', 'hl off'));
  }
}

/* ═════════════════════════ Fab Ops (everything below is new) ═════════════════════════ */

/* ───────── library parts → flat gates → simulation ───────── */
const g_ = (name, type, inputs) => ({ name, type, inputs, output: name });
const BUILTIN_PARTS = {      // used only when /library.json is unavailable (python http.server); same netlists as engine/inspector.py
  full_adder: { id: 'full_adder', ports: { inputs: ['a', 'b', 'cin'], outputs: ['sum', 'cout'] }, gates: 5, builtin: true,
    blueprint: { inputs: ['a', 'b', 'cin'], outputs: { sum: 'sum', cout: 'cout' }, instances: [], flipflops: [],
      gates: [g_('x1', 'XOR', ['a', 'b']), g_('sum', 'XOR', ['x1', 'cin']), g_('a1', 'AND', ['a', 'b']), g_('a2', 'AND', ['x1', 'cin']), g_('cout', 'OR', ['a1', 'a2'])] } },
  half_adder: { id: 'half_adder', ports: { inputs: ['a', 'b'], outputs: ['sum', 'cout'] }, gates: 2, builtin: true,
    blueprint: { inputs: ['a', 'b'], outputs: { sum: 'sum', cout: 'cout' }, instances: [], flipflops: [],
      gates: [g_('sum', 'XOR', ['a', 'b']), g_('cout', 'AND', ['a', 'b'])] } },
};
const partOf = id => S.lib?.parts?.[id] || BUILTIN_PARTS[id] || null;
const outMapOf = bp => Array.isArray(bp?.outputs) ? Object.fromEntries(bp.outputs.map(s => [s, s])) : (bp?.outputs || {});

/* library instances are expanded recursively; internal nets get the prefix "<inst>_" */
function flatten(bp) {
  const out = { inputs: [...(bp.inputs || [])], outputs: { ...outMapOf(bp) }, gates: [], flipflops: [], instances: [], missing: [], owner: new Map() };
  const walk = (b, R, pre, owner, depth) => {
    (b.gates || []).forEach(g => {
      const name = pre + g.name;
      out.gates.push({ name, type: String(g.type || '').toUpperCase(), inputs: (g.inputs || []).map(R), output: R(g.output) });
      out.owner.set(name, owner || g.name);
    });
    (b.flipflops || []).forEach(f => out.flipflops.push({ name: R(f.name), d: R(f.d) }));
    (b.instances || []).forEach(inst => {
      const p = partOf(inst.part);
      if (!p || !p.blueprint || depth > 6) { out.missing.push(inst.part); return; }
      const pb = p.blueprint, ins = new Set(p.ports?.inputs || pb.inputs || []), internalOut = new Map();
      Object.entries(outMapOf(pb)).forEach(([port, s]) => internalOut.set(s, port));
      const ipre = pre + inst.name + '_', w = inst.wire || {};
      const Ri = s => ins.has(s) ? R(w[s] ?? ipre + s) : internalOut.has(s) ? R(w[internalOut.get(s)] ?? ipre + s) : ipre + s;
      walk(pb, Ri, ipre, owner || inst.name, depth + 1);
    });
  };
  walk(bp, s => s, '', null, 0);
  return out;
}
const GATE_FN = { AND: (a, b) => a & b, OR: (a, b) => a | b, XOR: (a, b) => a ^ b, NAND: (a, b) => 1 - (a & b),
  NOR: (a, b) => 1 - (a | b), XNOR: (a, b) => 1 - (a ^ b), NOT: a => 1 - a, BUF: a => a };
/* iterate until stable: NOT has 1 input, the others 2; undriven nets read 0; flip-flop outputs come from `state` */
function simulate(flat, inputs, state = {}) {
  const v = {};
  for (const k in inputs) v[k] = inputs[k] ? 1 : 0;
  flat.flipflops.forEach(f => { v[f.name] = state[f.name] ? 1 : 0; });
  const rd = s => v[s] ? 1 : 0;
  let stable = false;
  for (let it = 0; it < flat.gates.length + 3; it++) {
    let ch = false;
    for (const g of flat.gates) {
      const fn = GATE_FN[g.type]; if (!fn) continue;
      const y = g.type === 'NOT' || g.type === 'BUF' ? fn(rd(g.inputs[0])) : fn(rd(g.inputs[0]), rd(g.inputs[1]));
      if (v[g.output] !== y) { v[g.output] = y; ch = true; }
    }
    if (!ch) { stable = true; break; }
  }
  const outs = {}; for (const n in flat.outputs) outs[n] = rd(flat.outputs[n]);
  return { v, outs, stable };
}
/* a3 a2 a1 a0 → bus a; names without a bit index stay singles */
function buses(names) {
  const m = new Map();
  names.forEach(s => { const r = /^([A-Za-z_]+?)(\d+)$/.exec(s); const key = r ? r[1] : '·';
    if (!m.has(key)) m.set(key, []); m.get(key).push({ sig: s, bit: r ? +r[2] : null }); });
  const out = [];
  m.forEach((bits, name) => {
    if (name !== '·' && bits.length > 1) out.push({ name, bits, bus: true });
    else bits.forEach(b => out.push({ name: b.sig, bits: [b], bus: false, single: true }));
  });
  return out;
}
const busVal = (bus, vals) => bus.bits.reduce((a, b) => a + ((vals[b.sig] ? 1 : 0) << b.bit), 0);
const shortModel = m => m ? String(m).split('/').pop().replace(/^NVIDIA-/, '') : '—';

/* ───────── interactive test bench: schematic + switches + lamps ───────── */
class TestBench {
  constructor(host, run, { onChange, maxH = 380 } = {}) {
    this.host = host; this.run = run; this.onChange = onChange; this.maxH = maxH;
    host.innerHTML = '';
    const bp = run?.blueprint;
    if (!bp) { host.append(el('div', 'empty', 'No blueprint was handed in — ' + (run?.inspection?.note || 'nothing to simulate.'))); this.dead = true; return; }
    this.flat = flatten(bp);
    this.inputs = Object.fromEntries((bp.inputs || run.order?.inputs || []).map(s => [s, 0]));
    this.state = {}; this.step = 0;
    if (this.flat.missing.length) host.append(el('div', 'warn', `part${this.flat.missing.length > 1 ? 's' : ''} not in the library: ${[...new Set(this.flat.missing)].join(', ')} — their outputs read 0`));
    this.schHost = el('div', 'schwrap'); host.append(this.schHost);
    this.sch = new Schematic({ blueprint: { ...this.flat, instances: [] }, order: run.order, events: [] });
    this.sch.draw(this.schHost);
    this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.schHost);

    const io = el('div', 'io'); host.append(io);
    const swRow = el('div', 'iorow'); io.append(el('div', 'iolab', 'INPUTS'), swRow);
    this.sw = new Map();
    buses(Object.keys(this.inputs)).forEach(b => {
      const grp = el('div', 'grp'); swRow.append(grp);
      b.bits.forEach(bit => {
        const s = el('button', 'sw'); s.type = 'button'; s.title = bit.sig;
        s.append(el('i'), el('span', 'nm', bit.sig));
        s.addEventListener('click', () => { this.inputs[bit.sig] ^= 1; this.update(); this.onChange?.(this.inputs); });
        grp.append(s); this.sw.set(bit.sig, s);
      });
    });
    const lpRow = el('div', 'iorow'); io.append(el('div', 'iolab', 'OUTPUTS'), lpRow);
    this.lamps = new Map();
    buses(Object.keys(this.flat.outputs)).forEach(b => {
      const grp = el('div', 'grp'); lpRow.append(grp);
      b.bits.forEach(bit => { const l = el('div', 'lamp'); l.append(el('i'), el('span', 'nm', bit.sig)); grp.append(l); this.lamps.set(bit.sig, l); });
    });
    const ins = run.inspection || {}, c = ins.correct || {};
    const badge = el('div', 'verdict ' + (ins.pass ? 'ok' : 'bad'));
    badge.textContent = ins.pass ? `✓ inspector: ${fmt(c.passed)}/${fmt(c.total)} inputs correct`
      : `✗ inspector: ${c.total ? `${fmt(c.passed)}/${fmt(c.total)} correct · ` : ''}${ins.note || ins.failure_category || 'failed'}`;
    lpRow.append(badge);
    this.read = el('div', 'readout mono'); io.append(this.read);
    if (this.flat.flipflops.length) {
      const ck = el('div', 'clock');
      const b1 = el('button', 'btn', 'Clock ⏵'), b2 = el('button', 'btn ghost', 'Reset');
      this.stepEl = el('span', 'mono dim');
      b1.addEventListener('click', () => this.clock()); b2.addEventListener('click', () => { this.state = {}; this.step = 0; this.update(); });
      ck.append(b1, b2, this.stepEl); io.append(ck);
    }
    this.update();
  }
  fit() {
    const svg = this.sch?.svg; if (!svg) return;
    const [W, H] = this.sch.vb, cw = this.schHost.clientWidth || 600;
    const sc = Math.min(cw / W, this.maxH / H, 2);
    svg.setAttribute('width', Math.round(W * sc)); svg.setAttribute('height', Math.round(H * sc));
    svg.style.setProperty('--sw', (1.8 / sc).toFixed(3));
  }
  setInputs(vals) {
    if (this.dead) return;
    for (const k in vals) if (k in this.inputs) this.inputs[k] = vals[k] ? 1 : 0;
    this.update();
  }
  clock() {
    const r = simulate(this.flat, this.inputs, this.state), ns = {};
    this.flat.flipflops.forEach(f => { ns[f.name] = r.v[f.d] ? 1 : 0; });
    this.state = ns; this.step++; this.update();
  }
  update() {
    if (this.dead) return;
    const r = this.last = simulate(this.flat, this.inputs, this.state);
    this.sch.edges.forEach(e => { if (!e.bad && e.el) e.el.classList.toggle('hi', !!r.v[e.src.sig]); });
    this.sch.nodes.forEach(n => { if (!n.el) return;
      const s = n.kind === 'out' ? n.ins[0]?.sig : n.outs[0]?.sig; n.el.classList.toggle('hi', !!r.v[s]); });
    this.sw.forEach((s, k) => { s.classList.toggle('on', !!this.inputs[k]); s.setAttribute('aria-pressed', this.inputs[k] ? 'true' : 'false'); });
    this.lamps.forEach((l, k) => l.classList.toggle('on', !!r.outs[k]));
    this.read.textContent = this.readout(r) + (r.stable ? '' : '   ⚠ not stable (combinational loop)');
    if (this.stepEl) this.stepEl.textContent = `step ${this.step} · state ${this.flat.flipflops.map(f => `${f.name}=${this.state[f.name] ? 1 : 0}`).join(' ')}`;
  }
  readout(r) {
    const o = this.run.order || {}, iv = this.inputs, ov = r.outs, text = `${o.title || ''} ${o.spec || ''}`;
    const ib = buses(Object.keys(iv)), ob = buses(Object.keys(ov));
    const A = ib.find(b => b.bus && b.name === 'a'), B = ib.find(b => b.bus && b.name === 'b'), Sb = ob.find(b => b.bus && b.name === 's');
    if (A && B && Sb) {                    // calculator: decimal reading, checked against the arithmetic itself
      const a = busVal(A, iv), b = busVal(B, iv), n = Sb.bits.length, s = busVal(Sb, ov), M = 1 << n;
      const opName = ['op', 'sub', 'm'].find(k => k in iv);
      const mode = opName ? (iv[opName] ? 'sub' : 'add') : /subtract|minus|difference/i.test(text) ? 'sub' : /add|sum|plus|calculator/i.test(text) ? 'add' : null;
      let shown = s, ok = null;
      if (mode === 'add') { if ('cout' in ov) { shown = s + (ov.cout << n); ok = shown === a + b; } else ok = s === (a + b) % M; }
      else if (mode === 'sub') ok = s === (((a - b) % M) + M) % M;
      return `a = ${a}, b = ${b}${mode === 'sub' ? ' (a − b)' : ''} → s = ${shown}` + (ok == null ? '' : ok ? ' ✓' : ' ✗');
    }
    const parts = [], singles = ib.filter(b => b.single);
    let code = null;
    ib.filter(b => b.bus).forEach(b => parts.push(`${b.name} = ${busVal(b, iv)}`));
    if (singles.length > 1) {
      const bits = singles.map(b => iv[b.name] ? 1 : 0).join(''); code = parseInt(bits, 2);
      parts.push(`${singles.map(b => b.name).join('')} = ${bits} (${code})`);
    } else singles.forEach(b => parts.push(`${b.name} = ${iv[b.name] ? 1 : 0}`));
    const outs = ob.map(b => b.bus ? `${b.name} = ${busVal(b, ov)}` : `${b.name} = ${ov[b.name] ? 1 : 0}`);
    let tail = '';
    const m = /codes?\s+((?:\d+\s*(?:,|or|and)?\s*)+)/i.exec(o.title || '');
    if (m && code != null && ob.length === 1 && ob[0].single) {    // the order's title names the codes: say whether this one is listed
      const listed = new Set(m[1].match(/\d+/g).map(Number)).has(code), y = ov[ob[0].name] ? 1 : 0;
      tail = `   · code ${code} is ${listed ? '' : 'not '}in the title → ${y === (listed ? 1 : 0) ? '✓' : '✗'}`;
    }
    return `${parts.join(', ')} → ${outs.join(', ')}${tail}`;
  }
}

/* ───────── 3D chip: the Board fed with events synthesised from the final blueprint ───────── */
function synthEvents(run) {
  const bp = run.blueprint || {}, ev = [], drv = new Map();
  let t = 0; const push = e => ev.push({ t: (t += .01), ...e });
  push({ type: 'order' });
  (bp.instances || []).forEach(i => {
    push({ type: 'place', block: i.name, kind: 'part', label: String(i.name).toUpperCase() });
    const p = partOf(i.part), outs = new Set(p?.ports?.outputs || Object.keys(i.wire || {}).filter(k => OUT_PORT.test(k)));
    Object.entries(i.wire || {}).forEach(([port, s]) => { if (outs.has(port)) drv.set(s, `${i.name}.${port}`); });
  });
  (bp.gates || []).forEach(g => { push({ type: 'place', block: g.name, kind: 'gate', label: String(g.type || '?').toUpperCase() }); drv.set(g.output, `${g.name}.out`); });
  (bp.flipflops || []).forEach(f => { push({ type: 'place', block: f.name, kind: 'gate', label: 'DFF' }); drv.set(f.name, `${f.name}.q`); });
  const src = s => drv.get(s) || s;
  (bp.instances || []).forEach(i => {
    const p = partOf(i.part), ins = new Set(p?.ports?.inputs || Object.keys(i.wire || {}).filter(k => !OUT_PORT.test(k)));
    Object.entries(i.wire || {}).forEach(([port, s]) => { if (ins.has(port)) push({ type: 'wire', from: src(s), to: `${i.name}.${port}` }); });
  });
  (bp.gates || []).forEach(g => (g.inputs || []).forEach((s, k) => push({ type: 'wire', from: src(s), to: `${g.name}.in${k}` })));
  (bp.flipflops || []).forEach(f => push({ type: 'wire', from: src(f.d), to: `${f.name}.d` }));
  Object.entries(outMapOf(bp)).forEach(([name, s]) => { if (drv.has(s)) push({ type: 'wire', from: drv.get(s), to: name }); });
  const ins = run.inspection || {};
  if (ins.pass) push({ type: 'pass', attempt: ins.attempt || 1 });
  else push({ type: 'fail', attempt: ins.attempt || 1, category: ins.failure_category, bad_blocks: ins.bad_blocks || [], bad_wires: [] });
  push({ type: 'done' });
  return ev;
}

/* ───────── events → words ───────── */
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function describe(e, n = 1, group) {
  switch (e.type) {
    case 'order': return 'Order received';
    case 'spawn': return n > 1 ? `Spawn ${n} agents (${[...new Set(group.map(x => x.role || x.agent))].join(', ')})` : `Spawn ${e.agent || e.role} · ${shortModel(e.model)}`;
    case 'plan': return `Plan ${plural((e.parts || []).length, 'part')}: ${(e.parts || []).join(', ')}`;
    case 'place': return n > 1 ? `Place ${plural(n, 'block')} (${group.slice(0, 6).map(x => x.block).join(', ')}${n > 6 ? ', …' : ''})` : `Place ${e.block} (${e.kind || 'block'}${e.label ? ' ' + e.label : ''})`;
    case 'wire': return n > 1 ? `Wire ${n} connections` : `Wire ${e.from} → ${e.to}`;
    case 'test': return `Test attempt ${e.attempt ?? 1}: ${e.summary || (e.inputs && Object.keys(e.inputs).length ? `${Object.entries(e.inputs).map(([k, v]) => `${k}=${v}`).join(' ')} → got ${e.got ?? '?'} (want ${e.expected ?? '?'})` : 'running the inspector')}`;
    case 'fail': return `Fail attempt ${e.attempt ?? 1}: ${e.category || ''}${e.note ? ' — ' + e.note : ''}`;
    case 'retry': return `Retry · attempt ${e.attempt ?? ''}`;
    case 'pass': return `Pass · attempt ${e.attempt ?? 1}`;
    case 'lesson': return `Lesson ${e.id || ''}: ${e.text || ''}`;
    case 'spiral': return `Spiral detected${e.note ? ' — ' + e.note : ''}`;
    case 'human_ping': return `Human ping${e.note ? ' — ' + e.note : ''}`;
    case 'done': return 'Done';
    default: return e.type;
  }
}

/* ═════════════════════════ Fab dashboard (everything below is new) ═════════════════════════ */
const fmtT = t => { const s = Math.max(0, Math.floor(t || 0)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':'); };
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const money = x => x == null ? '—' : '$' + (x < .1 ? x.toFixed(4) : x.toFixed(2));
const evsOf = run => run?.events || [];
const hasEv = (run, t) => evsOf(run).some(e => e.type === t);
const RULES = ['format', 'allowed_gates', 'pins', 'fanout', 'depth', 'unused', 'budget'];
const MODELS = [
  ['nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', 'architect · gate'],
  ['nvidia/Nemotron-3.5-Lightning-30B-A3B', 'designer · assembler · investigator'],
  ['nvidia/NVIDIA-Nemotron-3.5-Super-VL', 'inspector eyes (vision)'],
  ['nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', 'spare / fast lane']];
const TEAM_FALLBACK = { agents: [   // mirrors team.json (python http.server serves it; server.py does not)
  { id: 'architect', model: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', thinking: true, description: 'Turns an order into a plan and a definition of done; spawns one designer per part.' },
  { id: 'designer', model: 'nvidia/Nemotron-3.5-Lightning-30B-A3B', thinking: true, description: 'Designs one part as a blueprint, reusing verified library parts first.' },
  { id: 'assembler', model: 'nvidia/Nemotron-3.5-Lightning-30B-A3B', thinking: true, description: 'Wires parts into the top-level blueprint; every port connected.' },
  { id: 'inspector', model: 'code', description: 'Flattens, tests every input, checks fab rules. Never trusts self-reports.' },
  { id: 'inspector_eyes', model: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL', thinking: true, description: 'Looks at the drawn failed circuit and names the wrong wire.' },
  { id: 'investigator', model: 'nvidia/Nemotron-3.5-Lightning-30B-A3B', thinking: true, description: 'Categorizes failures, detects loops in thinking traces, writes lessons in the fault\'s words.' },
  { id: 'gate', model: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B', thinking: true, description: 'Proposes one factory change per shift; kept only if a fresh validation batch improves.' }] };
function ago(iso) {
  const t = Date.parse(iso); if (!isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`; const m = Math.round(s / 60); if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 48) return `${h}h ${m % 60}m ago`; return `${Math.floor(h / 24)}d ago`;
}

/* ───────── pipeline strip ───────── */
function stagesOf(c) {
  const run = c.run, ins = run.inspection, E = evsOf(run), done = hasEv(run, 'done'), live = c.live && !done;
  const plan = E.find(e => e.type === 'plan'), places = E.filter(e => e.type === 'place'), wires = E.filter(e => e.type === 'wire');
  const bp = run.blueprint, nInst = bp?.instances?.length ?? 0, nG = bp?.gates?.length ?? places.filter(p => p.kind === 'gate').length;
  const passEv = E.find(e => e.type === 'pass'), fails = E.filter(e => e.type === 'fail'), tests = E.filter(e => e.type === 'test');
  const lessons = E.filter(e => e.type === 'lesson'), ping = E.find(e => e.type === 'human_ping');
  const attempts = run.attempts ?? ins?.attempt ?? Math.max(1, ...E.map(e => e.attempt || 0));
  const nParts = plan ? (plan.parts || []).length : nInst || nG;
  const designed = places.length > 0 || !!bp, final = done || !!passEv;
  const out = [];
  out.push({ n: 'Order', d: `rung ${run.order?.rung ?? '?'} · ${(run.order?.inputs || []).length} in → ${(run.order?.outputs || []).length} out`, s: E.length ? 'done' : 'run' });
  out.push({ n: 'Design', s: designed ? 'done' : done ? 'bad' : (plan || hasEv(run, 'spawn')) ? 'run' : 'pend',
    d: designed ? `${plural(nParts, 'part')} · ${nInst ? nInst + ' from library' : plural(nG, 'gate')}` : plan ? `${plural(nParts, 'part')} planned` : done ? 'no design handed in' : 'waiting' });
  out.push({ n: 'Assemble', s: final && bp ? 'done' : done ? 'bad' : designed ? 'run' : 'pend',
    d: (wires.length ? plural(wires.length, 'wire') + ' · ' : bp ? `${plural(nG + nInst, 'block')} wired · ` : '') + plural(attempts, 'attempt') });
  const c2 = ins?.correct || {}, badRules = RULES.filter(r => ins?.rules?.[r] && ins.rules[r] !== 'ok');
  const lastFail = fails[fails.length - 1];
  out.push({ n: 'Inspect', s: passEv || (done && ins?.pass) ? 'done' : done ? 'bad' : tests.length || fails.length ? 'run' : 'pend',
    d: ins && done ? `${fmt(c2.passed)}/${fmt(c2.total)} · ${badRules.length ? badRules.join(', ') + ' failed' : 'rules ok'}`
      : lastFail ? `attempt ${lastFail.attempt ?? 1} failed · ${lastFail.category || ''}` : 'waiting' });
  out.push({ n: 'Learn', s: done ? 'done' : passEv || fails.length ? 'run' : 'pend',
    d: lessons.length ? `lesson ${lessons.map(l => l.id).join(', ')}` : ping ? 'human ping · ' + (ping.note || '') : done ? 'no new lesson' : 'waiting' });
  if (!live) out.forEach(s => { if (s.s === 'run') s.s = 'pend'; });
  return out;
}
function renderPipe(c) {
  const host = $('#pipe'); host.innerHTML = '';
  const IC = { done: '✓', run: '●', pend: '○', bad: '✗' };
  stagesOf(c).forEach(s => {
    const d = el('div', 'stg ' + s.s), t = el('div');
    t.append(el('div', 'sn', s.n), el('div', 'sd', s.d)); t.title = s.d;
    d.append(el('span', 'si', IC[s.s]), t); host.append(d);
  });
}

/* ───────── design summary ───────── */
function renderSummary(c) {
  const run = c.run, ins = run.inspection, m = ins?.metrics || {}, bp = run.blueprint, host = $('#summary'); host.innerHTML = '';
  host.append(el('h4', '', 'Design Summary'));
  const nInst = bp?.instances?.length ?? 0, parts = new Set((bp?.instances || []).map(i => i.part));
  const rows = [['Order', run.order?.id || '—'], ['Version', run.version || '—'],
    ['Parts', bp ? `${plural(nInst, 'instance')}${nInst ? ` · ${parts.size} library part${parts.size === 1 ? '' : 's'}` : ''}` : '—'],
    ['Gates', ins ? `${fmt(ins.gates)} / ${fmt(ins.best_known_gates)} best` : '—'], ['Depth', fmt(ins?.depth)],
    ['Attempts', fmt(run.attempts ?? ins?.attempt)], ['Cost', money(m.cost_usd)],
    ['Time', m.time_s != null ? m.time_s.toFixed(1) + ' s' : '—'], ['Model', shortModel(m.model)]];
  rows.forEach(([k, v]) => { const r = el('div', 'sr'), vv = el('span', 'v mono', v); vv.title = v; r.append(el('span', 'k', k), vv); host.append(r); });
  const cc = ins?.correct || {};
  const b = el('div', 'ibadge ' + (!ins ? 'run' : ins.pass ? 'ok' : 'bad'));
  b.textContent = !ins ? 'Inspector: waiting for a design' : ins.pass ? `✓ Inspector clean · ${fmt(cc.passed)}/${fmt(cc.total)} inputs · all rules ok`
    : `✗ Inspector: ${ins.failure_category || 'fail'} · ${ins.note || `${fmt(cc.passed)}/${fmt(cc.total)} correct`}`;
  host.append(b);
  if (run.order?.spec) host.append(el('div', 'spec', run.order.spec));
}

/* ───────── 3D view ───────── */
const V3 = { board: null, run: null, dirty: true, top: false, thumbAt: null };
function show3D() {
  const run = S.chip?.run; if (!run) return;
  if (!V3.board) V3.board = new Board($('#boardHost'));
  V3.run = run; V3.dirty = false;
  $('#v3msg').hidden = !!run.blueprint;
  $('#v3msg').textContent = run.blueprint ? '' : 'No blueprint handed in for this chip — nothing to place.';
  V3.board.play({ ...run, events: run.blueprint ? synthEvents(run) : [] });
  V3.board.tick(.001, 1e6);
  setView(V3.top);
  V3.thumbAt = performance.now() + 1200;
}
function setView(top) {
  V3.top = top; const b = V3.board;
  $('#vPersp').classList.toggle('on', !top); $('#vTop').classList.toggle('on', top);
  if (!b) return;
  b.camDir = top ? new THREE.Vector3(0, 1, .02).normalize() : new THREE.Vector3(1, 1, 1).normalize();
  b.userMoved = false; b.fitDirty = true;
}
const ICON3D = '<svg viewBox="0 0 120 80" width="110" height="74"><g fill="none" stroke="#f5b847" stroke-width="1.5"><path d="M60 12 104 34 60 56 16 34Z" fill="rgba(245,184,71,.08)"/><path d="M16 34v8l44 22 44-22v-8"/><path d="M44 30l16-8 16 8-16 8z" fill="rgba(245,184,71,.25)"/></g></svg>';
function thumb3D() {         // called right after a render, in the same task, so the WebGL drawing buffer still holds the frame
  const host = $('#th3d'), cv = V3.board?.renderer?.domElement;
  if (!cv) { host.innerHTML = ICON3D; return; }
  try { const img = new Image(); img.alt = '3D view'; img.src = cv.toDataURL('image/jpeg', .75); host.innerHTML = ''; host.append(img); } catch (e) { host.innerHTML = ICON3D; }
}

/* ───────── schematic tab ───────── */
const SCH = { sch: null, fault: false, failEv: null };
function renderSch(run) {
  const host = $('#schHost'); host.innerHTML = ''; SCH.sch = null; SCH.fault = false;
  const btn = $('#schFault'); btn.hidden = true;
  const bp = run.blueprint, ins = run.inspection;
  thumbSch(run);
  if (!bp) { host.append(el('div', 'empty', 'No blueprint was handed in — ' + (ins?.note || 'nothing to draw.'))); $('#schNote').textContent = ''; return; }
  const sch = SCH.sch = new Schematic(run); sch.draw(host); fitSch();
  SCH.failEv = [...evsOf(run)].reverse().find(e => e.type === 'fail' && ((e.bad_wires || []).length || (e.bad_blocks || []).length)) || null;
  if (ins && !ins.pass && ((ins.bad_wires || []).length || (ins.bad_blocks || []).length)) { sch.fail(ins); $('#schNote').textContent = `Inspector's bad wires in red · ${ins.note || ''}`; }
  else if (ins?.pass) { sch.pass(); $('#schNote').textContent = 'Final design · inspector clean'; }
  else $('#schNote').textContent = 'Final design';
  if (ins?.pass && SCH.failEv) { btn.hidden = false; btn.textContent = `Show attempt ${SCH.failEv.attempt ?? 1} fault`; }
}
function fitSch() {
  const sch = SCH.sch, svg = sch?.svg; if (!svg) return;
  const host = $('#schHost'), [W, H] = sch.vb, cw = Math.max(200, host.clientWidth - 20), chh = Math.max(200, host.clientHeight - 20);
  const sc = Math.min(cw / W, chh / H, 2.2);
  svg.setAttribute('width', Math.round(W * sc)); svg.setAttribute('height', Math.round(H * sc)); svg.style.setProperty('--sw', (1.8 / sc).toFixed(3));
}
function toggleFault() {
  const run = S.chip?.run; if (!run || !SCH.failEv) return;
  const on = !SCH.fault; renderSch(run); SCH.fault = on;
  if (on) { SCH.sch.svg.classList.remove('pass'); SCH.sch.fail(SCH.failEv); $('#schFault').textContent = 'Show final design';
    $('#schNote').textContent = `Attempt ${SCH.failEv.attempt ?? 1}: ${SCH.failEv.category || ''} · ${SCH.failEv.note || ''}`; }
}
function thumbSch(run) {
  const host = $('#thSch'); host.innerHTML = '';
  if (!run.blueprint) { host.append(el('span', 'muted small', 'no blueprint')); return; }
  const s = new Schematic(run), svg = s.draw(host);
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.style.setProperty('--sw', '4');
  if (run.inspection?.pass) svg.classList.add('pass');
}

/* ───────── test tab ───────── */
let bench = null;
function renderTest(run) {
  $('#testTitle').textContent = run.order?.title || run.run_id;
  $('#testSpec').textContent = `${run.order?.spec || ''}  ·  ${run.run_id} · ${run.version} · rung ${run.order?.rung ?? '?'} · allowed ${(run.order?.allowed_gates || []).join(' ')}`;
  bench = new TestBench($('#bench'), run, { maxH: 300 });
  if (!bench.dead) { const up = bench.update.bind(bench); bench.update = () => { up(); thumbTest(); }; }
  thumbTest();
}
function thumbTest() {
  const host = $('#thTest'); host.innerHTML = '';
  if (!bench || bench.dead) { host.append(el('span', 'muted small', 'nothing to test')); return; }
  const w = el('div', 'tlamps'); Object.keys(bench.inputs).forEach(k => w.append(el('i', 'sw' + (bench.inputs[k] ? ' on' : ''))));
  const o = el('div', 'tlamps'); Object.keys(bench.last?.outs || {}).forEach(k => o.append(el('i', bench.last.outs[k] ? 'on' : '')));
  const box = el('div'); box.append(w, o); host.append(box);
}

/* ───────── compare (held-out order, version A vs B) — from ops.js ───────── */
function findRun(ver, oid) {
  const ex = S.data?.exam?.[ver]?.runs || [];
  return ex.find(r => r.order?.id === oid) || S.chips.map(c => c.run).find(r => r.version === ver && r.order?.id === oid) || null;
}
const CMP = { sig: '', benches: [] };
function renderCompare(force) {
  const run = S.chip?.run, oid = run?.order?.id, A = S.cmpA, B = S.cmpB;
  const ra = oid ? findRun(A, oid) : null, rb = oid ? findRun(B, oid) : null;
  const sig = [oid, A, B, ra?.run_id, rb?.run_id, ra ? JSON.stringify(ra.inspection) : '', rb ? JSON.stringify(rb.inspection) : ''].join('|');
  if (!force && sig === CMP.sig) return; CMP.sig = sig;
  $('#cmpHead').textContent = oid ? `${run.order.title} · ${oid}` : 'select a chip';
  CMP.benches = [];
  [[ra, A, '#cmpL'], [rb, B, '#cmpR']].forEach(([r, v, sel], k) => {
    const host = $(sel); host.innerHTML = '';
    const h = el('div', 'cmph'); h.append(el('b', 'mono', v || '—'), el('span', 'muted', r ? r.run_id : ''));
    if (r) h.append(el('span', 'badge ' + (r.inspection?.pass ? 'ok' : 'bad'), r.inspection?.pass ? 'PASS' : 'FAIL'));
    host.append(h);
    if (!r) { host.append(el('div', 'empty big', `No run for ${v} on ${oid || 'this order'} yet.`)); CMP.benches[k] = null; return; }
    const bh = el('div'); host.append(bh);
    const tb = new TestBench(bh, r, { maxH: 230, onChange: vals => { if (S.link) CMP.benches[1 - k]?.setInputs(vals); } });
    CMP.benches[k] = tb;
    const ins = r.inspection || {}, m = ins.metrics || {}, st = el('div', 'cmpstats');
    [['result', ins.pass ? 'pass' : 'fail'], ['correct', `${fmt(ins.correct?.passed)}/${fmt(ins.correct?.total)}`], ['attempts', fmt(r.attempts ?? ins.attempt)],
     ['gates / best', `${fmt(ins.gates)} / ${fmt(ins.best_known_gates)}`], ['time', m.time_s != null ? m.time_s.toFixed(1) + ' s' : '—'],
     ['cost', money(m.cost_usd)], ['model', shortModel(m.model)]]
      .forEach(([a, b]) => { const d = el('div', 'kv'); d.append(el('span', 'k', a), el('span', 'v mono' + (a === 'result' ? (ins.pass ? ' g' : ' r') : ''), b)); st.append(d); });
    host.append(st);
    if (ins.note) host.append(el('div', 'note', (ins.failure_category && ins.failure_category !== 'none' ? `[${ins.failure_category}] ` : '') + ins.note));
  });
}

/* ───────── bottom row: practice + exam charts (inline SVG) ───────── */
function svgChart(host, grad) {
  const svg = sv('svg', { viewBox: '0 0 360 170', class: 'chart' }, host);
  const d = sv('defs', {}, svg);
  if (grad === 'gold') { const g = sv('linearGradient', { id: 'gGold', x1: 0, y1: 0, x2: 0, y2: 1 }, d);
    sv('stop', { offset: 0, 'stop-color': '#f5b847', 'stop-opacity': .35 }, g); sv('stop', { offset: 1, 'stop-color': '#f5b847', 'stop-opacity': 0 }, g); }
  if (grad === 'bar') { const g = sv('linearGradient', { id: 'gBar', x1: 0, y1: 0, x2: 0, y2: 1 }, d);
    sv('stop', { offset: 0, 'stop-color': '#ffd27a' }, g); sv('stop', { offset: 1, 'stop-color': '#b9822a' }, g); }
  [0, .5, 1].forEach(v => { const y = 140 - v * 120; sv('line', { x1: 30, x2: 352, y1: y, y2: y, class: 'ax' }, svg); txt(svg, 26, y + 4, Math.round(v * 100) + '%', '', 'end'); });
  return svg;
}
function stats(host, kv) {
  const s = el('div', 'stats');
  kv.forEach(([k, v]) => { const d = el('div', 'stat'), vv = el('div', 'sv', v), kk = el('div', 'sk', k); vv.title = v; kk.title = k; d.append(vv, kk); s.append(d); });
  host.append(s);
}
function renderPractice() {
  const d = S.data || {}, host = $('#practice'); host.innerHTML = '';
  const sh = (d.shifts || []).map(s => { const p = s.practice || []; return { x: s.shift, n: p.length, ok: p.filter(r => r.inspection?.pass).length }; });
  const svg = svgChart(host, 'gold');
  if (!sh.length) txt(svg, 190, 80, 'no shifts yet', '', 'middle');
  const X = i => sh.length === 1 ? 190 : 44 + i * (296 / (sh.length - 1)), Y = v => 140 - v * 120;
  const pts = sh.map((s, i) => [X(i), Y(s.n ? s.ok / s.n : 0)]);
  if (pts.length > 1) {
    sv('path', { d: `M${pts[0][0]},140 ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${pts[pts.length - 1][0]},140 Z`, class: 'ar' }, svg);
    sv('path', { d: 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L'), class: 'ln' }, svg);
  }
  const every = Math.ceil(sh.length / 12);
  sh.forEach((s, i) => {
    sv('circle', { cx: pts[i][0], cy: pts[i][1], r: 3.6, class: 'pt' }, svg);
    if (i % every === 0 || i === sh.length - 1) txt(svg, pts[i][0], 158, 'shift ' + s.x, '', 'middle');
    if (sh.length <= 8) txt(svg, pts[i][0], pts[i][1] - 8, `${s.ok}/${s.n}`, 'val', 'middle');
  });
  const lessons = (d.shifts || []).reduce((a, s) => a + (s.lessons_added || []).length, 0);
  const parts = S.lib ? Object.keys(S.lib.parts || {}).length : null;
  stats(host, [['Shifts', fmt(sh.length)], ['Chips built', fmt(sh.reduce((a, s) => a + s.n, 0))], ['Lessons written', fmt(lessons)], ['Parts verified', parts == null ? '—' : fmt(parts)]]);
}
function renderExam() {
  const d = S.data || {}, host = $('#exam'); host.innerHTML = '';
  const vs = (d.versions || Object.keys(d.exam || {})).filter(v => d.exam?.[v]);
  const svg = svgChart(host, 'bar');
  if (!vs.length) txt(svg, 190, 80, 'no exam yet', '', 'middle');
  const step = 310 / Math.max(1, vs.length), bw = Math.min(46, step - 10);
  vs.forEach((v, i) => {
    const e = d.exam[v], pr = e.pass_rate ?? 0, ip = !!e.in_progress, cx = 40 + step * (i + .5), h = Math.max(1, pr * 120);
    sv('rect', { x: (cx - bw / 2).toFixed(1), y: (140 - h).toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), rx: 4, class: 'bar' + (ip ? ' ip' : '') }, svg);
    txt(svg, cx, 140 - h - 6, ip ? `${(e.runs || []).length}/40` : pct(e.pass_rate), 'val', 'middle');
    txt(svg, cx, 158, v, '', 'middle');
  });
  const done = vs.filter(v => !d.exam[v].in_progress && d.exam[v].pass_rate != null), lv = done[done.length - 1], le = lv ? d.exam[lv] : null;
  const runs = le?.runs || [], passed = runs.filter(r => r.inspection?.pass && r.inspection.best_known_gates);
  const g = passed.reduce((a, r) => a + r.inspection.gates, 0), b = passed.reduce((a, r) => a + r.inspection.best_known_gates, 0);
  const costs = runs.map(r => r.inspection?.metrics?.cost_usd).filter(x => x != null);
  stats(host, [['Chips', runs.length ? fmt(runs.length) : '40'], [`Latest pass rate${lv ? ' · ' + lv : ''}`, pct(le?.pass_rate)],
    ['Gates vs best', b ? (g / b).toFixed(2) + '×' : '—'], ['$ per chip', costs.length ? money(costs.reduce((a, x) => a + x, 0) / costs.length) : '—']]);
}

/* ───────── agent log ───────── */
const LOGTAG = t => t === 'pass' ? 'OK' : (t === 'fail' || t === 'spiral') ? 'FAIL' : (t === 'human_ping' || t === 'retry') ? 'WARN' : 'INFO';
let logSig = '';
function renderLog(c) {
  const run = c.run, host = $('#log'), sig = run.run_id + '|' + evsOf(run).length;
  $('#logRun').textContent = run.run_id;
  if (sig === logSig) return; logSig = sig;
  host.innerHTML = '';
  evsOf(run).forEach(e => {
    const tag = LOGTAG(e.type), row = el('div', 'll ' + tag.toLowerCase());
    row.append(el('span', 'lt', fmtT(e.t)), el('span', 'lg', `[${tag}]`), el('span', 'lm', describe(e)));
    host.append(row);
  });
  if (!evsOf(run).length) host.append(el('div', 'muted', 'no events yet'));
  host.scrollTop = host.scrollHeight;
}

/* ───────── lessons ───────── */
function lessonList() {
  let ls = S.lib?.lessons || [], from = 'library.json';
  if (!ls.length) {           // no /library.json: show the lessons the runs themselves wrote
    const seen = new Set(); ls = [];
    S.chips.forEach(c => evsOf(c.run).forEach(e => { if (e.type === 'lesson' && !seen.has(e.id)) {
      seen.add(e.id); const [p, v] = String(e.text || '').split('→');
      ls.push({ id: e.id, pitfall: (p || '').trim(), verification: (v || '').trim(), run: c.run.run_id,
        category: evsOf(c.run).filter(x => x.type === 'fail').map(x => x.category).pop() }); } }));
    from = 'run events';
  }
  return { ls, from };
}
function renderLessonsInto(host, srcEl) {
  const { ls, from } = lessonList(); host.innerHTML = '';
  srcEl.textContent = ls.length ? `${ls.length} · from ${from}` : '';
  if (!ls.length) { host.append(el('div', 'muted small', 'No lessons yet.')); return; }
  ls.slice().reverse().forEach(l => {
    const d = el('details', 'lesson' + (l.active === false ? ' off' : '')), s = el('summary');
    s.append(el('b', '', l.id || '?'));
    if (l.category) s.append(el('span', 'cat ' + l.category, l.category));
    s.append(el('span', 'lt2', l.pitfall || l.when || l.text || ''));
    s.append(el('span', 'used mono', l.hits != null ? `used ${l.hits}×` : l.run || ''));
    d.append(s);
    const b = el('div', 'lb');
    if (l.when) b.append(el('span', 'muted', 'when '), document.createTextNode(l.when), el('br'));
    b.append(el('span', 'muted', 'pitfall '), document.createTextNode(l.pitfall || '—'), el('span', 'arrow', ' → '), document.createTextNode(l.verification || '—'));
    d.append(b); host.append(d);
  });
}
function renderLessons() { renderLessonsInto($('#lessons'), $('#lesSrc')); renderLessonsInto($('#lessonsAll'), $('#lesSrc2')); }

/* ───────── other views: chips, agents, runs, crusoe ───────── */
function table(head, rows, onClick) {
  const t = el('table', 'tb'), th = el('tr'); head.forEach(h => th.append(el('th', '', h))); t.append(th);
  rows.forEach(r => {
    if (r.group) { const tr = el('tr', 'grp'), td = el('td', '', r.group); td.colSpan = head.length; tr.append(td); t.append(tr); return; }
    const tr = el('tr', onClick ? 'click' : ''); r.cells.forEach(c => { const td = el('td'); if (c instanceof Node) td.append(c); else td.textContent = c; tr.append(td); });
    if (onClick) tr.addEventListener('click', () => onClick(r)); t.append(tr);
  });
  return t;
}
const badgeEl = ins => el('span', 'badge ' + (!ins ? 'run' : ins.pass ? 'ok' : 'bad'), !ins ? 'LIVE' : ins.pass ? 'PASS' : 'FAIL');
function renderChipList() {
  const host = $('#chipList'); host.innerHTML = '';
  if (!S.chips.length) { host.append(el('div', 'muted', 'No chips yet.')); return; }
  const rows = []; let g = null;
  S.chips.forEach(c => { if (c.group !== g) { g = c.group; rows.push({ group: g }); } const r = c.run, ins = r.inspection, m = ins?.metrics || {};
    rows.push({ id: c.id, cells: [r.order?.title || r.run_id, r.run_id, r.version, String(r.order?.rung ?? '—'), badgeEl(ins),
      ins ? `${fmt(ins.correct?.passed)}/${fmt(ins.correct?.total)}` : '—', ins ? `${fmt(ins.gates)} / ${fmt(ins.best_known_gates)}` : '—', fmt(r.attempts), money(m.cost_usd)] }); });
  host.append(table(['Chip', 'Run', 'Version', 'Rung', 'Result', 'Correct', 'Gates / best', 'Attempts', 'Cost'], rows, r => { selectChip(r.id); setView2('fab'); }));
}
function renderRoster() {
  const host = $('#roster'); host.innerHTML = '';
  const t = S.team || TEAM_FALLBACK;
  $('#teamSrc').textContent = S.team ? 'from team.json' : 'team.json (built-in copy)';
  host.append(table(['Agent', 'Model', 'Thinking', 'Job'], (t.agents || []).map(a => ({ cells: [el('b', 'mono', a.id), a.model === 'code' ? 'code (no model)' : shortModel(a.model), a.thinking ? 'on' : '—', a.description || ''] }))));
}
function renderShifts() {
  const host = $('#shifts'); host.innerHTML = '';
  const sh = S.data?.shifts || [];
  if (!sh.length) { host.append(el('div', 'muted', 'No shifts yet.')); return; }
  host.append(table(['Shift', 'Version', 'Practice', 'Proposal', 'Verdict', 'Δ pass', 'Δ $', 'Lessons', 'Top failures'], sh.map(s => {
    const p = s.practice || [], v = s.validation || {}, cats = Object.entries(s.categories || {}).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { cells: [String(s.shift), s.version, `${p.filter(r => r.inspection?.pass).length}/${p.length} passed`, v.proposal || '—', v.verdict || '—',
      v.delta?.pass != null ? (v.delta.pass >= 0 ? '+' : '') + Math.round(v.delta.pass * 100) + ' pts' : '—',
      v.delta?.cost_usd != null ? (v.delta.cost_usd >= 0 ? '+' : '−') + '$' + Math.abs(v.delta.cost_usd).toFixed(2) : '—',
      (s.lessons_added || []).join(', ') || '—', cats.map(([k, n]) => `${k} ${n}`).join(' · ') || '—'] };
  })));
}
function renderCrusoe() {
  const mh = $('#models'); mh.innerHTML = '';
  MODELS.forEach(([id, role]) => { const r = el('div', 'mrow'); r.append(el('span', 'mono', id), el('span', 'muted', role)); mh.append(r); });
  const g = S.data?.gauges || {}, gh = $('#gauges'); gh.innerHTML = '';
  [['tok/s', fmt(g.tok_s)], ['TTFT', g.ttft_s != null ? g.ttft_s.toFixed(2) + ' s' : '—'], ['cache hit', pct(g.cache_rate)],
   ['$ total', money(g.cost_total_usd)], ['chips/hour', fmt(g.chips_per_hour)], ['human pings', fmt(g.human_pings)]]
    .forEach(([k, v]) => { const t = el('div', 'gauge' + (k === 'human pings' && g.human_pings ? ' warn' : '')); t.append(el('div', 'gv', v), el('div', 'gk', k)); gh.append(t); });
}
function setView2(v) {
  S.view = v;
  document.querySelectorAll('.nv').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
  if (v === 'fab') requestAnimationFrame(() => { V3.board?.resize(); fitSch(); });
  window.scrollTo(0, 0);
}

/* ───────── selection, tabs, selects ───────── */
function chipLabel(c) { return `${c.run.order?.title || c.run.run_id} · ${c.run.version}${c.live ? ' · live' : ''}`; }
function fillSelects() {
  const d = S.data || {}, vs = d.versions || [];
  const fill = (sel, opts, val) => {
    const cur = JSON.stringify(opts);
    if (sel.dataset.opts !== cur) { sel.innerHTML = ''; opts.forEach(([v, t, grp]) => {
      let parent = sel; if (grp) { parent = [...sel.children].find(o => o.tagName === 'OPTGROUP' && o.label === grp); if (!parent) { parent = document.createElement('optgroup'); parent.label = grp; sel.append(parent); } }
      const o = document.createElement('option'); o.value = v; o.textContent = t; parent.append(o); }); sel.dataset.opts = cur; }
    if (val != null) sel.value = val;
  };
  fill($('#selVer'), [['all', 'All versions'], ...vs.map(v => [v, v + (v === d.current_version ? ' (current)' : '')])], S.ver);
  const chips = S.chips.filter(c => S.ver === 'all' || c.run.version === S.ver || c.id === S.chip?.id);
  fill($('#selChip'), chips.map(c => [c.id, chipLabel(c), c.group]), S.chip?.id);
  if (!S.cmpA || !vs.includes(S.cmpA)) S.cmpA = vs[0] || 'v1';
  if (!S.cmpB || !vs.includes(S.cmpB)) S.cmpB = vs[vs.length - 1] || 'v1';
  fill($('#selA'), vs.map(v => [v, v]), S.cmpA); fill($('#selB'), vs.map(v => [v, v]), S.cmpB);
}
function selectChip(id) {
  const c = S.chips.find(x => x.id === id); if (!c) return;
  S.chip = c; S.chipSig = ''; renderChip(); fillSelects();
}
function renderChip() {
  const c = S.chip; if (!c) return;
  renderPipe(c); renderLog(c);
  const sig = JSON.stringify(c.run) + '|' + (S.lib ? Object.keys(S.lib.parts || {}).join(',') : '');
  if (sig === S.chipSig) { renderCompare(); return; }
  S.chipSig = sig;
  const run = c.run;
  $('#selChip').value = c.id;
  $('#wsTitle').textContent = `Design Workspace · ${run.order?.title || run.run_id} · ${run.version}`;
  renderSummary(c); renderTest(run); renderSch(run);
  V3.dirty = true; if (S.tab === '3d') show3D(); else if (!V3.board) $('#th3d').innerHTML = ICON3D;
  renderCompare(true);
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.thumb').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'p-' + t; });
  if (t === '3d' && (V3.dirty || !V3.board)) show3D();
  if (t === 'sch') fitSch();
  if (t === 'test') bench?.fit?.();
  if (t === 'cmp') CMP.benches.forEach(b => b?.fit());
}
document.querySelectorAll('.tab, .thumb').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.querySelectorAll('.nv').forEach(b => b.addEventListener('click', () => setView2(b.dataset.view)));
$('#selVer').addEventListener('change', e => { S.ver = e.target.value; fillSelects();
  if (S.ver !== 'all' && S.chip?.run.version !== S.ver) { const c = S.chips.find(x => x.run.version === S.ver); if (c) selectChip(c.id); } });
$('#selChip').addEventListener('change', e => selectChip(e.target.value));
$('#selA').addEventListener('change', e => { S.cmpA = e.target.value; renderCompare(); });
$('#selB').addEventListener('change', e => { S.cmpB = e.target.value; renderCompare(); });
$('#link').addEventListener('change', e => { S.link = e.target.checked; if (S.link && CMP.benches[0]) CMP.benches[1]?.setInputs(CMP.benches[0].inputs); });
$('#vPersp').addEventListener('click', () => setView(false));
$('#vTop').addEventListener('click', () => setView(true));
$('#btnCmp').addEventListener('click', () => { setView2('fab'); setTab('cmp'); $('#ws').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#wsFull').addEventListener('click', () => { const v = $('#ws'); if (document.fullscreenElement) document.exitFullscreen?.(); else v.requestFullscreen?.().catch(() => {}); });
document.addEventListener('fullscreenchange', () => setTimeout(() => { fitSch(); bench?.fit?.(); }, 60));
$('#schFault').addEventListener('click', toggleFault);
$('#benchReset').addEventListener('click', () => { if (bench && !bench.dead) { Object.keys(bench.inputs).forEach(k => { bench.inputs[k] = 0; }); bench.state = {}; bench.step = 0; bench.update(); } });
new ResizeObserver(() => { if (S.tab === 'sch') fitSch(); }).observe($('#schHost'));

/* ───────── ▶ Run: POST /order, then watch run.json.live ───────── */
const modal = $('#modal'), mBody = $('#mBody');
const closeRun = () => { modal.hidden = true; };
$('#mClose').addEventListener('click', closeRun);
modal.addEventListener('click', e => { if (e.target === modal) closeRun(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeRun(); });
async function openRun() {
  modal.hidden = false; mBody.innerHTML = '';
  if (!S.apiMode) {
    mBody.append(el('div', 'mmsg', 'This is a static preview (python http.server), so there is no order server to take a new order. The pre-run live chip from samples/live_fallback.json stands in for it.'));
    const f = el('div', 'mfoot'), b = el('button', 'btn primary', 'Open the live fallback chip'); b.type = 'button';
    b.addEventListener('click', () => { const c = S.chips.find(x => x.group.startsWith('Live')); if (c) { selectChip(c.id); setView2('fab'); } closeRun(); });
    f.append(b); mBody.append(f); return;
  }
  mBody.append(el('div', 'mmsg', 'loading the menu…'));
  let menu = [];
  try { const r = await fetch('/menu.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j)) menu = j; } } catch (e) { /* the menu is optional */ }
  mBody.innerHTML = '';
  mBody.append(el('div', 'ph', 'Pick an order'));
  const opts = el('div', 'mopts');
  const radio = (val, label, extra) => { const l = el('label', 'mopt'), i = el('input'); i.type = 'radio'; i.name = 'ord'; i.value = val; l.append(i, el('span', '', label)); if (extra) l.append(extra); opts.append(l); return i; };
  menu.forEach((m, k) => { const i = radio('id:' + m.id, `${m.title} · rung ${m.rung}`); if (!k) i.checked = true; });
  const rs = document.createElement('select'); [1, 2, 3, 4, 5, 6].forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = 'rung ' + n; rs.append(o); }); rs.value = '2';
  const fr = radio('rung', 'Fresh unseen order of', rs); if (!menu.length) fr.checked = true;
  mBody.append(opts);
  const vsel = document.createElement('select'); (S.data?.versions || []).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; vsel.append(o); });
  vsel.value = S.ver !== 'all' ? S.ver : (S.data?.current_version || '');
  const f = el('div', 'mfoot'), vl = el('label', 'sel'); vl.append('Version ', vsel);
  const go = el('button', 'btn primary', '▶ Start run'); go.type = 'button'; f.append(vl, go); mBody.append(f);
  const msg = el('div', 'mmsg'); mBody.append(msg);
  go.addEventListener('click', async () => {
    const pick = mBody.querySelector('input[name=ord]:checked')?.value; if (!pick) return;
    const body = pick === 'rung' ? { rung: +rs.value } : { order_id: pick.slice(3) };
    if (vsel.value) body.version = vsel.value;
    go.disabled = true; msg.className = 'mmsg'; msg.textContent = 'sending…';
    try {
      const r = await fetch('/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'HTTP ' + r.status);
      S.watch = { run_id: j.run_id, prev: S.data?.live?.run_id || null };
      msg.className = 'mmsg ok'; msg.textContent = `Queued ${j.run_id} — watching run.json.live…`;
    } catch (e) { msg.className = 'mmsg bad'; msg.textContent = 'Could not queue the order: ' + e.message; go.disabled = false; }
  });
}
$('#btnRun').addEventListener('click', openRun);

/* ───────── data (same loading rules as ops.js / present.js) ───────── */
const SAMPLE = new URL('../samples/run.sample.json', location.href).href;
const LIVE_FB = new URL('../samples/live_fallback.json', location.href).href;
const TEAM = new URL('../team.json', location.href).href;
async function detectMode() {           // python -m http.server has no /run.json: don't ask for it (a 404 is a console error)
  if (params.get('data') === 'sample') return false;
  try { const r = await fetch(location.href, { method: 'GET', cache: 'no-store' });
    if (/SimpleHTTP|http\.server/i.test(r.headers.get('server') || '')) return false; } catch (e) { /* offline */ }
  return true;
}
async function getText(u) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.text(); } catch (e) { /* try next */ } return null; }
async function fetchData() {
  if (S.apiMode === null) S.apiMode = await detectMode();
  for (const u of S.apiMode ? ['/run.json', SAMPLE] : [SAMPLE]) { const t = await getText(u); if (t) return { text: t, src: u }; }
  return null;
}
function collect(d) {
  const out = [], seen = new Set();
  const add = (run, group, live) => { if (!run || !run.run_id || seen.has(run.run_id)) return; seen.add(run.run_id); out.push({ run, group, id: run.run_id, live: !!live }); };
  if (d.live) add(d.live, 'Live', true);
  (d.shifts || []).forEach(s => {
    (s.practice || []).forEach(r => add(r, `Practice · shift ${s.shift}`));
    const v = s.validation; if (v) { (v.old || []).forEach(r => add(r, `Validation (old) · shift ${s.shift}`)); (v.new || []).forEach(r => add(r, `Validation (new) · shift ${s.shift}`)); }
  });
  Object.entries(d.exam || {}).forEach(([ver, e]) => (e.runs || []).forEach(r => add(r, `Exam · ${ver}`)));
  if (S.extra) add(S.extra, 'Live · fallback sample');
  return out;
}
async function loadLibrary() {
  if (!S.apiMode) return;                 // http.server: no /library.json (built-in standard parts are used)
  const t = await getText('/library.json');
  if (t) { try { const j = JSON.parse(t); if (j && typeof j === 'object') S.lib = { parts: j.parts || {}, lessons: j.lessons || [] }; } catch (e) { /* keep old */ } }
}
function renderStatus() {
  const d = S.data || {}, run = d.status === 'running';
  $('#online').className = 'online' + (run ? ' run' : '');
  $('#onState').textContent = `Factory online · ${run ? 'running' : 'idle'}`;
  $('#onUpd').textContent = d.updated ? `updated ${ago(d.updated)}` : '';
  $('#srcNote').textContent = S.src && S.src !== '/run.json' ? 'sample data' : '';
  $('#liveDot').hidden = !run;
}
function renderAll() {
  fillSelects(); renderPractice(); renderExam(); renderLessons(); renderChipList(); renderShifts(); renderCrusoe();
  if (S.chip) renderChip();
}
async function poll() {
  const r = await fetchData();
  if (!r) { $('#srcNote').textContent = 'no run.json'; return; }
  S.src = r.src.startsWith('http') ? 'samples/run.sample.json' : r.src;
  if (r.text !== S.lastText) {
    let d; try { d = JSON.parse(r.text); } catch (e) { return; }
    S.lastText = r.text; S.data = d; S.chips = collect(d);
    if (S.chip) S.chip = S.chips.find(c => c.id === S.chip.id) || S.chip;
    if (S.watch && d.live && d.live.run_id !== S.watch.prev) { S.watch = null; S.chip = S.chips.find(c => c.live) || S.chip; S.chipSig = ''; closeRun(); setView2('fab'); }
    renderAll();
  }
  renderStatus();
}
async function boot() {
  S.apiMode = await detectMode();
  if (!S.apiMode) {
    const t = await getText(LIVE_FB); if (t) { try { S.extra = JSON.parse(t); } catch (e) { S.extra = null; } }
    const tj = await getText(TEAM); if (tj) { try { S.team = JSON.parse(tj); } catch (e) { S.team = null; } }
  }
  await loadLibrary();
  await poll();
  const want = params.get('run');
  const c = (want && S.chips.find(x => x.id === want)) || S.chips.find(x => x.live) || S.chips[0];
  if (c) selectChip(c.id);
  renderRoster();
  setTab(['3d', 'sch', 'test', 'cmp'].includes(params.get('tab')) ? params.get('tab') : '3d');
  setInterval(poll, 2000);
  setInterval(renderStatus, 10000);
  if (S.apiMode) setInterval(async () => { const before = JSON.stringify(S.lib); await loadLibrary(); if (JSON.stringify(S.lib) !== before) { S.chipSig = ''; renderAll(); } }, 15000);
}

/* ───────── render loop (3D only while its tab is visible) ───────── */
let last = performance.now();
function loop(now) {
  const dt = Math.min(.25, Math.max(0, (now - last) / 1000)); last = now;
  if (S.view === 'fab' && S.tab === '3d' && V3.board) {
    V3.board.tick(dt, 1);
    if (V3.thumbAt && now > V3.thumbAt) { V3.thumbAt = null; thumb3D(); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
boot();
