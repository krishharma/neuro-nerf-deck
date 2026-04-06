/* ═══════════════════════════════════════════════════════════════════
   NEURO-NERF 3D EXPLAINER — scene3d.js  v4

   Focused 3-phase sequence (≈22 s):
     Phase 1 — NeRF mapping: drone scans, voxels build up   (8 s)
     Phase 2 — Route planning + navigation                   (6 s)
     Phase 3 — BCI command → labeled intent → target reach  (8 s)

  Camera: elevated chase cam with a bird's-eye perspective.
  The drone stays in frame while preserving 3D context.

   PUBLIC API:
     window.NeuroScene.initNeuroScene(canvasEl, hudContainer)
     window.NeuroScene.playNeuroNerfSequence()
     window.NeuroScene.pauseNeuroSequence()
     window.NeuroScene.disposeNeuroScene()
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── TIMING ──────────────────────────────────────────────────────── */
const T = {
  SCAN:    8.0,   // Phase 1: drone scans, voxels build
  NAV:     6.0,   // Phase 2: path appears, drone flies
  BCI:     8.0,   // Phase 3: BCI fires, drone flies to target
  HOLD:    2.5,   // end-card hold
};

/* ── COLORS ──────────────────────────────────────────────────────── */
const C = {
  BG:       0x060a10,
  CYAN:     0x00D0DC,
  CYAN_DIM: 0x005060,
  GREEN:    0x22C47B,
  ORANGE:   0xFF6B35,
  WALL:     0x1a2438,
  WALL_E:   0x2e4060,
  DEBRIS:   0x1c2a3c,
  DEBRIS_E: 0x304055,
  FLOOR:    0x0d1525,
};

/* ── CONSTANTS ───────────────────────────────────────────────────── */
const FH    = 1.5;   // drone fly height
const CHASE = { back: 6.2, up: 4.8, side: 2.0 }; // elevated trailing bird's-eye offset

/* ── STATE ───────────────────────────────────────────────────────── */
let _rdr, _scene, _cam, _clock, _raf = null, _disposed = false;
let _droneCyanLight = null;
let _drone, _rotors = [], _glowRing, _droneGlow;
let _voxGrp, _voxQueue = [], _voxBatch = 0;
let _frustumCone, _frustumEdge;       // scanning frustum on drone
let _pathLine, _ptSpheres = [], _bciPathLine;
let _targetHalo, _targetBeacon;
let _bciBeam, _bciPulse, _bciBeamMat, _bciPulseMat;
let _eegHudEl, _cmdHudEl, _alertHudEl, _waveHudEl;
let _operatorEl, _intentEl;
let _seqT = 0, _playing = false, _phase = 0, _waveOff = 0;

/* Waypoints — collision-free by design (open corridor positions) */
const SCAN_WPS = []; // Phase 1 patrol
const NAV_WPS  = []; // Phase 2 nav
const BCI_WPS  = []; // Phase 3 extension to target

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════ */
function initNeuroScene(canvasEl, hudContainer) {
  if (_rdr) disposeNeuroScene();
  _disposed = false;

  _eegHudEl   = hudContainer?.querySelector('#nn-eeg-status');
  _cmdHudEl   = hudContainer?.querySelector('#nn-cmd-value');
  _alertHudEl = hudContainer?.querySelector('#nn-alert');
  _waveHudEl  = hudContainer?.querySelector('#nn-wave');

  _buildOperatorPanel(hudContainer);
  _buildWaypoints();
  _buildScene(canvasEl);
  _buildEnvironment();
  _buildVoxels();
  _buildDrone();
  _buildFrustum();
  _buildPathVisuals();
  _buildTarget();
  _buildBCIBeam();

  _rdr.render(_scene, _cam);
  _loop();
}

function playNeuroNerfSequence() {
  _seqT  = 0;
  _phase = 0;
  _voxBatch = 0;
  _waveOff  = 0;
  _playing  = true;

  /* Reset voxels */
  _voxGrp.children.forEach(v => { v.visible = false; v.material.opacity = 0; });

  /* Reset path */
  _pathLine.visible    = false;
  _bciPathLine.visible = false;
  _ptSpheres.forEach(s => { s.visible = false; s.material.opacity = 0; });

  /* Reset target */
  if (_targetHalo)   { _targetHalo.visible   = false; _targetHalo.material.opacity   = 0; }
  if (_targetBeacon) { _targetBeacon.visible  = false; _targetBeacon.material.opacity = 0; }

  /* Reset BCI */
  _bciBeam.visible  = false;
  _bciPulse.visible = false;

  /* Reset frustum */
  _frustumCone.visible = false;
  _frustumEdge.visible = false;

  /* Reset drone to start */
  const sp = SCAN_WPS[0];
  _drone.position.set(sp.x, FH, sp.z);
  _drone.rotation.set(0, 0, 0);

  /* Fixed elevated bird's-eye — reset to same static position every time */
  _cam.position.set(0, 16, 7);
  _cam.lookAt(0, 0, -1);

  /* Reset HUD */
  _hud('standby', 'SCANNING', '—');
  if (_operatorEl) _operatorEl.style.opacity = '0';
  if (_intentEl)   _intentEl.textContent = 'EEG intent: STANDBY';

  _clock.start();
}

function pauseNeuroSequence() { _playing = !_playing; }

function disposeNeuroScene() {
  _disposed = true;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_rdr) { _rdr.dispose(); _rdr = null; }
  _scene = null;
}

/* ═══════════════════════════════════════════════════════════════════
   WAYPOINTS — all open-corridor positions, hand-verified
   Scene X: -8..8   Z: -8..7   Y=FH always
   Corridors:  left (X≈-6), centre (X≈0), right (X≈6)
   ═══════════════════════════════════════════════════════════════════ */
function _buildWaypoints() {
  const h = FH;

  /* Phase 1: short scanning loop — stays in clear zones */
  [
    [-5, h,  5],   // start, left corridor front
    [-5, h,  1],   // move back
    [-2, h, -1],   // cross to centre
    [ 1, h,  2],   // centre-front
    [ 1, h, -2],   // centre-back
  ].forEach(([x,y,z]) => SCAN_WPS.push(new THREE.Vector3(x,y,z)));

  /* Phase 2: nav path deeper, detours around interior divider wall */
  [
    [ 1, h, -2],   // from scan end
    [ 1, h, -5],   // south in centre
    [ 1, h, -7.2], // move below divider tail before crossing
    [ 4, h, -7.2], // cross in rear open gap (no wall collision)
    [ 4, h, -7],   // near target
  ].forEach(([x,y,z]) => NAV_WPS.push(new THREE.Vector3(x,y,z)));

  /* Phase 3: BCI extension to marked target spot */
  [
    [ 4, h, -7],   // from nav end
    [ 5, h, -7],   // TARGET — open pocket right-back
  ].forEach(([x,y,z]) => BCI_WPS.push(new THREE.Vector3(x,y,z)));
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE / RENDERER
   ═══════════════════════════════════════════════════════════════════ */
function _buildScene(canvas) {
  const W = Math.max(canvas.offsetWidth,  800);
  const H = Math.max(canvas.offsetHeight, 480);

  _rdr = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, premultipliedAlpha: false });
  _rdr.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  _rdr.setSize(W, H, false);
  _rdr.setClearColor(C.BG, 1.0);

  _scene = new THREE.Scene();
  _scene.fog = new THREE.FogExp2(C.BG, 0.022); // subtle fog — doesn't obscure nearby geometry

  _cam = new THREE.PerspectiveCamera(52, W / H, 0.1, 80);
  /* Fixed elevated bird's-eye view — set once, never moves */
  _cam.position.set(0, 16, 7);
  _cam.lookAt(0, 0, -1);

  /* Lighting — bright enough to see geometry clearly */
  _scene.add(new THREE.AmbientLight(0x3a5577, 1.4));
  const sun = new THREE.DirectionalLight(0x6688bb, 1.0);
  sun.position.set(4, 10, 6);
  _scene.add(sun);
  /* Cyan fill — follows the drone */
  const cpt = new THREE.PointLight(C.CYAN, 1.2, 10);
  cpt.position.set(0, 3, 0);
  _scene.add(cpt);
  _droneCyanLight = cpt; // stored in module var

  _clock = new THREE.Clock(false);

  new ResizeObserver(() => {
    if (!_rdr || !canvas) return;
    const w = Math.max(canvas.offsetWidth, 200);
    const h = Math.max(canvas.offsetHeight, 100);
    _rdr.setSize(w, h, false);
    _cam.aspect = w / h;
    _cam.updateProjectionMatrix();
  }).observe(canvas);
}

/* ═══════════════════════════════════════════════════════════════════
   ENVIRONMENT — believable interior, walls never overlap corridors
   ═══════════════════════════════════════════════════════════════════ */
function _buildEnvironment() {
  const wM  = new THREE.MeshLambertMaterial({ color: C.WALL });
  const dM  = new THREE.MeshLambertMaterial({ color: C.DEBRIS });

  function solid(x, y, z, w, h, d, ry=0, mat=wM, ec=C.WALL_E) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    _scene.add(m);
    const el = new THREE.LineSegments(
      new THREE.EdgesGeometry(g),
      new THREE.LineBasicMaterial({ color: ec })
    );
    el.position.copy(m.position);
    el.rotation.y = ry;
    _scene.add(el);
  }

  /* Floor */
  const fGeo  = new THREE.PlaneGeometry(24, 20);
  const floor = new THREE.Mesh(fGeo, new THREE.MeshLambertMaterial({ color: C.FLOOR }));
  floor.rotation.x = -Math.PI / 2;
  _scene.add(floor);
  const grid = new THREE.GridHelper(24, 24, 0x2a4060, 0x1a2840);
  grid.position.y = 0.01;
  _scene.add(grid);

  /* Outer shell */
  solid(-8.85, 2.5,  0, 0.3, 5, 18);  // left wall
  solid( 8.85, 2.5,  0, 0.3, 5, 18);  // right wall
  solid(  0,   2.5, -8, 18,  5, 0.3); // back wall
  solid( -5,   2.5,  7,  6,  5, 0.3); // front-left partial
  solid(  5,   2.5,  7,  6,  5, 0.3); // front-right partial

  /* Interior dividers — create 3 corridors, all openings preserved */
  solid(-3.2, 2.0,  0,  0.3, 4,  10);  // left/centre divider (clear gap beyond Z>5 and <-5)
  solid( 2.8, 2.0, -3,  0.3, 4,   8);  // centre/right divider

  /* Pillars — placed away from all path waypoints */
  solid(-6.5, 2.0,  3,  0.65, 4, 0.65);
  solid(-6.5, 2.0, -4,  0.65, 4, 0.65);
  solid( 6.5, 2.0,  3,  0.65, 4, 0.65);
  solid( 6.5, 2.0, -4,  0.65, 4, 0.65);
  solid(  0,  2.0,  4,  0.65, 4, 0.65);

  /* Fallen beams — above drone path (Y > 2) */
  const bMat = new THREE.MeshLambertMaterial({ color: 0x1e2f48 });
  solid( 1, 3.6,  5,  7,  0.22, 0.35,  0.2,  bMat, 0x2d4260);
  solid(-4, 3.4, -3,  5,  0.22, 0.35, -0.15, bMat, 0x2d4260);
  solid( 5, 3.2, -6,  4,  0.22, 0.35,  0.28, bMat, 0x2d4260);

  /* Debris — placed off the nav corridors */
  const debData = [
    [-7.2,  4, .7, .45, .5], [-7.0, -2, .6, .5,  .6],
    [-1.5,  3, .5, .35, .4], [ 0.5,  5, .8, .5,  .7],
    [ 3.0,  1, .6, .4,  .5], [ 6.5,  0, .7, .55, .6],
    [ 6.5, -6, .6, .45, .5], [-5.0, -6, .8, .5,  .6],
    [ 0.5, -7, .7, .4,  .5], [-2.0,  6, .6, .5,  .4],
  ];
  debData.forEach(([x, z, sx, sy, sz], i) => {
    solid(x, sy/2, z, sx, sy, sz, i * 0.4, dM, C.DEBRIS_E);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   VOXEL FIELD — NeRF digital twin point cloud
   ═══════════════════════════════════════════════════════════════════ */
function _buildVoxels() {
  _voxGrp = new THREE.Group();
  _scene.add(_voxGrp);

  const S   = 0.3;
  const geo = new THREE.BoxGeometry(S, S, S);
  const pos = [];

  /* Wall surfaces (sampled, not solid fill) */
  function wallLine(axis, fixed, a0, a1, y0, y1, density = 0.55) {
    for (let a = a0; a <= a1; a += S * 2.8) {
      for (let y = y0; y <= y1; y += S * 2.8) {
        if (_det(a, y + fixed) > density) continue;
        const p = axis === 'x' ? { x: fixed, y, z: a } : { x: a, y, z: fixed };
        pos.push({ ...p, t: 'wall' });
      }
    }
  }
  wallLine('x', -8.7,  -7,  7,  0.15, 4.5);
  wallLine('x',  8.7,  -7,  7,  0.15, 4.5);
  wallLine('z', -7.7,  -8,  8,  0.15, 4.5);
  wallLine('x', -3.2,  -4.5, 4.5, 0.15, 3.8, 0.45);
  wallLine('x',  2.8,  -6.5, 3.5, 0.15, 3.8, 0.45);

  /* Floor zone */
  for (let x = -8; x <= 8; x += S * 3.2) {
    for (let z = -7; z <= 6; z += S * 3.2) {
      if (_det(x, z) < 0.55) pos.push({ x, y: 0.14, z, t: 'floor' });
    }
  }

  /* Sort by distance from drone start */
  const sp = SCAN_WPS[0];
  pos.sort((a, b) =>
    Math.hypot(a.x - sp.x, a.z - sp.z) -
    Math.hypot(b.x - sp.x, b.z - sp.z)
  );

  pos.forEach(p => {
    const col = p.t === 'wall'
      ? _lerpc(C.CYAN_DIM, C.CYAN, _det(p.x, p.z) * 0.5)
      : _lerpc(C.CYAN_DIM, C.CYAN, _det(p.x, p.z) * 0.8);
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0,
      wireframe: _det(p.x * 2.7, p.z * 1.9) < 0.3,
    });
    const v = new THREE.Mesh(geo.clone(), mat);
    v.position.set(p.x, p.y, p.z);
    v.visible = false;
    _voxGrp.add(v);
    _voxQueue.push(v);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DRONE MODEL
   ═══════════════════════════════════════════════════════════════════ */
function _buildDrone() {
  _drone  = new THREE.Group();
  _rotors = [];

  const bM = new THREE.MeshLambertMaterial({ color: 0x2a4060 });
  const aM = new THREE.MeshLambertMaterial({ color: 0x1e3050 });
  const cM = new THREE.MeshBasicMaterial({ color: C.CYAN });
  const rM = new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.3, side: THREE.DoubleSide });

  /* Body */
  _drone.add(_mk(new THREE.BoxGeometry(0.55, 0.14, 0.55), bM));
  const hub = _mk(new THREE.SphereGeometry(0.1, 10, 8), cM);
  hub.position.y = 0.1;
  _drone.add(hub);

  /* Camera pod */
  const pod = _mk(new THREE.BoxGeometry(0.13, 0.09, 0.09), cM);
  pod.position.set(0, -0.04, 0.32);
  _drone.add(pod);

  /* Glow sphere — lights up on BCI receive */
  _droneGlow = _mk(
    new THREE.SphereGeometry(0.6, 12, 10),
    new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  _drone.add(_droneGlow);

  /* Arms + motors + rotors */
  [
    new THREE.Vector3( 0.62, 0,  0.62),
    new THREE.Vector3(-0.62, 0,  0.62),
    new THREE.Vector3( 0.62, 0, -0.62),
    new THREE.Vector3(-0.62, 0, -0.62),
  ].forEach((dir, i) => {
    const arm = _mk(new THREE.CylinderGeometry(0.022, 0.022, dir.length(), 4), aM);
    arm.position.copy(dir.clone().multiplyScalar(0.5));
    arm.lookAt(dir); arm.rotateX(Math.PI / 2);
    _drone.add(arm);
    const motorMesh = _mk(new THREE.CylinderGeometry(0.066, 0.066, 0.066, 8), bM);
    motorMesh.position.copy(dir);
    _drone.add(motorMesh);
    const r = _mk(new THREE.CircleGeometry(0.24, 14), rM);
    r.rotation.x = -Math.PI / 2;
    r.position.copy(dir).setY(dir.y + 0.045);
    _drone.add(r);
    _rotors.push(r);
  });

  /* Glow ring */
  _glowRing = _mk(
    new THREE.RingGeometry(0.32, 0.42, 28),
    new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  _glowRing.rotation.x = -Math.PI / 2;
  _glowRing.position.y = -0.18;
  _drone.add(_glowRing);

  _drone.position.set(SCAN_WPS[0].x, FH, SCAN_WPS[0].z);
  _scene.add(_drone);
}

/* ═══════════════════════════════════════════════════════════════════
   SCANNING FRUSTUM (attached to drone, Phase 1)
   ═══════════════════════════════════════════════════════════════════ */
function _buildFrustum() {
  const cGeo  = new THREE.ConeGeometry(1.4, 2.8, 8, 1, true);
  const cMat  = new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  _frustumCone = new THREE.Mesh(cGeo, cMat);
  _frustumCone.rotation.x = Math.PI; // point down
  _frustumCone.position.y = -1.4;

  const eMat = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.4 });
  _frustumEdge = new THREE.LineSegments(new THREE.EdgesGeometry(cGeo), eMat);
  _frustumEdge.rotation.x = Math.PI;
  _frustumEdge.position.y = -1.4;

  _drone.add(_frustumCone);
  _drone.add(_frustumEdge);

  _frustumCone.visible = false;
  _frustumEdge.visible = false;
}

/* ═══════════════════════════════════════════════════════════════════
   PATH VISUALS
   ═══════════════════════════════════════════════════════════════════ */
function _buildPathVisuals() {
  const pM = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(NAV_WPS.map(v => v.clone())), pM);
  _pathLine.visible = false;
  _scene.add(_pathLine);

  NAV_WPS.forEach((pt, i) => {
    const sm = new THREE.MeshBasicMaterial({ color: i === NAV_WPS.length-1 ? C.GREEN : C.CYAN, transparent: true, opacity: 0 });
    const s = _mk(new THREE.SphereGeometry(0.14, 8, 6), sm);
    s.position.copy(pt);
    s.visible = false;
    _scene.add(s);
    _ptSpheres.push(s);
  });

  const bM = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _bciPathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(BCI_WPS.map(v => v.clone())), bM);
  _bciPathLine.visible = false;
  _scene.add(_bciPathLine);
}

/* ═══════════════════════════════════════════════════════════════════
   TARGET ZONE
   ═══════════════════════════════════════════════════════════════════ */
function _buildTarget() {
  const tgt = BCI_WPS[BCI_WPS.length - 1];

  _targetHalo = _mk(
    new THREE.RingGeometry(0.55, 0.8, 32),
    new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  _targetHalo.rotation.x = -Math.PI / 2;
  _targetHalo.position.set(tgt.x, 0.06, tgt.z);
  _targetHalo.visible = false;
  _scene.add(_targetHalo);

  _targetBeacon = _mk(
    new THREE.CylinderGeometry(0.045, 0.045, 3.5, 8),
    new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 })
  );
  _targetBeacon.position.set(tgt.x, 1.75, tgt.z);
  _targetBeacon.visible = false;
  _scene.add(_targetBeacon);
}

/* ═══════════════════════════════════════════════════════════════════
   BCI BEAM
   ═══════════════════════════════════════════════════════════════════ */
function _buildBCIBeam() {
  _bciBeamMat  = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _bciBeam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1,0,0)]),
    _bciBeamMat
  );
  _bciBeam.visible = false;
  _scene.add(_bciBeam);

  _bciPulseMat = new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _bciPulse = _mk(new THREE.SphereGeometry(0.22, 10, 8), _bciPulseMat);
  _bciPulse.visible = false;
  _scene.add(_bciPulse);
}

/* ═══════════════════════════════════════════════════════════════════
   OPERATOR PANEL (DOM overlay in HUD)
   ═══════════════════════════════════════════════════════════════════ */
function _buildOperatorPanel(hudContainer) {
  if (!hudContainer) return;
  const root = hudContainer.parentElement || hudContainer;

  const op = document.createElement('div');
  op.id = 'nn-operator';
  op.style.cssText = `
    position:absolute; top:10px; right:10px; z-index:20;
    background:rgba(6,10,16,0.88);
    backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
    border:1px solid rgba(0,208,220,0.3); border-radius:8px;
    padding:10px 14px; min-width:190px;
    font-family:'DM Sans',sans-serif;
    opacity:0; transition:opacity 0.4s ease; pointer-events:none;
  `;
  op.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
      <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
        <circle cx="15" cy="12" r="7" stroke="#00D0DC" stroke-width="1.3" fill="rgba(0,208,220,0.07)"/>
        <path d="M8 12 Q7 7 15 6 Q23 7 22 12" stroke="#00D0DC" stroke-width="1.3" fill="none"/>
        <circle cx="8"  cy="12" r="1.8" fill="#00D0DC"/>
        <circle cx="22" cy="12" r="1.8" fill="#00D0DC"/>
        <circle cx="15" cy="5"  r="1.8" fill="#00D0DC"/>
        <path d="M11 19 Q15 22 19 19" stroke="#3d5070" stroke-width="1" fill="none"/>
        <line x1="15" y1="19" x2="15" y2="29" stroke="#3d5070" stroke-width="1"/>
      </svg>
      <div>
        <div style="color:#6b7a96;font-size:9px;letter-spacing:.12em;text-transform:uppercase;">Operator / BCI</div>
        <div id="nn-bci-label" style="color:#00D0DC;font-weight:700;font-size:11px;letter-spacing:.04em;">READY</div>
      </div>
    </div>
    <div id="nn-intent-box" style="
      background:rgba(0,208,220,0.07); border:1px solid rgba(0,208,220,0.2);
      border-radius:5px; padding:6px 9px;
      color:#c8d8ee; font-size:10px; font-weight:600; letter-spacing:.03em; line-height:1.45;
    ">EEG intent: STANDBY</div>
  `;
  root.appendChild(op);
  _operatorEl = op;
  _intentEl   = op.querySelector('#nn-intent-box');
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER LOOP
   ═══════════════════════════════════════════════════════════════════ */
function _loop() {
  let lastNow = performance.now();
  function frame(now) {
    if (_disposed) return;
    _raf = requestAnimationFrame(frame);
    const wdt = (now - lastNow) / 1000;
    lastNow   = now;
    const dt  = Math.min(wdt, 0.05);

    /* Rotor spin */
    _rotors.forEach((r, i) => {
      r.rotation.z += THREE.MathUtils.degToRad(240) * dt * (i % 2 ? -1 : 1);
    });

    /* Glow ring pulse */
    if (_glowRing) _glowRing.material.opacity = 0.35 + Math.sin(now * 0.004) * 0.18;

    /* Cyan point light tracks drone */
    if (_droneCyanLight && _drone) {
      _droneCyanLight.position.set(_drone.position.x, _drone.position.y + 1, _drone.position.z);
    }

    /* EEG waveform */
    if (_playing && _waveHudEl) _tickWave(dt);

    /* Sequence */
    if (_playing) { _seqT += dt; _tick(dt); }

    /* Chase camera — ALWAYS follows drone, no exceptions */
    _chaseCamera(dt);

    _rdr.render(_scene, _cam);
  }
  _raf = requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════════════════════════════
   FIXED OVERHEAD CAMERA — does not move at all.
   Positioned high above the scene looking straight down with a
   slight forward tilt so walls read in 3-D perspective.
   ═══════════════════════════════════════════════════════════════════ */
function _chaseCamera(_dt) {
  /* Camera is fully static — position and lookAt set once at init/reset.
     This function intentionally does nothing every frame. */
}

/* ═══════════════════════════════════════════════════════════════════
   SEQUENCE CONTROLLER
   ═══════════════════════════════════════════════════════════════════ */
function _tick(dt) {
  const now = _seqT;
  const P1  = T.SCAN;
  const P2  = P1 + T.NAV;
  const P3  = P2 + T.BCI;

  /* ──────────────────────────────────────────────────────────────
     PHASE 1  (0 → P1)  Drone scans, voxels build
     ────────────────────────────────────────────────────────────── */
  if (now < P1) {
    const p = now / P1;

    if (_phase < 1) {
      _phase = 1;
      _frustumCone.visible = true;
      _frustumEdge.visible = true;
      _hud('scanning', 'SCANNING', 'Building 3D map…');
    }

    /* Fly scanning patrol */
    _flyPath(SCAN_WPS, p, dt);

    /* Frustum flicker */
    _frustumCone.material.opacity = 0.07 + Math.abs(Math.sin(now * 4)) * 0.06;
    _frustumEdge.material.opacity = 0.35 + Math.abs(Math.sin(now * 4)) * 0.2;

    /* Reveal voxels */
    const tgt = Math.floor(p * _voxQueue.length);
    while (_voxBatch < tgt && _voxBatch < _voxQueue.length) {
      _voxQueue[_voxBatch].visible = true;
      _voxQueue[_voxBatch].material.opacity = 0;
      _voxBatch++;
    }
    const fw = 50;
    for (let i = Math.max(0, _voxBatch - fw); i < _voxBatch; i++) {
      const v = _voxQueue[i];
      if (v.material.opacity < 0.62) v.material.opacity += dt * 1.8;
    }

    if (_cmdHudEl) _cmdHudEl.textContent = `MAP ${Math.round(p * 100)}%`;
    return;
  }

  /* ──────────────────────────────────────────────────────────────
     PHASE 2  (P1 → P2)  Path drawn, drone navigates
     ────────────────────────────────────────────────────────────── */
  if (now < P2) {
    const loc = now - P1;
    const p   = loc / T.NAV;

    if (_phase < 2) {
      _phase = 2;
      _frustumCone.visible = false;
      _frustumEdge.visible = false;
      _drone.position.copy(NAV_WPS[0]);

      _pathLine.visible = true;
      _pathLine.material.opacity = 0;
      _animPath(NAV_WPS, 0, _pathLine);
      _hud('active', 'NAVIGATE', 'Collision-aware route…');
    }

    /* Draw path progressively in first 35% */
    if (p < 0.4) {
      _animPath(NAV_WPS, p / 0.4, _pathLine);
      _pathLine.material.opacity = Math.min(p / 0.2, 0.9);
    }

    /* Waypoint spheres */
    _ptSpheres.forEach((s, i) => {
      if (p > i / _ptSpheres.length * 0.35) {
        s.visible = true;
        s.material.opacity = Math.min(s.material.opacity + dt * 2.5, 0.9);
      }
    });

    /* Drone follows nav path */
    if (p >= 0.3) _flyPath(NAV_WPS, (p - 0.3) / 0.7, dt);
    else _drone.position.y = FH + Math.sin(_seqT * 2) * 0.06;

    return;
  }

  /* ──────────────────────────────────────────────────────────────
     PHASE 3  (P2 → P3)  BCI → intent label → target
     ────────────────────────────────────────────────────────────── */
  if (now < P3) {
    const loc = now - P2;
    const p   = loc / T.BCI;

    if (_phase < 3) {
      _phase = 3;
      _drone.position.copy(NAV_WPS[NAV_WPS.length - 1]);

      /* Show operator panel */
      if (_operatorEl) _operatorEl.style.opacity = '1';

      /* Show target */
      _targetHalo.visible   = true;
      _targetBeacon.visible = true;
    }

    /* Pulse target */
    _targetHalo.material.opacity   = 0.45 + Math.sin(_seqT * 5.5) * 0.2;
    _targetHalo.rotation.z        += dt * 0.4;
    _targetBeacon.material.opacity  = 0.3 + Math.sin(_seqT * 3)   * 0.12;

    /* Sub-phases */

    /* 0..1.5s: BCI builds up, waveform shows */
    if (loc < 1.5) {
      _hud('scanning', 'BCI READY', 'Awaiting command…');
      _setIntent('EEG intent: STANDBY', false);
      const lbl = _operatorEl?.querySelector('#nn-bci-label');
      if (lbl) lbl.textContent = 'BCI READY';
    }

    /* 1.5..3.5s: Command fires — beam + intent label */
    if (loc >= 1.5 && loc < 3.5) {
      _hud('veto', 'COMMAND SENT', 'TARGET ACQUIRED');
      _setIntent('EEG intent: MOVE TO TARGET AREA', true);
      const lbl = _operatorEl?.querySelector('#nn-bci-label');
      if (lbl) lbl.textContent = 'COMMAND SENT';

      /* Beam from operator-corner toward drone */
      _bciBeam.visible  = true;
      _bciPulse.visible = true;
      const src = new THREE.Vector3(_drone.position.x + 5, _drone.position.y + 4, _drone.position.z + 4);
      const dst = _drone.position.clone();
      _bciBeam.geometry.setFromPoints([src, dst]);
      _bciBeamMat.opacity = 0.6;

      const pt = ((loc - 1.5) / 2.0) % 1.0;
      _bciPulse.position.lerpVectors(src, dst, pt);
      _bciPulseMat.opacity = 0.9 - pt * 0.5;
    }

    /* 3.5..4.5s: Drone glows on receive */
    if (loc >= 3.5 && loc < 4.5) {
      const gp = (loc - 3.5);
      _droneGlow.material.opacity = Math.sin(gp * Math.PI) * 0.45;
      _bciBeamMat.opacity  = Math.max(0, 0.6 - (gp / 1.0) * 0.6);
      _bciPulseMat.opacity = Math.max(0, 0.5 - (gp / 1.0) * 0.5);
      if (gp > 0.9) { _bciBeam.visible = false; _bciPulse.visible = false; }
      _setIntent('EEG intent: MOVE TO TARGET AREA', true);
    }

    /* 4.5..8s: BCI path draws + drone flies to target */
    if (loc >= 4.5) {
      _droneGlow.material.opacity = Math.max(0, _droneGlow.material.opacity - dt * 1.5);
      _setIntent('EEG intent: MOVE TO TARGET AREA', true);

      _bciPathLine.visible = true;
      const drawP = Math.min((loc - 4.5) / 1.5, 1.0);
      _animPath(BCI_WPS, drawP, _bciPathLine);
      _bciPathLine.material.opacity = Math.min(_bciPathLine.material.opacity + dt * 3, 0.9);

      if (loc > 5.5) {
        const flyP = Math.min((loc - 5.5) / (T.BCI - 5.5), 1.0);
        _flyPath(BCI_WPS, flyP, dt);
      }

      const lbl = _operatorEl?.querySelector('#nn-bci-label');
      if (lbl && loc > 5) lbl.textContent = 'EN ROUTE';
      _hud('active', 'EN ROUTE', 'Flying to target…');
    }

    return;
  }

  /* ──────────────────────────────────────────────────────────────
     END CARD
     ────────────────────────────────────────────────────────────── */
  if (_phase < 4) {
    _phase = 4;
    _setIntent('EEG intent executed: TARGET REACHED ✓', false);
    const lbl = _operatorEl?.querySelector('#nn-bci-label');
    if (lbl) lbl.textContent = 'MISSION COMPLETE';
    _hud('active', 'TARGET REACHED', '');
    if (_intentEl) _intentEl.style.color = '#22C47B';
  }

  /* Hover at target */
  const tgt = BCI_WPS[BCI_WPS.length - 1];
  _drone.position.lerp(new THREE.Vector3(tgt.x, FH, tgt.z), dt * 1.5);
  _drone.position.y = FH + Math.sin(_seqT * 1.5) * 0.08;

  _targetHalo.material.opacity  = 0.3 + Math.sin(_seqT * 2.2) * 0.1;
  _targetBeacon.material.opacity = 0.25 + Math.sin(_seqT * 2.8) * 0.08;

  if (_seqT > P3 + T.HOLD) _playing = false;
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/* Smooth drone path follow (progress 0→1) */
function _flyPath(wps, progress, dt) {
  if (!wps || wps.length < 2) return;
  const n     = wps.length - 1;
  const tsc   = Math.min(Math.max(progress, 0), 1) * n;
  const idx   = Math.min(Math.floor(tsc), n - 1);
  const next  = Math.min(idx + 1, n);
  const frc   = tsc - idx;
  const from  = wps[idx];
  const to    = wps[next];
  if (!from || !to) return;
  const tgt = new THREE.Vector3().lerpVectors(from, to, Math.min(frc, 1));
  tgt.y = FH + Math.sin(performance.now() * 0.002) * 0.09;
  _drone.position.lerp(tgt, dt * 6);

  /* Face direction of travel */
  const dir = new THREE.Vector3().subVectors(to, from);
  if (dir.length() > 0.01) {
    _drone.rotation.y = THREE.MathUtils.lerp(_drone.rotation.y, Math.atan2(dir.x, dir.z), dt * 5);
  }
}

/* Progressive path drawing */
function _animPath(pts, progress, line) {
  const n   = pts.length - 1;
  const drn = Math.min(progress, 1) * n;
  const cnt = Math.floor(drn) + 1;
  const frc = drn - Math.floor(drn);
  const vis = [];
  for (let i = 0; i < Math.min(cnt, pts.length); i++) vis.push(pts[i].clone());
  if (cnt < pts.length) vis.push(new THREE.Vector3().lerpVectors(pts[cnt-1], pts[cnt], frc));
  if (vis.length >= 2) line.geometry.setFromPoints(vis);
}

/* HUD update */
function _hud(state, cmd, alert) {
  if (_cmdHudEl)   _cmdHudEl.textContent = cmd;
  if (_alertHudEl) _alertHudEl.textContent = alert || '—';
  if (_eegHudEl) {
    _eegHudEl.className = 'nn-eeg-dot';
    if (state === 'active')   _eegHudEl.classList.add('active');
    if (state === 'veto')     _eegHudEl.classList.add('veto');
    if (state === 'scanning') _eegHudEl.classList.add('active');
  }
}

function _setIntent(text, highlight) {
  if (!_intentEl) return;
  _intentEl.textContent = text;
  _intentEl.style.color      = highlight ? '#00D0DC' : '#c8d8ee';
  _intentEl.style.fontWeight = highlight ? '800' : '600';
  _intentEl.style.borderColor = highlight ? 'rgba(0,208,220,0.55)' : 'rgba(0,208,220,0.2)';
}

/* EEG waveform */
function _tickWave(dt) {
  const cv = _waveHudEl;
  if (!cv || !(cv instanceof HTMLCanvasElement)) return;
  const ctx = cv.getContext('2d');
  const W = cv.width  = cv.clientWidth  || 200;
  const H = cv.height = cv.clientHeight || 28;
  ctx.clearRect(0, 0, W, H);
  _waveOff += dt * 60;
  const mid = H / 2;
  const bci = _phase >= 3;
  const col = bci ? '#FF6B35' : '#00D0DC';
  ctx.strokeStyle = col;
  ctx.lineWidth   = 1.3;
  ctx.shadowBlur  = 5;
  ctx.shadowColor = col;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const xT = (x + _waveOff) / 17;
    let y = mid;
    y += Math.sin(xT * 2.1) * 4;
    y += Math.sin(xT * 5.6) * 2;
    y += Math.sin(xT * 11)  * 1;
    const sp = Math.sin(xT * 0.75);
    if (sp > 0.87) y -= sp * (bci ? 28 : 16);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/* Mesh factory */
function _mk(geo, mat) { return new THREE.Mesh(geo, mat); }

/* Deterministic pseudo-random */
function _det(x, z) { return Math.abs(Math.sin(x * 127.1 + z * 311.7) * 43758.5 % 1); }

/* Integer color lerp */
function _lerpc(a, b, t) {
  const ar=(a>>16)&0xff, ag=(a>>8)&0xff, ab=a&0xff;
  const br=(b>>16)&0xff, bg=(b>>8)&0xff, bb=b&0xff;
  return ((Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t));
}

/* ── PUBLIC API ───────────────────────────────────────────────────── */
window.NeuroScene = {
  initNeuroScene,
  playNeuroNerfSequence,
  pauseNeuroSequence,
  disposeNeuroScene,
};
