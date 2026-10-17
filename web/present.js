/* AutoFab · presentation mode.
   One scene at a time for one ChipRun: ORDER → BUILD → INSPECTION → LESSON → EVOLUTION.
   Every number on screen comes from run.json. No build step, no framework.
   The 3D board below is copied from web/index.html (the dashboard stage), trimmed to the board alone. */
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
const S = { speed: clamp(parseFloat(params.get('speed')) || 2, .25, 16), auto: params.get('auto') === '1', lights: false,
  data: null, chips: [], chip: null, scene: 0, hold: 0, apiMode: null, lastText: '', extra: null, picker: false };

/* ───────────────────────── 3D board (from web/index.html) ───────────────────────── */
// The composer clears a linear target and OutputPass encodes again, so the clear colour must be pre-decoded twice
const dec = v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
const clearCol = hex => new THREE.Color().setRGB(...[(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => dec(dec(v / 255))), THREE.LinearSRGBColorSpace);
const BG = clearCol(0x0b0f14), BG_DARK = clearCol(0x020305);
const BLACK = new THREE.Color(0, 0, 0), BLOOM = 1;
const COL = { build: '#38a0ff', pass: '#3ddc84', fail: '#ff5c6c', repair: '#ffc857', lit: '#38e8ff', pad: '#2f6f86' };
const TRACE = { build: '#38e8ff', calm: '#2a7a96', bad: '#ff5c6c', repair: '#ffc857', pass: '#2fae6a' };
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

    this.scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x0a1210, .9));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(6, 12, 4); this.scene.add(dl);

    // board group: rotated 45° about Y so local +x reads left→right on screen under the (1,1,1) iso camera
    this.group = new THREE.Group(); this.group.rotation.y = Math.PI / 4; this.scene.add(this.group);
    const slab = new THREE.Mesh(new RoundedBoxGeometry(46, .5, 30, 3, .1),
      new THREE.MeshStandardMaterial({ color: 0x0f1b17, roughness: .9, metalness: 0 }));
    slab.position.set(8, -.27, 2); this.group.add(slab);
    const grid = new THREE.GridHelper(44, 44, 0x1d3a2e, 0x15261f); grid.position.set(8, 0, 2);
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1a28, emissive: new THREE.Color(COL.build), emissiveIntensity: 2,
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
      new THREE.MeshStandardMaterial({ color: 0x0a1a28, emissive: new THREE.Color(COL.pad), emissiveIntensity: 2, toneMapped: false }));
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

/* ───────────────────────── scene plumbing ───────────────────────── */
class Cues {             // a list of {at, fn} on a real-time clock (seconds, already divided by the speed)
  constructor(list, tail = 1.5) { this.list = list.slice().sort((a, b) => a.at - b.at); this.t = 0; this.i = 0;
    this.end = (this.list.length ? this.list[this.list.length - 1].at : 0) + tail; }
  tick(dt) { this.t += dt; while (this.i < this.list.length && this.list[this.i].at <= this.t) this.list[this.i++].fn(); }
  get done() { return this.t >= this.end; }
  get progress() { return this.end ? clamp(this.t / this.end, 0, 1) : 1; }
}
const MIN_REAL = { order: .2, spawn: .2, plan: .2, place: .25, wire: 1.1, test: 1.5, fail: 2.8, retry: 1.0, pass: 1.4,
                   lesson: .3, spiral: 1.2, human_ping: 1.4, done: .3 };
function cueTimes(events) {       // event timestamps → seconds on screen at S.speed, long waits capped, short ones stretched
  let at = 0;
  return events.map((ev, i) => { if (i) { const p = events[i - 1];
    at += Math.max(Math.min(Math.max(0, (ev.t ?? 0) - (p.t ?? 0)) / S.speed, 3), MIN_REAL[p.type] ?? .3); } return at; });
}
const shortModel = m => !m ? '' : /Super-VL/i.test(m) ? 'Super VL' : /Lightning/i.test(m) ? 'Lightning' :
  /Super/i.test(m) ? 'Super 120B' : /Nano/i.test(m) ? 'Nano' : String(m).split('/').pop();
const ROLE_ST = { architect: 'planning', designer: 'designing', assembler: 'wiring', investigator: 'investigating', inspector: 'inspecting' };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

/* 1 · ORDER */
const sOrder = {
  enter(run) {
    const o = run.order || {}, title = $('#o-title'), spec = $('#o-spec'), team = $('#o-team');
    title.textContent = String(o.title || run.run_id || '').replace(/(\w)-(\w)/g, '$1‑$2');   // no line break inside "4-bit"
    spec.textContent = o.spec || '';
    title.classList.remove('in'); spec.classList.remove('in'); team.innerHTML = '';
    const cues = [{ at: .15, fn: () => title.classList.add('in') }, { at: .8, fn: () => spec.classList.add('in') }];
    const seen = new Set(); let at = 1.7, prevT = null;
    (run.events || []).forEach(ev => {
      if (ev.type !== 'spawn' || !ev.agent || seen.has(ev.agent)) return; seen.add(ev.agent);
      if (prevT != null) at += clamp(((ev.t ?? 0) - prevT) / S.speed, .35, 1.1); prevT = ev.t ?? 0;
      const [role0, part] = String(ev.agent).split(':'), role = ev.role || role0;
      const label = part ? (run.events.find(e => e.type === 'place' && e.block === part)?.label || part.toUpperCase()) : '';
      const r = el('div', 'trow');
      r.append(el('span', 'dot'), el('span', 'who', cap(role) + (label ? ' ' + label : '')), el('span', 'sep', '·'),
        el('span', 'mdl', shortModel(ev.model)), el('span', 'sep', '·'), el('span', 'st', ROLE_ST[role] || role));
      team.append(r); const t = at; cues.push({ at: t, fn: () => r.classList.add('in') });
    });
    this.cues = new Cues(cues, 1.8);
  },
  tick(dt) { this.cues.tick(dt); },
  get done() { return this.cues.done; },
  get progress() { return this.cues.progress; },
};

/* 2 · BUILD */
function buildSlice(run) {
  const ev = run.events || [];
  let start = ev.findIndex(e => ['place', 'wire', 'test', 'spiral', 'fail', 'pass'].includes(e.type)); if (start < 0) start = ev.length;
  const ti = ev.findIndex(e => e.type === 'test');
  let end;
  if (ti >= 0) { end = ev.findIndex((e, i) => i > ti && (e.type === 'fail' || e.type === 'pass')); if (end < 0) end = ti; }
  else end = ev.findIndex(e => e.type === 'fail' || e.type === 'pass');
  return { start, end: end < 0 ? ev.length : end + 1 };
}
const sBuild = {
  enter(run) {
    if (!this.board) { this.board = new Board($('#buildHost')); this.board.setLights(S.lights); }
    this.board.play(run, buildSlice(run)); this.tail = 0;
  },
  tick(dt) { this.board.tick(dt, S.speed); if (this.board.settled) this.tail += dt; },
  get done() { return this.tail > 1.4; },
  get progress() { return this.board ? this.board.progress : 0; },
};

/* 3 · INSPECTION */
function passLine(run) {
  const c = run.inspection?.correct;
  return c && c.total != null ? `Inspector checked all ${fmt(c.total)} inputs: ${c.ok ? 'all correct' : fmt(c.passed) + ' correct'}.` : 'Inspector: passed.';
}
const sInspect = {
  enter(run) {
    const host = $('#schem'), card = $('#spiral'), note = $('#i-note');
    host.innerHTML = ''; card.innerHTML = ''; note.textContent = ''; note.className = 't';
    this.sch = null; this.rows = null; this.ping = null;
    const evs = run.events || [];
    let s = evs.findIndex(e => e.type === 'fail' || e.type === 'spiral'); if (s < 0) s = evs.findIndex(e => e.type === 'pass'); if (s < 0) s = evs.length;
    const sch = run.blueprint ? new Schematic(run) : null;
    // only the beats this scene shows: verdicts, retries, the repair wire (re-placed blocks and unchanged wires are the board's story)
    const shown = ev => ['fail', 'retry', 'test', 'pass', 'human_ping', 'spiral'].includes(ev.type) || (ev.type === 'wire' && sch?.isRepair(ev));
    const slice = evs.slice(s).filter(shown), lead0 = .5, at = cueTimes(slice).map(t => t + lead0);
    const setNote = (t, cls) => { note.textContent = t || ''; note.className = 't ' + (cls || ''); };
    const cues = [];
    if (run.blueprint) {
      host.hidden = false; card.hidden = true;
      this.sch = sch; sch.draw(host); sch.fit();
      slice.forEach((ev, i) => {
        const f = {
          fail: () => { sch.fail(ev); setNote(ev.note || ev.category, 'bad'); },
          retry: () => { sch.retry(ev); note.className = 't amb'; },
          wire: () => sch.wire(ev),
          test: () => sch.test(ev),
          pass: () => { sch.pass(); setNote(passLine(run), 'ok'); },
          human_ping: () => setNote('Human pinged: ' + (ev.note || ''), 'amb'),
        }[ev.type];
        if (f) cues.push({ at: at[i], fn: f });
      });
      if (!cues.length) cues.push({ at: lead0, fn: () => setNote(run.inspection?.note || '', run.inspection?.pass ? 'ok' : '') });
    } else {
      host.hidden = true; card.hidden = false;
      this.buildSpiral(card, slice, at, cues);
    }
    this.cues = new Cues(cues, 3.2);
  },
  buildSpiral(card, slice, at, cues) {        // no blueprint: the model never handed one in
    const A = new Map(), get = k => { if (!A.has(k)) A.set(k, { k, start: null, spiralAt: null, chars: null, failAt: null, note: null }); return A.get(k); };
    get(1).start = .2; let cur = 1, ping = null;
    slice.forEach((ev, i) => {
      const t = at[i], k = ev.attempt ?? cur;
      if (ev.type === 'retry') { cur = ev.attempt ?? cur + 1; get(cur).start = t; }
      else if (ev.type === 'spiral') { const a = get(k); a.spiralAt = t; a.chars = ev.thinking_chars ?? null; }
      else if (ev.type === 'fail') { const a = get(k); a.failAt = t; a.note = ev.note || ev.category; }
      else if (ev.type === 'human_ping') ping = { at: t, note: ev.note };
    });
    this.rows = [...A.values()].sort((a, b) => a.k - b.k).map(a => {
      const r = el('div', 'srow busy'), think = el('span', 'think', 'Thinking… ');
      const num = el('span', 'mono'), no = el('span', 'no');
      if (a.chars != null) { think.append(num, ' characters'); num.textContent = '0'; }
      think.append(no); r.append(el('span', 'att', 'attempt ' + a.k), think); card.append(r);
      const start = a.start ?? 0, end = a.spiralAt ?? a.failAt ?? start + 1;
      cues.push({ at: start, fn: () => r.classList.add('in') });
      if (a.failAt != null) cues.push({ at: a.failAt, fn: () => { r.classList.remove('busy'); no.textContent = a.chars != null ? ', no answer' : (a.note || 'no answer'); } });
      return { a, num, start, end };
    });
    if (ping) {
      const p = el('div', 'ping', 'ping human'); if (ping.note) p.append(el('small', '', ping.note)); card.append(p);
      cues.push({ at: ping.at, fn: () => p.classList.add('in') });
    }
  },
  tick(dt) {
    this.cues.tick(dt);
    (this.rows || []).forEach(r => { if (r.a.chars == null) return;
      r.num.textContent = fmt(Math.round(r.a.chars * ease((this.cues.t - r.start) / Math.max(.1, r.end - r.start)))); });
  },
  get done() { return this.cues.done; },
  get progress() { return this.cues.progress; },
  resize() { this.sch?.fit(); },
};

/* 4 · LESSON */
const sLesson = {
  enter(run) {
    const L = (run.events || []).filter(e => e.type === 'lesson'), card = $('#l-card');
    if (L.length) { $('#l-text').textContent = L[L.length - 1].text || ''; $('#l-sub').textContent = 'kept only if the next unseen chips do better'; }
    else { $('#l-text').textContent = 'No lesson from this chip.'; $('#l-sub').textContent = run.inspection?.note || ''; }
    card.classList.remove('in');
    const words = ($('#l-text').textContent.split(/\s+/).length);
    this.cues = new Cues([{ at: .3, fn: () => card.classList.add('in') }], 3 + words * .22);
  },
  tick(dt) { this.cues.tick(dt); },
  get done() { return this.cues.done; },
  get progress() { return this.cues.progress; },
};

/* 5 · EVOLUTION + RACE */
function keptChange(d, v) {
  return (d.shifts || []).filter(s => s.version === v && s.validation?.verdict === 'keep' && s.validation.proposal)
    .map(s => s.validation.proposal.replace(/_/g, ' ')).join(', ');
}
function racePair(d, chips) {
  const pick = runs => {
    const byOrder = new Map();
    runs.forEach(r => { const id = r.order?.id; if (!id) return; if (!byOrder.has(id)) byOrder.set(id, []); byOrder.get(id).push(r); });
    let best = null;
    byOrder.forEach(rs => {
      const vs = [...new Set(rs.map(r => r.version))]; if (vs.length < 2) return;
      const s = rs.slice().sort((a, b) => verNum(a.version) - verNum(b.version)), lo = s[0], hi = s[s.length - 1];
      const score = (verNum(hi.version) - verNum(lo.version)) * 10 + (!lo.inspection?.pass && hi.inspection?.pass ? 5 : 0);
      if (!best || score > best.score) best = { a: lo, b: hi, score };
    });
    return best;
  };
  const exam = []; Object.values(d?.exam || {}).forEach(e => (e.runs || []).forEach(r => exam.push(r)));
  const p = pick(exam) || pick(chips.map(c => c.run));
  if (p) return { a: p.a, b: p.b, note: '' };
  const a = chips[0]?.run, b = (chips[1] || chips[0])?.run;
  return { a, b, note: chips.length > 1 ? 'only one version recorded yet: two different chips' : 'only one chip recorded yet' };
}
const sEvo = {
  enter() {
    this.race = false; this.t = 0; this.raceAuto = false;
    $('#s-evo').classList.remove('racing'); $('#race').classList.add('hidden'); $('#raceBtn').textContent = 'Race';
    this.renderLine(S.data, true);
    clearInterval(this.timer); this.timer = setInterval(() => this.poll(), 2000);
  },
  leave() { clearInterval(this.timer); this.timer = null; },
  async poll() {
    const r = await fetchData(); if (!r || r.text === S.lastText) return;
    if (!ingest(r.text)) return;
    if (S.scene === 4) this.renderLine(S.data, false);
  },
  renderLine(d, animate) {
    const line = $('#evo-line'); line.innerHTML = ''; this.rates = [];
    const vers = (d?.versions && d.versions.length) ? d.versions : Object.keys(d?.exam || {});
    if (!vers.length) { line.append(el('div', 'ver none t', 'no versions yet')); return; }
    const maxLift = innerHeight * .2;
    vers.forEach((v, i) => {
      if (i) { const c = el('div', 'conn'); const k = keptChange(d, vers[i - 1]); if (k) c.append(el('div', 'chg', k)); c.append(el('div', 'arr', '→')); line.append(c); }
      const ex = d.exam?.[v], node = el('div', 'ver' + (ex ? '' : ' none'));
      const rate = el('div', 'rate mono');
      node.append(el('div', 'vname', v), rate);
      const cats = el('div', 'cats');
      if (ex) {
        const to = Math.round((ex.pass_rate ?? 0) * 100);
        rate.textContent = animate ? '0%' : to + '%';
        this.rates.push({ rate, to, i, node, lift: (ex.pass_rate ?? 0) * maxLift });
        Object.entries(ex.categories || {}).filter(([, n]) => n > 0).forEach(([k, n]) => cats.append(el('span', '', `${k.replace(/_/g, ' ')} ${n}`)));
        if (!animate) node.style.marginBottom = (ex.pass_rate ?? 0) * maxLift + 'px';
      } else { rate.textContent = '—'; cats.append(el('span', '', 'not examined yet')); }
      node.append(cats); line.append(node);
    });
    this.animT = animate ? 0 : 99;
  },
  toggleRace(on = !this.race) {
    this.race = on;
    $('#s-evo').classList.toggle('racing', on); $('#race').classList.toggle('hidden', !on);
    $('#raceBtn').textContent = on ? 'Timeline' : 'Race';
    if (!on) { this.renderLine(S.data, false); return; }
    const p = racePair(S.data, S.chips);
    if (!p.a) { $('#race-note').textContent = 'no chips recorded yet'; return; }
    if (!this.L) { this.L = new Board($('#raceL')); this.R = new Board($('#raceR')); [this.L, this.R].forEach(b => b.setLights(S.lights)); }
    const same = p.a.order?.id && p.a.order.id === p.b.order?.id;
    $('#race-title').textContent = same ? (p.a.order.title || '') : '';
    $('#race-note').textContent = p.note || (same ? 'same order · two versions' : '');
    [[this.L, p.a, $('#capL')], [this.R, p.b, $('#capR')]].forEach(([b, run, capEl]) => this.racer(b, run, capEl, same));
    this.raceTail = 0;
  },
  racer(board, run, capEl, same) {
    capEl.innerHTML = '';
    const cell = (k) => { const s = el('span'); s.append(el('i', '', k), el('b', 'mono', '—')); capEl.append(s); return s.lastChild; };
    capEl.append(el('span', 'rv', run.version || '—'));
    if (!same) capEl.append(el('span', 'rt', run.order?.title || ''));
    const att = cell('attempts'), time = cell('time'), gates = cell('gates'), cost = cell('cost');
    att.textContent = '1';
    const final = () => {
      const i = run.inspection, m = i?.metrics;
      att.textContent = String(run.attempts ?? board.attempt);
      if (i) { att.className = 'mono ' + (i.pass ? 'ok' : 'bad'); att.textContent += i.pass ? ' ✓' : ' ✗'; }
      if (m?.time_s != null) time.textContent = m.time_s.toFixed(1) + ' s';
      gates.textContent = i?.gates != null ? String(i.gates) : '—';
      cost.textContent = m?.cost_usd != null ? '$' + m.cost_usd.toFixed(4) : '—';
    };
    board.onEvent = ev => {
      if (ev.attempt && (ev.type === 'retry' || ev.type === 'test')) att.textContent = String(ev.attempt);
      if (ev.t != null) time.textContent = Number(ev.t).toFixed(1) + ' s';
      if (ev.type === 'done') final();
    };
    board.play(run); board.final = final; board.finalDone = false;
  },
  tick(dt) {
    this.t += dt;
    if (this.animT < 99) {
      this.animT += dt;
      (this.rates || []).forEach(r => {
        const k = ease((this.animT - .3 - r.i * .45) / 1.3);
        r.rate.textContent = Math.round(r.to * k) + '%';
        if (k > 0 && !r.lifted) { r.lifted = true; r.node.style.marginBottom = r.lift + 'px'; }
      });
    }
    if (S.auto && !this.race && !this.raceAuto && this.t > 3.6) { this.raceAuto = true; this.toggleRace(true); }
    if (this.race && this.L) {
      [this.L, this.R].forEach(b => { b.tick(dt, S.speed); if (b.finished && !b.finalDone) { b.finalDone = true; b.final(); } });
      if (this.L.settled && this.R.settled) this.raceTail += dt;
    }
  },
  get done() { return this.race && this.raceTail > 2; },
  get progress() { return this.race && this.L ? (this.L.progress + this.R.progress) / 2 : clamp(this.t / 3.6, 0, 1); },
};

const SCENES = [sOrder, sBuild, sInspect, sLesson, sEvo];
const SCENE_EL = ['#s-order', '#s-build', '#s-inspect', '#s-lesson', '#s-evo'].map(s => $(s));

function goto(i) {
  if (!S.chip) return;
  i = clamp(i, 0, SCENES.length - 1);
  SCENES[S.scene]?.leave?.();
  S.scene = i; S.hold = 0;
  SCENE_EL.forEach((s, k) => s.classList.toggle('on', k === i));
  SCENES[i].enter(S.chip.run);
}
function next() { if (S.scene < SCENES.length - 1) goto(S.scene + 1); else if (!sEvo.race) sEvo.toggleRace(true); }
function prev() { if (S.scene === 4 && sEvo.race) sEvo.toggleRace(false); else goto(S.scene - 1); }
function selectChip(chip, scene = 0) {
  S.chip = chip;
  const q = new URLSearchParams(location.search); q.set('run', chip.id); if (S.auto) q.set('auto', '1'); else q.delete('auto'); q.delete('scene');
  history.replaceState(null, '', '?' + q.toString());
  goto(scene);
}

/* ───────────────────────── chrome: rail, toast, lights, picker ───────────────────────── */
const railFills = [...document.querySelectorAll('#rail b')];
function paintRail() {
  const p = SCENES[S.scene]?.progress ?? 0;
  railFills.forEach((b, i) => { b.style.width = (i < S.scene ? 100 : i === S.scene ? p * 100 : 0) + '%'; b.style.opacity = i === S.scene ? 1 : .45; });
}
let toastT = null;
function toast(s) { const t = $('#toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1300); }
function setLights(on) {
  S.lights = on; document.body.classList.toggle('lights', on);
  [sBuild.board, sEvo.L, sEvo.R].forEach(b => b?.setLights(on));
}
function togglePicker(open = !S.picker) {
  S.picker = open; const p = $('#picker'); p.hidden = !open;
  if (!open) return;
  const box = $('.box', p); box.innerHTML = '';
  if (!S.chips.length) { box.append(el('div', 'empty', 'No chips in run.json yet.')); return; }
  const groups = new Map();
  S.chips.forEach(c => { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); });
  let firstB = null, curB = null;
  groups.forEach((list, g) => {
    box.append(el('h4', '', g));
    list.forEach(c => {
      const b = el('button', c === S.chip ? 'cur' : ''); b.type = 'button';
      const i = c.run.inspection;
      b.append(el('span', '', c.run.order?.title || c.id), el('small', 'mono', `${c.id} · ${c.run.version || '?'}${i ? (i.pass ? ' · ✓' : ' · ✗') : ''}`));
      b.onclick = () => { togglePicker(false); selectChip(c, 0); };
      box.append(b); if (!firstB) firstB = b; if (c === S.chip) curB = b;
    });
  });
  (curB || firstB)?.focus();
}

/* ───────────────────────── data ───────────────────────── */
const SAMPLE = new URL('../samples/run.sample.json', location.href).href;
const LIVE_FB = new URL('../samples/live_fallback.json', location.href).href;
async function detectMode() {           // python -m http.server has no /run.json: don't ask for it (a 404 is a console error)
  if (params.get('data') === 'sample') return false;
  try { const r = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
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
  const add = (run, group) => { if (!run || !run.run_id || seen.has(run.run_id)) return; seen.add(run.run_id); out.push({ run, group, id: run.run_id }); };
  (d.shifts || []).forEach(s => {
    (s.practice || []).forEach(r => add(r, `Practice · shift ${s.shift}`));
    const v = s.validation; if (v) { (v.old || []).forEach(r => add(r, `Validation (old) · shift ${s.shift}`)); (v.new || []).forEach(r => add(r, `Validation (new) · shift ${s.shift}`)); }
  });
  Object.entries(d.exam || {}).forEach(([ver, e]) => (e.runs || []).forEach(r => add(r, `Exam · ${ver}`)));
  if (d.live) add(d.live, 'Live');
  if (S.extra) add(S.extra, 'Sample · live fallback');
  return out;
}
function ingest(text) {
  let d; try { d = JSON.parse(text); } catch (e) { return false; }
  S.lastText = text; S.data = d; S.chips = collect(d);
  if (S.chip) { const same = S.chips.find(c => c.id === S.chip.id); if (same) S.chip = same; }
  return true;
}

async function boot() {
  const r = await fetchData();
  if (!r || !ingest(r.text)) { $('#o-title').textContent = 'No run.json yet'; $('#o-title').classList.add('in'); SCENE_EL[0].classList.add('on'); return; }
  if (!S.apiMode) { const t = await getText(LIVE_FB); if (t) { try { S.extra = JSON.parse(t); } catch (e) { S.extra = null; } S.chips = collect(S.data); } }
  const want = params.get('run');
  let chip = want ? S.chips.find(c => c.id === want) : null;
  if (!chip && want && S.apiMode) {
    const t = await getText('/runs/' + encodeURIComponent(want) + '.json');
    if (t) { try { const run = JSON.parse(t); chip = { run, id: run.run_id || want, group: 'Run file' }; S.chips.push(chip); } catch (e) { chip = null; } }
  }
  if (want && !chip) toast('run not found');
  chip = chip || S.chips[0];
  if (!chip) { SCENE_EL[0].classList.add('on'); $('#o-title').textContent = 'No chips in run.json yet'; $('#o-title').classList.add('in'); return; }
  selectChip(chip, clamp((parseInt(params.get('scene'), 10) || 1) - 1, 0, 4));
  if (S.auto) toast('auto');
}

/* ───────────────────────── keys + loop ───────────────────────── */
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); togglePicker(); return; }
  if (S.picker) return;
  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { e.preventDefault(); next(); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prev(); }
  else if (k === 'a' || k === 'A') { S.auto = !S.auto; S.hold = 0; toast(S.auto ? 'auto' : 'manual'); }
  else if (k === 'l' || k === 'L') setLights(!S.lights);
  else if ((k === 'r' || k === 'R') && S.scene === 4) sEvo.toggleRace();
});
$('#raceBtn').addEventListener('click', e => { e.currentTarget.blur(); sEvo.toggleRace(); });
$('#picker').addEventListener('click', e => { if (e.target.id === 'picker') togglePicker(false); });
addEventListener('resize', () => sInspect.resize());

let last = performance.now(), lastFrame = last;
function frame(now) {
  const dt = Math.min(.25, Math.max(0, (now - last) / 1000)); last = now; lastFrame = now;   // .25: a throttled pane keeps real time
  if (!S.chip) return;
  const sc = SCENES[S.scene];
  sc.tick(dt);
  if (S.auto && sc.done && S.scene < SCENES.length - 1) { S.hold += dt; if (S.hold > 1.2) goto(S.scene + 1); }
  paintRail();
}
function loop(now) { frame(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
// if the browser throttles rAF (hidden pane, minimised window) keep the replay clock moving anyway
setInterval(() => { const n = performance.now(); if (n - lastFrame > 400) frame(n); }, 120);
window.__present = { S, goto, next, prev, setLights, togglePicker, sEvo, sInspect, sBuild };
boot();
