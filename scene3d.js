/* ═══════════════════════════════════════════════════════════════════
   NEURO-NERF 3D EXPLAINER — scene3d.js  v5  (restored + polished)

   3-Phase sequence (≈28 s) — isometric follow camera:
     Phase 1 — NeRF scanning: drone flies, voxels build     (8 s)
     Phase 2 — Map-guided navigation: path + drone flies    (8 s)
     Phase 3 — BCI command → labeled intent → target        (9 s)
     Hold     — end card                                    (3 s)

   Camera: smooth isometric follow that stays behind-above the drone,
   always 8–10 units back so the environment context is always visible.
   The drone is always in the lower-centre of frame.

   PUBLIC API:
     window.NeuroScene.initNeuroScene(canvasEl, hudContainer)
     window.NeuroScene.playNeuroNerfSequence()
     window.NeuroScene.pauseNeuroSequence()
     window.NeuroScene.disposeNeuroScene()
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── TIMING ──────────────────────────────────────────────────────── */
const DUR = {
  IMGS:  7.0,   // Phase 0 — 2-D camera frames converge → 3-D map builds
  SCAN:  0,     // skipped — scanning phase removed
  NAV:   9.0,   // route reveal + BCI command fires (drone stationary)
  FLY:   8.0,   // drone flies the full route to target
  HOLD:  3.0,
};

/* ── COLORS ──────────────────────────────────────────────────────── */
const C = {
  BG:       0x060a10,
  CYAN:     0x00D0DC,
  CYAN_DIM: 0x005060,
  GREEN:    0x22C47B,
  ORANGE:   0xFF6B35,
  WALL:     0x1e3050,
  WALL_E:   0x3a5580,
  DEBRIS:   0x1a2a40,
  DEBRIS_E: 0x2e4560,
  FLOOR:    0x0d1828,
};

const FH = 1.5; // drone flight height

/* ── STATE ───────────────────────────────────────────────────────── */
let _rdr, _scene, _cam, _clock, _raf = null, _disposed = false;
let _drone, _rotors = [], _glowRing, _droneGlow, _cyanLight;
let _frustumCone, _frustumEdge;
let _voxGrp, _voxQueue = [], _voxBatch = 0;
let _pathLine, _ptSpheres = [], _bciPathLine;
let _targetHalo, _targetBeacon;
let _bciBeamMat, _bciBeam, _bciPulseMat, _bciPulse;
let _eegHudEl, _cmdHudEl, _alertHudEl, _waveHudEl;
let _operatorEl, _intentEl, _bciLabelEl;
let _operatorFigure, _operatorGlowMesh;
let _imgFrames = [];   // Phase-0 camera frame planes
let _envSolids = [];   // opaque env meshes (walls, floor, debris…)
let _envEdges  = [];   // edge line-segs + grid (appear first as wireframe)
let _seqT = 0, _playing = false, _phase = 0, _waveOff = 0;

/* Fixed world position of the 3D operator figure (used as beam source).
   Placed close to the building's front-right entrance so it sits clearly
   in the foreground of the initial top-down camera view. */
const OPERATOR_POS = new THREE.Vector3(3.5, 1.8, 8.5);

/* Paths — all waypoints verified in open corridor space */
const SCAN_WPS = [];
const NAV_WPS  = [];
const BCI_WPS  = [];
const FULL_WPS = []; // NAV_WPS + BCI target — used for the flight phase

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
  _buildPaths();
  _buildTarget();
  _buildBCIBeam();
  _buildImageFrames();
  _buildOperatorFigure();

  _rdr.render(_scene, _cam);
  _renderLoop();
}

function playNeuroNerfSequence() {
  _seqT  = 0;
  _phase = 0;
  _voxBatch = 0;
  _waveOff  = 0;
  _playing  = true;

  /* Voxels start invisible — they materialise during Phase 0 (IMGS) */
  _voxGrp.children.forEach(v => { v.visible = true; v.material.opacity = 0.0; });
  _voxBatch = _voxQueue.length;

  /* Reset Phase-0 camera frames to start positions */
  _imgFrames.forEach(f => {
    f.mesh.visible = false;
    f.mesh.position.copy(f.startPos);
    f.mesh.rotation.copy(f.startRot);
    f.mesh.material.opacity = 0;
  });

  /* Reset environment to invisible — it builds during Phase 0 */
  _envEdges.forEach(o => {
    [o.material].flat().forEach(m => { m.opacity = 0; });
  });
  _envSolids.forEach(o => { o.material.opacity = 0; });

  /* Reset path */
  _pathLine.visible    = false;
  _bciPathLine.visible = false;
  _ptSpheres.forEach(s => { s.visible = false; s.material.opacity = 0; });

  /* Reset target */
  _targetHalo.visible    = false;
  _targetBeacon.visible  = false;
  _targetHalo.material.opacity    = 0;
  _targetBeacon.material.opacity  = 0;

  /* Reset BCI */
  _bciBeam.visible  = false;
  _bciPulse.visible = false;
  _bciBeamMat.opacity  = 0;
  _bciPulseMat.opacity = 0;

  /* Frustum not used — scanning is skipped */
  _frustumCone.visible = false;
  _frustumEdge.visible = false;

  /* Place drone at NAV start (Phase 2 start point) */
  const sp = NAV_WPS[0];
  _drone.position.set(sp.x, FH, sp.z);
  _drone.rotation.set(0, 0, 0);

  /* Reset operator panel */
  if (_operatorEl) _operatorEl.style.opacity = '0';
  if (_intentEl)   { _intentEl.textContent = 'EEG intent: STANDBY'; _intentEl.style.color = '#c8d8ee'; }
  if (_bciLabelEl) _bciLabelEl.textContent = 'BCI READY';

  /* Reset HUD */
  _hud('standby', 'PROCESSING', 'Reconstructing 3-D scene from images…');

  /* Camera starts high and pulled back for the IMGS phase */
  _cam.position.set(sp.x, FH + 18, sp.z + 14);
  _cam.lookAt(sp.x, FH, sp.z - 2);

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
   WAYPOINTS
   Layout: X∈[-8,8], Z∈[-8,7], corridors left(X≈-5), centre(X≈0), right(X≈5)
   ═══════════════════════════════════════════════════════════════════ */
function _buildWaypoints() {
  const h = FH;

  /* ── WALL MAP ─────────────────────────────────────────────────────
     Left-centre divider  : X = -3,   Z spans  -5 … +5
     Centre-right divider : X = +2.8, Z spans  -7 … +1
     Safe front crossing Z: > +5.5  (above both divider tops)
     Strategy: ALL divider crossings happen at Z = +5.5 via pure X moves.
     No diagonal moves ever cross a divider — lerp lag can't clip a wall.
     ────────────────────────────────────────────────────────────────── */

  /* Phase 1: start at crossing height, cross straight into centre, scan forward.
     No backtracking — drone moves continuously in one direction.
     Left-centre divider crossed at Z=5.5 > +5 (pure X move, zero diagonal). */
  [
    [-5, h,  5.5],  // ① left corridor at safe crossing height
    [ 0, h,  5.5],  // ② PURE X: cross left-centre divider at Z=5.5 ✓
    [ 1, h,  2  ],  // ③ enter centre corridor (pure -Z)
    [ 1, h, -3  ],  // ④ scan deeper into centre (pure -Z, no walls at X=1)
  ].forEach(([x,y,z]) => SCAN_WPS.push(new THREE.Vector3(x,y,z)));

  /* Phase 2: cross to right corridor via same front gap then descend */
  [
    [ 1, h,  3  ],  // ① from scan end
    [ 1, h,  5.5],  // ② move up to safe crossing height (pure +Z)
    [ 4, h,  5.5],  // ③ PURE X MOVE: cross centre-right divider at Z=5.5 > +1 ✓
    [ 4, h, -2  ],  // ④ descend right corridor (pure -Z)
    [ 4, h, -6  ],  // ⑤ deep right corridor near target (pure -Z)
  ].forEach(([x,y,z]) => NAV_WPS.push(new THREE.Vector3(x,y,z)));

  /* Phase 3: BCI-guided extension to target */
  [
    [ 4, h, -6],
    [ 5, h, -7],
  ].forEach(([x,y,z]) => BCI_WPS.push(new THREE.Vector3(x,y,z)));

  /* Full flight route: NAV path + BCI target (skip duplicate junction point) */
  NAV_WPS.forEach(v => FULL_WPS.push(v));
  BCI_WPS.slice(1).forEach(v => FULL_WPS.push(v));
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE
   ═══════════════════════════════════════════════════════════════════ */
function _buildScene(canvas) {
  const W = Math.max(canvas.offsetWidth,  800);
  const H = Math.max(canvas.offsetHeight, 480);

  _rdr = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, premultipliedAlpha: false });
  _rdr.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  _rdr.setSize(W, H, false);
  _rdr.setClearColor(C.BG, 1.0);

  _scene = new THREE.Scene();
  _scene.fog = new THREE.FogExp2(C.BG, 0.018); // gentle fog — doesn't hide nearby geometry

  _cam = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
  const sp = NAV_WPS[0];
  _cam.position.set(sp.x, FH + 14, sp.z + 10);
  _cam.lookAt(sp.x, FH, sp.z - 2);

  /* Bright lighting so environment is visible from frame 1 */
  _scene.add(new THREE.AmbientLight(0x445577, 1.8));
  const sun = new THREE.DirectionalLight(0x7799cc, 1.2);
  sun.position.set(5, 12, 8);
  _scene.add(sun);
  const fill = new THREE.DirectionalLight(0x334466, 0.5);
  fill.position.set(-5, 6, -4);
  _scene.add(fill);

  /* Cyan point light tracks drone */
  _cyanLight = new THREE.PointLight(C.CYAN, 1.5, 9);
  _scene.add(_cyanLight);

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
   ENVIRONMENT
   ═══════════════════════════════════════════════════════════════════ */
function _buildEnvironment() {
  _envSolids = [];
  _envEdges  = [];

  /* All solid materials start transparent — they fade in during Phase 0 */
  const wM = new THREE.MeshLambertMaterial({ color: C.WALL,   transparent: true, opacity: 0 });
  const dM = new THREE.MeshLambertMaterial({ color: C.DEBRIS, transparent: true, opacity: 0 });

  function solid(x, y, z, w, h, d, ry = 0, mat = wM, ec = C.WALL_E) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    _scene.add(m);
    _envSolids.push(m);   // tracked for fade-in

    const el = new THREE.LineSegments(
      new THREE.EdgesGeometry(g),
      new THREE.LineBasicMaterial({ color: ec, transparent: true, opacity: 0 })
    );
    el.position.copy(m.position);
    el.rotation.y = ry;
    _scene.add(el);
    _envEdges.push(el);   // tracked for early wireframe phase
  }

  /* Floor */
  const floorMat = new THREE.MeshLambertMaterial({ color: C.FLOOR, transparent: true, opacity: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 20), floorMat);
  floor.rotation.x = -Math.PI / 2;
  _scene.add(floor);
  _envSolids.push(floor);

  const grid = new THREE.GridHelper(24, 24, 0x2a4060, 0x1a2840);
  grid.position.y = 0.01;
  /* GridHelper has an array of two materials */
  [grid.material].flat().forEach(m => { m.transparent = true; m.opacity = 0; });
  _scene.add(grid);
  _envEdges.push(grid);

  /* Outer walls */
  solid(-8.85, 2.5,  0,   0.3, 5, 18);
  solid( 8.85, 2.5,  0,   0.3, 5, 18);
  solid(  0,   2.5, -8,  18,   5, 0.3);
  solid( -5,   2.5,  7,   6,   5, 0.3);
  solid(  5,   2.5,  7,   6,   5, 0.3);

  /* Interior dividers — create 3 clear corridors */
  solid(-3.0, 2.0,  0,   0.3, 4, 10);
  solid( 2.8, 2.0, -3,   0.3, 4,  8);

  /* Pillars */
  solid(-6.5, 2.0,  4,  0.65, 4, 0.65);
  solid(-6.5, 2.0, -3,  0.65, 4, 0.65);
  solid( 6.0, 2.0,  3,  0.65, 4, 0.65);
  solid( 6.0, 2.0, -5,  0.65, 4, 0.65);
  solid(  0,  2.0,  4,  0.65, 4, 0.65);

  /* Fallen beams */
  const bM = new THREE.MeshLambertMaterial({ color: 0x1e3048, transparent: true, opacity: 0 });
  solid( 1,  3.7,  5,  7,  0.22, 0.35,  0.2,  bM, 0x2e4560);
  solid(-4,  3.5, -3,  5,  0.22, 0.35, -0.12, bM, 0x2e4560);
  solid( 5,  3.3, -6,  4,  0.22, 0.35,  0.25, bM, 0x2e4560);

  /* Debris */
  const deb = [
    [-7.2,  3.5], [-7.0, -2.0], [-1.5, 3.0],
    [ 0.5,  5.0], [ 3.0,  1.0], [ 6.5,  0.5],
    [ 6.5, -6.0], [-5.0, -6.5], [ 0.5, -7.0],
  ];
  deb.forEach(([dx, dz], i) => {
    const sx = 0.6 + (i % 3) * 0.25, sy = 0.35 + (i % 4) * 0.18, sz = 0.5 + (i % 2) * 0.3;
    solid(dx, sy/2, dz, sx, sy, sz, i * 0.38, dM, C.DEBRIS_E);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   VOXEL FIELD
   ═══════════════════════════════════════════════════════════════════ */
function _buildVoxels() {
  _voxGrp  = new THREE.Group();
  _voxQueue = [];
  _scene.add(_voxGrp);

  const S   = 0.3;
  const geo = new THREE.BoxGeometry(S, S, S);
  const pos = [];

  function wallStrip(axis, fixed, a0, a1, y0, y1) {
    for (let a = a0; a <= a1; a += S * 2.8) {
      for (let y = y0; y <= y1; y += S * 2.8) {
        if (_det(a, y + fixed) < 0.5) continue;
        pos.push(axis === 'x'
          ? { x: fixed, y, z: a, t: 'wall' }
          : { x: a, y, z: fixed, t: 'wall' });
      }
    }
  }

  wallStrip('x', -8.7, -7, 7, 0.15, 4.5);
  wallStrip('x',  8.7, -7, 7, 0.15, 4.5);
  wallStrip('z', -7.7, -8, 8, 0.15, 4.5);
  wallStrip('x', -3.0, -4.5, 4.5, 0.15, 3.8);
  wallStrip('x',  2.8, -6.5, 3.5, 0.15, 3.8);

  /* Floor */
  for (let x = -8; x <= 8; x += S * 3.0) {
    for (let z = -7; z <= 7; z += S * 3.0) {
      if (_det(x, z) > 0.55) pos.push({ x, y: 0.14, z, t: 'floor' });
    }
  }

  const sp = SCAN_WPS[0];
  pos.sort((a, b) =>
    Math.hypot(a.x - sp.x, a.z - sp.z) -
    Math.hypot(b.x - sp.x, b.z - sp.z)
  );

  pos.forEach(p => {
    const t   = _det(p.x, p.z);
    const col = p.t === 'wall'
      ? _lerpc(C.CYAN_DIM, C.CYAN, t * 0.6)
      : _lerpc(C.CYAN_DIM, C.CYAN, t * 0.9);
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0,
      wireframe: t < 0.3,
    });
    const v = new THREE.Mesh(geo.clone(), mat);
    v.position.set(p.x, p.y, p.z);
    v.visible = false;
    _voxGrp.add(v);
    _voxQueue.push(v);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DRONE
   ═══════════════════════════════════════════════════════════════════ */
function _buildDrone() {
  _drone  = new THREE.Group();
  _rotors = [];

  const bM = new THREE.MeshLambertMaterial({ color: 0x2a4060 });
  const aM = new THREE.MeshLambertMaterial({ color: 0x1e3050 });
  const cM = new THREE.MeshBasicMaterial({ color: C.CYAN });
  const rM = new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.28, side: THREE.DoubleSide });

  /* Body */
  _drone.add(_mk(new THREE.BoxGeometry(0.55, 0.14, 0.55), bM));
  const hub = _mk(new THREE.SphereGeometry(0.1, 10, 8), cM);
  hub.position.y = 0.1;
  _drone.add(hub);

  /* Camera pod */
  const pod = _mk(new THREE.BoxGeometry(0.13, 0.09, 0.09), cM);
  pod.position.set(0, -0.04, 0.32);
  _drone.add(pod);

  /* Drone glow sphere (BCI receive) */
  _droneGlow = _mk(
    new THREE.SphereGeometry(0.65, 12, 10),
    new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  _drone.add(_droneGlow);

  /* Arms + rotors */
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
    const motor = _mk(new THREE.CylinderGeometry(0.066, 0.066, 0.066, 8), bM);
    motor.position.copy(dir);
    _drone.add(motor);
    const rotor = _mk(new THREE.CircleGeometry(0.24, 14), rM);
    rotor.rotation.x = -Math.PI / 2;
    rotor.position.copy(dir).setY(dir.y + 0.045);
    _drone.add(rotor);
    _rotors.push(rotor);
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
   FRUSTUM CONE (scanning phase)
   ═══════════════════════════════════════════════════════════════════ */
function _buildFrustum() {
  const g = new THREE.ConeGeometry(1.4, 2.8, 8, 1, true);

  _frustumCone = _mk(g, new THREE.MeshBasicMaterial({
    color: C.CYAN, transparent: true, opacity: 0.07,
    side: THREE.DoubleSide, depthWrite: false
  }));
  _frustumCone.rotation.x = Math.PI;
  _frustumCone.position.y = -1.4;
  _drone.add(_frustumCone);

  _frustumEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(g),
    new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.4 })
  );
  _frustumEdge.rotation.x = Math.PI;
  _frustumEdge.position.y = -1.4;
  _drone.add(_frustumEdge);

  _frustumCone.visible = false;
  _frustumEdge.visible = false;
}

/* ═══════════════════════════════════════════════════════════════════
   PATH VISUALS
   ═══════════════════════════════════════════════════════════════════ */
function _buildPaths() {
  const pM = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _pathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(NAV_WPS.map(v => v.clone())),
    pM
  );
  _pathLine.visible = false;
  _scene.add(_pathLine);

  NAV_WPS.forEach((pt, i) => {
    const sm = new THREE.MeshBasicMaterial({
      color: i === NAV_WPS.length - 1 ? C.GREEN : C.CYAN,
      transparent: true, opacity: 0
    });
    const s = _mk(new THREE.SphereGeometry(0.14, 8, 6), sm);
    s.position.copy(pt);
    s.visible = false;
    _scene.add(s);
    _ptSpheres.push(s);
  });

  const bM = new THREE.LineBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0 });
  _bciPathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(BCI_WPS.map(v => v.clone())),
    bM
  );
  _bciPathLine.visible = false;
  _scene.add(_bciPathLine);
}

/* ═══════════════════════════════════════════════════════════════════
   TARGET ZONE
   ═══════════════════════════════════════════════════════════════════ */
function _buildTarget() {
  const tgt = BCI_WPS[BCI_WPS.length - 1];

  _targetHalo = _mk(
    new THREE.RingGeometry(0.55, 0.82, 32),
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
   OPERATOR PANEL (DOM)
   ═══════════════════════════════════════════════════════════════════ */
/* ── helpers for Phase-0 camera frames ─────────────────────────── */
function _makeCamFrameCanvas(idx, totalFrames) {
  const W = 192, H = 128;
  const cv  = document.createElement('canvas');
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const camAngleDeg = Math.round((idx / totalFrames) * 360);

  /* Background */
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, W, H);

  /* Slight vignette */
  const vg = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  /* Stylised interior perspective — simple vanishing-point line-art */
  const a  = (camAngleDeg / 360) * Math.PI * 2;
  const cx = W / 2 + Math.cos(a) * 18;
  const cy = H / 2 - 4;
  ctx.strokeStyle = 'rgba(0,208,220,0.35)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);
  /* floor + walls radiating from vanishing point */
  const rays = 8;
  for (let r = 0; r < rays; r++) {
    const ra = (r / rays) * Math.PI * 1.6 - Math.PI * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ra) * W, cy + Math.sin(ra) * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  /* Horizontal depth lines */
  ctx.strokeStyle = 'rgba(0,208,220,0.18)';
  ctx.lineWidth = 0.6;
  for (let d = 1; d <= 4; d++) {
    const f  = d / 5;
    const hw = W * f * 0.5;
    const hh = H * f * 0.38;
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
  }

  /* Cyan corner bracket overlay */
  ctx.strokeStyle = '#00D0DC';
  ctx.lineWidth   = 1.8;
  const bk = 14;
  [[4,4],[W-4,4],[4,H-4],[W-4,H-4]].forEach(([bx, by]) => {
    const sx = bx < W/2 ? 1 : -1, sy = by < H/2 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(bx, by + sy*bk); ctx.lineTo(bx, by); ctx.lineTo(bx + sx*bk, by); ctx.stroke();
  });

  /* Thin outer border */
  ctx.strokeStyle = 'rgba(0,208,220,0.45)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(1.5, 1.5, W-3, H-3);

  /* Scan-line texture */
  ctx.fillStyle = 'rgba(0,208,220,0.028)';
  for (let y = 0; y < H; y += 3) { ctx.fillRect(0, y, W, 1); }

  /* ID label bottom-left */
  ctx.fillStyle = '#00D0DC';
  ctx.font      = 'bold 10px monospace';
  ctx.fillText(`CAM_${String(idx+1).padStart(2,'0')}`, 7, H - 18);
  ctx.fillStyle = 'rgba(0,208,220,0.6)';
  ctx.font      = '9px monospace';
  ctx.fillText(`θ ${camAngleDeg}° | NeRF INPUT`, 7, H - 7);

  /* Tiny REC dot top-right */
  ctx.fillStyle = '#FF6B35';
  ctx.beginPath(); ctx.arc(W-10, 10, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,107,53,0.3)';
  ctx.beginPath(); ctx.arc(W-10, 10, 7, 0, Math.PI*2); ctx.fill();

  return cv;
}

function _buildImageFrames() {
  _imgFrames = [];
  const N = 20;
  const rng = (a, b) => a + Math.random() * (b - a);

  for (let i = 0; i < N; i++) {
    const cv  = _makeCamFrameCanvas(i, N);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.87), mat);

    /* Spread start positions in a shell around the scene */
    const phi   = Math.acos(2 * rng(0,1) - 1);
    const theta = rng(0, Math.PI * 2);
    const r     = rng(14, 22);
    const sx    = r * Math.sin(phi) * Math.cos(theta);
    const sy    = rng(3, 12);
    const sz    = r * Math.sin(phi) * Math.sin(theta);

    mesh.position.set(sx, sy, sz);
    mesh.rotation.set(rng(-0.4, 0.4), rng(0, Math.PI*2), rng(-0.3, 0.3));
    mesh.visible = false;

    _scene.add(mesh);
    _imgFrames.push({
      mesh,
      startPos: new THREE.Vector3(sx, sy, sz),
      startRot: mesh.rotation.clone(),
      delay:    i * 0.22,   // staggered reveal
    });
  }
}

function _buildOperatorFigure() {
  const fig = new THREE.Group();

  const skinMat  = new THREE.MeshLambertMaterial({ color: 0xf0c090 });
  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2d4a6e });
  const legMat   = new THREE.MeshLambertMaterial({ color: 0x1a2a40 });
  const eegMat   = new THREE.MeshBasicMaterial({ color: C.CYAN });

  /* Head */
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), skinMat);
  head.position.y = 1.78;
  fig.add(head);

  /* Torso */
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.85, 8), bodyMat);
  torso.position.y = 1.12;
  fig.add(torso);

  /* Legs */
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 6), legMat);
  legL.position.set(-0.13, 0.36, 0);
  fig.add(legL);
  const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.72, 6), legMat);
  legR.position.set( 0.13, 0.36, 0);
  fig.add(legR);

  /* Arms — left arm slightly raised as if pointing */
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.68, 6), bodyMat);
  armL.position.set(-0.32, 1.2, 0);
  armL.rotation.z = 0.5;
  fig.add(armL);
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.68, 6), bodyMat);
  armR.position.set( 0.32, 1.2, 0);
  armR.rotation.z = -0.22;
  fig.add(armR);

  /* EEG headband */
  const bandMat = new THREE.MeshBasicMaterial({ color: C.CYAN, transparent: true, opacity: 0.85 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.045, 6, 24, Math.PI * 1.1), bandMat);
  band.position.y = 1.80;
  band.rotation.z = Math.PI;
  fig.add(band);

  /* EEG electrodes */
  const ePositions = [
    [-0.30, 1.80, 0],
    [ 0.30, 1.80, 0],
    [ 0,    2.08, 0],
  ];
  ePositions.forEach(([x, y, z]) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), eegMat);
    e.position.set(x, y, z);
    fig.add(e);
  });

  /* Signal glow aura (pulsed during BCI phase) */
  const glowMat = new THREE.MeshBasicMaterial({
    color: C.CYAN, transparent: true, opacity: 0.0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), glowMat);
  glow.position.y = 1.1;
  fig.add(glow);
  _operatorGlowMesh = glow;

  /* Ground shadow disc */
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000814, transparent: true, opacity: 0.35,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  fig.add(shadow);

  /* Label — small floating text sprite above head */
  const canvas  = document.createElement('canvas');
  canvas.width  = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(0,208,220,0.85)';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('BCI OPERATOR', 128, 40);
  const labelTex = new THREE.CanvasTexture(canvas);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, opacity: 0.9, depthTest: false });
  const label = new THREE.Sprite(labelMat);
  label.scale.set(2.0, 0.5, 1);
  label.position.y = 2.55;
  fig.add(label);

  /* Place just outside the building's front entrance, foreground of camera */
  fig.position.copy(OPERATOR_POS);
  fig.position.y = 0;
  /* Face slightly toward the building interior (-Z, slight -X lean) */
  fig.rotation.y = Math.PI * 0.92;

  _scene.add(fig);
  _operatorFigure = fig;
}

function _buildOperatorPanel(hudContainer) {
  if (!hudContainer) return;
  const root = hudContainer.parentElement || hudContainer;

  /* Clean up any previously injected panel */
  root.querySelector('#nn-operator')?.remove();
  root.querySelector('#nn-target-label')?.remove();

  const op = document.createElement('div');
  op.id = 'nn-operator';
  op.style.cssText = `
    position:absolute; top:12px; right:12px; z-index:20;
    background:rgba(6,10,18,0.92);
    backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
    border:1.5px solid rgba(0,208,220,0.4); border-radius:10px;
    box-shadow:0 0 24px rgba(0,208,220,0.12), inset 0 0 12px rgba(0,208,220,0.04);
    padding:14px 18px; min-width:250px;
    font-family:'DM Sans',sans-serif;
    opacity:0; transition:opacity 0.5s ease; pointer-events:none;
    display:flex; flex-direction:column; gap:10px;
  `;
  op.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="13" r="7.5" stroke="#00D0DC" stroke-width="1.3" fill="rgba(0,208,220,0.07)"/>
        <path d="M8.5 13 Q7.5 7.5 16 6.5 Q24.5 7.5 23.5 13" stroke="#00D0DC" stroke-width="1.3" fill="none"/>
        <circle cx="8.5"  cy="13" r="2" fill="#00D0DC"/>
        <circle cx="23.5" cy="13" r="2" fill="#00D0DC"/>
        <circle cx="16"   cy="6"  r="2" fill="#00D0DC"/>
        <path d="M12 21 Q16 24 20 21" stroke="#405070" stroke-width="1" fill="none"/>
        <line x1="16" y1="21" x2="16" y2="31" stroke="#405070" stroke-width="1"/>
      </svg>
      <div>
        <div style="color:#6b7a96;font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:3px;">Operator / BCI</div>
        <div id="nn-bci-label" style="color:#00D0DC;font-weight:700;font-size:14px;letter-spacing:.05em;">BCI READY</div>
      </div>
    </div>
    <div id="nn-intent-box" style="
      background:rgba(0,208,220,0.08); border:1px solid rgba(0,208,220,0.28);
      border-radius:6px; padding:8px 11px;
      color:#c8d8ee; font-size:11px; font-weight:600; letter-spacing:.03em; line-height:1.5;
      transition:all 0.3s ease;
    ">EEG intent: STANDBY</div>
  `;
  root.appendChild(op);
  _operatorEl = op;
  _intentEl   = op.querySelector('#nn-intent-box');
  _bciLabelEl = op.querySelector('#nn-bci-label');
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER LOOP
   ═══════════════════════════════════════════════════════════════════ */
function _renderLoop() {
  let lastNow = performance.now();
  function frame(now) {
    if (_disposed) return;
    _raf = requestAnimationFrame(frame);
    const wdt = (now - lastNow) / 1000;
    lastNow   = now;
    const dt  = Math.min(wdt, 0.05);

    /* Rotors */
    _rotors.forEach((r, i) => {
      r.rotation.z += THREE.MathUtils.degToRad(240) * dt * (i % 2 ? -1 : 1);
    });

    /* Glow ring */
    if (_glowRing) _glowRing.material.opacity = 0.3 + Math.sin(now * 0.004) * 0.18;

    /* Cyan light tracks drone */
    if (_cyanLight && _drone) {
      _cyanLight.position.set(_drone.position.x, _drone.position.y + 1.2, _drone.position.z);
    }

    /* EEG waveform */
    if (_playing && _waveHudEl) _tickWave(dt);

    /* Sequence */
    if (_playing) { _seqT += dt; _tick(dt); }

    /* Camera */
    _followCam(dt);

    _rdr.render(_scene, _cam);
  }
  _raf = requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════════════════════════════
   ISOMETRIC FOLLOW CAMERA
   Stays 8–11 units behind-above drone, so environment is always visible.
   Never gets inside geometry because it follows at a fixed world-space
   offset (not relative to drone yaw), only softly tracking position.
   ═══════════════════════════════════════════════════════════════════ */
function _followCam(dt) {
  if (!_drone || !_cam) return;

  const dp   = _drone.position;
  const yaw  = _drone.rotation.y;

  /* Blend between isometric (phase 1) and follow (phase 2+) */
  const followStrength = _phase >= 2 ? 0.55 : 0.25;

  /* Camera leans slightly behind drone's heading but stays mostly isometric */
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  /* Base offset: higher up, centered over the scene */
  const baseOff = new THREE.Vector3(0, 14, 10);
  /* Follow nudge: slight lean behind drone heading */
  const nudge   = new THREE.Vector3(sinY * 1.2, 0, cosY * 1.2);

  const ideal = new THREE.Vector3(
    dp.x + baseOff.x + nudge.x * followStrength,
    dp.y + baseOff.y,
    dp.z + baseOff.z + nudge.z * followStrength,
  );

  /* Hard clamp */
  ideal.x = Math.max(-5, Math.min(5, ideal.x));
  ideal.z = Math.max(-4, Math.min(13, ideal.z));
  ideal.y = Math.max(dp.y + 11, ideal.y);

  _cam.position.lerp(ideal, dt * 1.8);

  /* Look at drone + small forward bias */
  const lookAt = new THREE.Vector3(
    dp.x - sinY * 1.0,
    dp.y + 0.3,
    dp.z - cosY * 1.0,
  );
  _cam.lookAt(lookAt);
}

/* ═══════════════════════════════════════════════════════════════════
   SEQUENCE
   ═══════════════════════════════════════════════════════════════════ */
function _tick(dt) {
  const t  = _seqT;
  /* Phase boundaries */
  const P0 = 0;                    // 0  — Phase 0 start (IMGS)
  const P1 = P0 + DUR.IMGS;       // 7  — Phase 1 start (NAV / route reveal)
  const P2 = P1 + DUR.NAV;        // 16 — Phase 2 start (FLY)
  const P3 = P2 + DUR.FLY;        // 24 — end of flight

  /* ── PHASE 0: 2-D IMAGES → 3-D MAP RECONSTRUCTION  (0–7 s) ──
     0.0–1.5s : frames fade in at scattered positions (staggered)
     1.5–4.5s : frames orbit inward toward scene centre
     4.5–6.5s : frames converge + dissolve, voxels materialise
     6.5–7.0s : brief pause with fully-built voxel map
     ──────────────────────────────────────────────────────────── */
  if (t < P1) {
    const loc = t - P0;

    if (_phase < 1) {
      _phase = 1;
      _hud('standby', 'PROCESSING', 'Reconstructing 3-D scene from images…');
    }

    /* Scene centre (where frames converge) */
    const sceneCentre = new THREE.Vector3(0, 3.5, -1);

    _imgFrames.forEach((f, i) => {
      const showAt = f.delay;           // staggered reveal time
      if (loc < showAt) return;

      const age = loc - showAt;
      f.mesh.visible = true;

      /* 0–1.5s relative: fade in at start pos */
      if (age < 1.5) {
        f.mesh.material.opacity = Math.min(age / 1.0, 0.85);
        /* gentle tumble */
        f.mesh.rotation.y += dt * 0.4;
        return;
      }

      /* 1.5s–4s: fly toward scene centre, slow orbit */
      const flyAge = age - 1.5;
      const flyDur = 2.8;
      if (flyAge < flyDur) {
        const fp = flyAge / flyDur;
        const easedFp = fp < 0.5 ? 2*fp*fp : -1+(4-2*fp)*fp; // ease-in-out
        f.mesh.position.lerpVectors(f.startPos, sceneCentre.clone().add(
          new THREE.Vector3(
            Math.cos((i/20)*Math.PI*2 + loc*0.5) * (3.5 * (1 - easedFp)),
            Math.sin((i/20)*Math.PI*2 + loc*0.4) * (2.0 * (1 - easedFp)),
            Math.sin((i/20)*Math.PI*2 + loc*0.3) * (3.5 * (1 - easedFp))
          )
        ), dt * 1.6);
        f.mesh.rotation.y += dt * (0.9 - easedFp * 0.7);
        f.mesh.material.opacity = 0.85;
        return;
      }

      /* 4s+: converge to exact centre and fade out while voxels appear */
      const fadeAge = flyAge - flyDur;
      const fadeDur = 2.0;
      const fadeFrac = Math.min(fadeAge / fadeDur, 1.0);
      f.mesh.position.lerp(sceneCentre, dt * 3.5);
      f.mesh.material.opacity = Math.max(0, 0.85 * (1 - fadeFrac));
      f.mesh.scale.setScalar(1.0 - fadeFrac * 0.4);
      f.mesh.rotation.y += dt * 1.2;
    });

    /* ── Environment reconstruction, 3 stages ──────────────────────
       Stage 1 (1.5–3.5s): Edge wireframes fade in  → structure appears
       Stage 2 (3.5–5.5s): Solid surfaces fill in   → geometry solidifies
       Stage 3 (4.5–6.5s): Voxels overlay materialise → digital twin done
       ────────────────────────────────────────────────────────────── */
    const edgeP  = Math.max(0, Math.min(1, (loc - 1.5) / 2.0));  // 1.5→3.5
    const solidP = Math.max(0, Math.min(1, (loc - 3.5) / 2.0));  // 3.5→5.5
    const voxP   = Math.max(0, Math.min(1, (loc - 4.5) / 2.0));  // 4.5→6.5

    _envEdges.forEach(o => {
      [o.material].flat().forEach(m => { m.opacity = edgeP * 0.9; });
    });
    _envSolids.forEach(o => { o.material.opacity = solidP; });
    _voxGrp.children.forEach(v => { v.material.opacity = voxP * 0.55; });

    /* HUD steps through the reconstruction stages */
    if (loc < 1.5) {
      _hud('standby', 'PROCESSING', 'Ingesting 2-D camera images…');
    } else if (loc < 3.5) {
      _hud('scanning', 'RECONSTRUCTING', 'Building scene geometry…');
    } else if (loc < 5.5) {
      _hud('active', 'VOLUMETRIC MAP', 'Generating digital twin…');
    } else {
      _hud('active', 'MAP COMPLETE', 'NeRF scene ready');
    }

    /* Camera gently pulls inward to scene during IMGS phase */
    const sp = NAV_WPS[0];
    const camTargetY  = (FH + 18) - voxP * 4;
    const camTargetZ  = (sp.z + 14) - voxP * 4;
    _cam.position.y   = THREE.MathUtils.lerp(_cam.position.y, camTargetY, dt * 0.8);
    _cam.position.z   = THREE.MathUtils.lerp(_cam.position.z, camTargetZ, dt * 0.8);
    _cam.lookAt(sp.x, FH, sp.z - 2);

    /* Drone hovers at start position */
    _drone.position.copy(NAV_WPS[0]);
    _drone.position.y = FH + Math.sin(_seqT * 1.8) * 0.05;

    return;
  }

  /* ── PHASE 1: ROUTE REVEAL + BCI COMMAND (drone stationary) ──
     0–3s   : full route path draws on screen, target appears
     3–5s   : operator panel fades in, BCI READY
     5–7s   : operator fires beam → drone receives command
     7–9s   : drone glows, countdown to launch
     Drone does NOT move at all in this phase.
     ──────────────────────────────────────────────────────────── */
  if (t < P2) {
    const loc = t - P1;

    if (_phase < 2) {
      _phase = 2;
      _drone.position.copy(NAV_WPS[0]);

      /* Hide any lingering image frames */
      _imgFrames.forEach(f => { f.mesh.visible = false; });

      /* Ensure environment and voxels are fully visible */
      _envEdges.forEach(o => { [o.material].flat().forEach(m => { m.opacity = 0.9; }); });
      _envSolids.forEach(o => { o.material.opacity = 1.0; });
      _voxGrp.children.forEach(v => { v.material.opacity = 0.55; });

      /* Paths start hidden — they draw AFTER the BCI command lands */
      _pathLine.visible    = false;  _pathLine.material.opacity    = 0;
      _bciPathLine.visible = false;  _bciPathLine.material.opacity = 0;
      _ptSpheres.forEach(s => { s.visible = false; s.material.opacity = 0; });

      /* Target appears immediately so viewer knows what the operator is targeting */
      _targetHalo.visible   = true;  _targetHalo.material.opacity   = 0;
      _targetBeacon.visible = true;  _targetBeacon.material.opacity = 0;

      if (_operatorEl) _operatorEl.style.opacity = '0';
      _hud('standby', 'BCI READY', 'Operator preparing command…');
    }

    /* Target pulses throughout */
    _targetHalo.material.opacity   = Math.min(_targetHalo.material.opacity   + dt * 1.5, 0.45 + Math.sin(_seqT * 5.5) * 0.2);
    _targetHalo.rotation.z        += dt * 0.38;
    _targetBeacon.material.opacity = Math.min(_targetBeacon.material.opacity + dt * 1.0, 0.3 + Math.sin(_seqT * 3.2) * 0.1);

    /* Drone hovers in place throughout this phase */
    _drone.position.y = FH + Math.sin(_seqT * 2) * 0.06;

    /* ── 0–2s: Operator panel fades in, BCI READY ── */
    if (loc < 2.0) {
      const fp = loc / 2.0;
      if (_operatorEl) _operatorEl.style.opacity = String(Math.min(fp / 0.4, 1));
      _hud('standby', 'BCI READY', 'Operator preparing command…');
      _setIntent('EEG intent: STANDBY', false);
      if (_bciLabelEl) _bciLabelEl.textContent = 'BCI READY';
    }

    /* ── 2–4.5s: Beam fires — operator sends command to drone ── */
    if (loc >= 2.0 && loc < 4.5) {
      _hud('veto', 'COMMAND SENT', 'TARGET ACQUIRED');
      _setIntent('EEG intent: MOVE TO TARGET AREA', true);
      if (_bciLabelEl) _bciLabelEl.textContent = 'COMMAND SENT';

      _bciBeam.visible  = true;
      _bciPulse.visible = true;
      const src = OPERATOR_POS.clone();
      const dst = _drone.position.clone().add(new THREE.Vector3(0, 0.4, 0));
      _bciBeam.geometry.setFromPoints([src, dst]);
      _bciBeamMat.opacity = 0.75;

      const pt = ((loc - 2.0) / 2.5) % 1.0;
      _bciPulse.position.lerpVectors(src, dst, pt);
      _bciPulseMat.opacity = 0.9 - pt * 0.5;

      if (_operatorGlowMesh) {
        _operatorGlowMesh.material.opacity = 0.15 + Math.sin(Date.now() * 0.007) * 0.12;
      }
    }

    /* ── 4.5–6s: Drone receives command — glows, beam fades ── */
    if (loc >= 4.5 && loc < 6.0) {
      const gp = loc - 4.5;
      _droneGlow.material.opacity = Math.sin(Math.min(gp / 1.5, 1.0) * Math.PI) * 0.55;
      _bciBeamMat.opacity  = Math.max(0, 0.75 - gp * 0.9);
      _bciPulseMat.opacity = Math.max(0, 0.5  - gp * 0.7);
      if (_operatorGlowMesh) _operatorGlowMesh.material.opacity = Math.max(0, 0.27 - gp * 0.2);
      if (gp > 0.85) { _bciBeam.visible = false; _bciPulse.visible = false; }
      _hud('active', 'COMMAND RECEIVED', 'Computing optimal route…');
      if (_bciLabelEl) _bciLabelEl.textContent = 'COMPUTING ROUTE';
      _setIntent('EEG intent: MOVE TO TARGET AREA', true);
    }

    /* ── 6–9s: Route traces on screen (drone computed path post-command) ── */
    if (loc >= 6.0) {
      if (!_pathLine.visible) {
        _pathLine.visible    = true;
        _bciPathLine.visible = true;
      }
      const dp = Math.min((loc - 6.0) / 3.0, 1.0);
      _drawPath(NAV_WPS, dp, _pathLine);
      _pathLine.material.opacity = Math.min(dp / 0.2, 0.9);
      _drawPath(BCI_WPS, dp, _bciPathLine);
      _bciPathLine.material.opacity = Math.min(dp / 0.2, 0.7);
      _ptSpheres.forEach((s, i) => {
        if (dp > i / _ptSpheres.length) {
          s.visible = true;
          s.material.opacity = Math.min(s.material.opacity + dt * 3.0, 0.9);
        }
      });
      _hud('active', 'ROUTE COMPUTED', 'Launching…');
      if (_bciLabelEl) _bciLabelEl.textContent = 'LAUNCHING';
      _droneGlow.material.opacity = Math.max(0, _droneGlow.material.opacity - dt * 0.4);
    }

    return;
  }

  /* ── PHASE 2: DRONE FLIES FULL ROUTE ────────────────────────── */
  if (t < P3) {
    const loc = t - P2;
    const p   = loc / DUR.FLY;

    if (_phase < 3) {
      _phase = 3;
      _drone.position.copy(NAV_WPS[0]);
      _droneGlow.material.opacity = 0;
      _hud('active', 'EN ROUTE', 'Flying to target…');
      if (_bciLabelEl) _bciLabelEl.textContent = 'EN ROUTE';
    }

    _flyPath(FULL_WPS, p, dt);
    _setIntent('EEG intent: MOVE TO TARGET AREA', true);

    _targetHalo.material.opacity   = 0.45 + Math.sin(_seqT * 5.5) * 0.22;
    _targetHalo.rotation.z        += dt * 0.38;
    _targetBeacon.material.opacity  = 0.3 + Math.sin(_seqT * 3.2) * 0.12;

    return;
  }

  /* ── END CARD ───────────────────────────────────────────────── */
  if (_phase < 4) {
    _phase = 4;
    _setIntent('EEG intent executed: TARGET REACHED ✓', false);
    if (_intentEl) _intentEl.style.color = '#22C47B';
    if (_bciLabelEl) _bciLabelEl.textContent = 'MISSION COMPLETE';
    _hud('active', 'TARGET REACHED', '');
  }

  const tgt = FULL_WPS[FULL_WPS.length - 1];
  _drone.position.lerp(new THREE.Vector3(tgt.x, FH, tgt.z), dt * 1.5);
  _drone.position.y = FH + Math.sin(_seqT * 1.5) * 0.08;

  _targetHalo.material.opacity   = 0.3 + Math.sin(_seqT * 2.2) * 0.1;
  _targetBeacon.material.opacity = 0.25 + Math.sin(_seqT * 2.8) * 0.08;

  if (_seqT > P3 + DUR.HOLD) _playing = false;
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function _flyPath(wps, progress, dt) {
  if (!wps || wps.length < 2) return;
  const n    = wps.length - 1;
  const tsc  = Math.min(Math.max(progress, 0), 1) * n;
  const idx  = Math.min(Math.floor(tsc), n - 1);
  const next = Math.min(idx + 1, n);
  if (!wps[idx] || !wps[next]) return;
  const tgt = new THREE.Vector3().lerpVectors(wps[idx], wps[next], tsc - idx);
  tgt.y = FH + Math.sin(performance.now() * 0.002) * 0.09;
  _drone.position.lerp(tgt, dt * 5.5);

  const dir = new THREE.Vector3().subVectors(wps[next], wps[idx]);
  if (dir.length() > 0.01) {
    _drone.rotation.y = THREE.MathUtils.lerp(
      _drone.rotation.y, Math.atan2(dir.x, dir.z), dt * 4
    );
  }
}

function _drawPath(pts, progress, line) {
  const n   = pts.length - 1;
  const drn = Math.min(progress, 1) * n;
  const cnt = Math.floor(drn) + 1;
  const frc = drn - Math.floor(drn);
  const vis = [];
  for (let i = 0; i < Math.min(cnt, pts.length); i++) vis.push(pts[i].clone());
  if (cnt < pts.length) vis.push(new THREE.Vector3().lerpVectors(pts[cnt-1], pts[cnt], frc));
  if (vis.length >= 2) line.geometry.setFromPoints(vis);
}

function _hud(state, cmd, alert) {
  if (_cmdHudEl)   _cmdHudEl.textContent  = cmd;
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
  _intentEl.textContent  = text;
  _intentEl.style.color  = highlight ? '#00D0DC' : '#c8d8ee';
  _intentEl.style.fontWeight  = highlight ? '800' : '600';
  _intentEl.style.borderColor = highlight
    ? 'rgba(0,208,220,0.55)'
    : 'rgba(0,208,220,0.22)';
}

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

function _mk(geo, mat) { return new THREE.Mesh(geo, mat); }
function _det(x, z) { return Math.abs(Math.sin(x * 127.1 + z * 311.7) * 43758.5 % 1); }
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
