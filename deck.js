/* ═══════════════════════════════════════════════════════════════
   NEURO-NERF PRESENTATION DECK — deck.js
   Complete navigation, animations, canvas art, dashboard logic
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ─────────────────────────────────────────────────────────
const state = {
  current: 1,
  total: 11,
  transitioning: false,
  revealIndex: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0 },
  slideInitialized: {},
};

// ── DOM REFS ──────────────────────────────────────────────────────
const deck    = document.getElementById('deck');
const slides  = Array.from(document.querySelectorAll('.slide'));
const counter = document.getElementById('slideCounter');

// ── INIT ──────────────────────────────────────────────────────────
function init() {
  updateNav();
  initSlide(1);
  startBackgroundAnimations();
  bindEvents();
}

function updateNav() {
  if (counter) counter.textContent = `${state.current} / ${state.total}`;
}

// ── NAVIGATION ───────────────────────────────────────────────────
function goToSlide(target, direction) {
  if (state.transitioning || target === state.current) return;
  if (target < 1 || target > state.total) return;

  state.transitioning = true;
  const dir = direction || (target > state.current ? 1 : -1);
  const prev = state.current;
  state.current = target;

  const outSlide = slides[prev - 1];
  const inSlide  = slides[target - 1];

  // Animate out
  outSlide.style.zIndex = '1';
  inSlide.style.zIndex  = '2';
  inSlide.style.opacity = '1';
  inSlide.style.pointerEvents = 'all';

  const outClass = dir > 0 ? 'slide-exit-to-left'   : 'slide-exit-to-right';
  const inClass  = dir > 0 ? 'slide-enter-from-right': 'slide-enter-from-left';

  outSlide.classList.add(outClass);
  inSlide.classList.add(inClass);
  inSlide.classList.add('active');

  setTimeout(() => {
    outSlide.classList.remove('active', outClass);
    outSlide.style.opacity = '';
    outSlide.style.pointerEvents = '';
    outSlide.style.zIndex = '';
    inSlide.classList.remove(inClass);
    inSlide.style.zIndex = '';
    state.transitioning = false;
    updateNav();
    initSlide(target);
  }, 600);

}

function advance() {
  if (state.current < state.total) {
    goToSlide(state.current + 1, 1);
  }
}

function retreat() {
  if (state.current > 1) {
    goToSlide(state.current - 1, -1);
  }
}

// ── EVENTS ───────────────────────────────────────────────────────
function bindEvents() {
  // Click anywhere on the deck to advance (right half) or go back (left half)
  deck.addEventListener('click', e => {
    // Ignore clicks on interactive controls inside slides (buttons, canvases, etc.)
    if (e.target.closest('button, canvas, a, input, select, textarea, .gallery-lightbox, #galleryLightbox')) return;
    const half = window.innerWidth / 2;
    e.clientX >= half ? advance() : retreat();
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
    if (e.key === 'ArrowLeft')                   { e.preventDefault(); retreat(); }
    if (e.key === 'Home')                        { e.preventDefault(); goToSlide(1); }
    if (e.key === 'End')                         { e.preventDefault(); goToSlide(state.total); }
    if (e.key >= '1' && e.key <= '9')            goToSlide(parseInt(e.key));
    if (e.key === '0')                           goToSlide(10);
    if (e.key === '-' || e.key === '=')         goToSlide(11);
  });

  // Touch swipe
  let touchStartX = 0;
  deck.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  deck.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) { dx < 0 ? advance() : retreat(); }
  }, { passive: true });
}

// ── SLIDE INIT CONTROLLER ────────────────────────────────────────
function initSlide(n) {
  if (state.slideInitialized[n]) {
    // Re-run animations on re-entry
    if (n === 5) {
      // Replay 3D sequence on re-visit
      if (window.NeuroScene) window.NeuroScene.playNeuroNerfSequence();
    }
    return;
  }
  state.slideInitialized[n] = true;

  switch(n) {
    case 1: initTitleCanvas(); break;
    case 2: initUrgencyCanvas(); initUrgencyReveals(); break;
    case 3: initIssuesCanvas(); initIssuesReveals(); break;
    case 4: initSystemCanvas(); initPipelineReveals(); break;
    case 5: {
      const canvas3d = document.getElementById('neuroNerf3D');
      const hud3d    = document.getElementById('s3dHud');
      if (canvas3d && window.NeuroScene) {
        window.NeuroScene.initNeuroScene(canvas3d, hud3d);
        window.NeuroScene.playNeuroNerfSequence();
      }
      break;
    }
    case 6: initTechCanvas(); initTechReveals(); break;
    case 7: initRoadmapCanvas(); initRoadmapReveals(); break;
    case 8: initBeyondCanvas(); initBeyondReveals(); break;
    case 9: initWorkflowCanvas(); initWorkflowReveals(); break;
    case 10: initClosingCanvas(); break;
    case 11: initGalleryLightbox(); break;
  }
}

let galleryLightboxBound = false;
function initGalleryLightbox() {
  if (galleryLightboxBound) return;
  const lightbox = document.getElementById('galleryLightbox');
  const lbImg = document.getElementById('galleryLightboxImg');
  const closeBtn = document.getElementById('galleryLightboxClose');
  const tiles = document.querySelectorAll('.slide--gallery .gallery-tile');
  if (!lightbox || !lbImg || !closeBtn || !tiles.length) return;
  galleryLightboxBound = true;

  function showFromTile(tile) {
    const img = tile.querySelector('img');
    if (!img) return;
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || '';
    lightbox.hidden = false;
    lightbox.removeAttribute('hidden');
    lightbox.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      lightbox.classList.add('is-open');
      closeBtn.focus({ preventScroll: true });
    });
  }

  function hideNow() {
    if (!lightbox.classList.contains('is-open')) return;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.hidden = true;
    lbImg.removeAttribute('src');
    lbImg.alt = '';
  }

  function onGalleryKeydown(e) {
    if (!lightbox.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideNow();
      return;
    }
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  tiles.forEach(tile => {
    tile.addEventListener('click', e => {
      e.stopPropagation();
      showFromTile(tile);
    });
  });

  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    hideNow();
  });

  document.addEventListener('keydown', onGalleryKeydown, true);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 1 — TITLE CANVAS (Animated neural network + drone paths)
// ══════════════════════════════════════════════════════════════════
function initTitleCanvas() {
  const canvas = document.getElementById('titleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let raf;

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Neural nodes
  const nodes = Array.from({ length: 28 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 2 + 1,
    pulse: Math.random() * Math.PI * 2,
  }));

  function draw(t) {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update nodes
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy; n.pulse += 0.015;
      if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
    });

    // Draw connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 180) {
          const alpha = (1 - dist/180) * 0.12;
          ctx.strokeStyle = `rgba(0,208,220,${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    nodes.forEach(n => {
      const pulse = Math.sin(n.pulse) * 0.5 + 0.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,208,220,${0.2 + pulse * 0.3})`;
      ctx.fill();
    });

    // Faint horizontal grid lines (bottom half)
    ctx.strokeStyle = 'rgba(0,208,220,0.025)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    raf = requestAnimationFrame(draw);
  }

  raf = requestAnimationFrame(draw);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 2 — URGENCY CANVAS + REVEALS
// ══════════════════════════════════════════════════════════════════
function initUrgencyCanvas() {
  const canvas = document.getElementById('urgencyCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Warm radial glow — upper left corner
    const g1 = ctx.createRadialGradient(W * 0.12, H * 0.18, 0, W * 0.12, H * 0.18, W * 0.55);
    g1.addColorStop(0, 'rgba(255,107,53,0.06)');
    g1.addColorStop(0.5, 'rgba(255,59,59,0.03)');
    g1.addColorStop(1, 'transparent');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    // Secondary cool glow — lower right
    const g2 = ctx.createRadialGradient(W * 0.9, H * 0.85, 0, W * 0.9, H * 0.85, W * 0.4);
    g2.addColorStop(0, 'rgba(0,208,220,0.03)');
    g2.addColorStop(1, 'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    // Subtle horizontal tension lines
    ctx.strokeStyle = 'rgba(255,80,60,0.035)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const y = (H / 10) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }
  draw();
  window.addEventListener('resize', draw);
}

function initUrgencyReveals() {
  const statBlocks = document.querySelectorAll('#deck .slide--urgency .stat-block');
  const problemBox = document.querySelector('#deck .slide--urgency .urgency-problem-box');
  const photos     = document.querySelector('#deck .slide--urgency .urgency-photos');
  const delays = [0, 220, 440];

  statBlocks.forEach((block, i) => {
    setTimeout(() => {
      block.classList.add('revealed');
      const el = block.querySelector('.stat-number');
      if (el.classList.contains('stat-number--static')) return;
      const target = parseFloat(el.dataset.target);
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      animateNumber(el, 0, target, 1000, prefix, suffix);
    }, 150 + delays[i]);
  });

  if (problemBox) setTimeout(() => problemBox.classList.add('revealed'), 1050);
  if (photos)     setTimeout(() => photos.classList.add('revealed'), 200);
}

function animateNumber(el, from, to, duration, prefix='', suffix='') {
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // cubic ease out
    const val = from + (to - from) * ease;
    const formatted = to >= 1000
      ? Math.round(val).toLocaleString()
      : val.toFixed(to < 10 ? 1 : 0);
    el.textContent = prefix + formatted + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 3 — SYSTEM CANVAS + PIPELINE REVEALS
// ══════════════════════════════════════════════════════════════════
function initSystemCanvas() {
  const canvas = document.getElementById('systemCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Radial glow center
    const grd = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width*0.6);
    grd.addColorStop(0, 'rgba(0,208,220,0.04)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = 'rgba(0,208,220,0.02)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }
  draw();
  window.addEventListener('resize', draw);
}

function initPipelineReveals() {
  const stages  = document.querySelectorAll('#deck .slide--system .pipeline-stage');
  const arrows  = document.querySelectorAll('#deck .slide--system .pipeline-arrow');
  const princi  = document.querySelector('#deck .slide--system .system-principle');

  stages.forEach((s, i) => {
    setTimeout(() => {
      s.classList.add('revealed', 'active-stage');
      if (i > 0) stages[i-1].classList.remove('active-stage');
      if (arrows[i-1]) arrows[i-1].classList.add('revealed');
    }, 100 + i * 280);
  });

  // Last stage remains active
  setTimeout(() => {
    stages.forEach(s => s.classList.remove('active-stage'));
    stages[stages.length - 1].classList.add('active-stage');
    if (princi) princi.classList.add('revealed');
  }, 100 + stages.length * 280 + 100);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 4 — MISSION DASHBOARD
// ══════════════════════════════════════════════════════════════════
function initDashboard() {
  state.dashboardStep = 0;

  // Init EEG canvas
  const eegCanvas = document.getElementById('eegCanvas');
  if (eegCanvas) animateEEG(eegCanvas);

  // Init map canvas
  const mapCanvas = document.getElementById('mapCanvas');
  if (mapCanvas) initMapCanvas(mapCanvas);

  // Start mission clock
  startMissionClock();

  // Run the reveal sequence automatically
  runDashboardSequence();
}

function startMissionClock() {
  let seconds = 4 * 60 + 32;
  const el = document.getElementById('missionTime');
  if (!el) return;

  setInterval(() => {
    seconds++;
    const m = Math.floor(seconds / 60).toString().padStart(2,'0');
    const s = (seconds % 60).toString().padStart(2,'0');
    el.textContent = `${m}:${s}`;
  }, 1000);
}

function animateEEG(canvas) {
  const ctx = canvas.getContext('2d');
  let offset = 0;

  function draw() {
    canvas.width  = canvas.offsetWidth || 300;
    canvas.height = canvas.offsetHeight || 60;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0,208,220,0.8)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0,208,220,0.4)';
    ctx.beginPath();

    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;

    for (let x = 0; x < w; x++) {
      const t = (x + offset) / 30;
      let y = mid;
      // EEG-like signal: base sine + noise + occasional spike
      y += Math.sin(t * 2.1) * 6;
      y += Math.sin(t * 5.3) * 3;
      y += Math.sin(t * 11.7) * 1.5;
      // Spike
      const spike = Math.sin(t * 0.8);
      if (spike > 0.9) y -= spike * 25;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    offset += 1.5;
    requestAnimationFrame(draw);
  }
  draw();
}

// Map canvas — draws a top-down schematic of a damaged floor plan
let mapRoutePath = null;
let mapReplanPath = null;
let mapAnimState = 'initial'; // initial, route, danger, veto, replan

function initMapCanvas(canvas) {
  const ctx = canvas.getContext('2d');

  // Room / debris layout
  const rooms = [
    { x: 40,  y: 40,  w: 120, h: 80 },
    { x: 200, y: 40,  w: 100, h: 80 },
    { x: 340, y: 40,  w: 140, h: 80 },
    { x: 40,  y: 160, w: 80,  h: 100 },
    { x: 180, y: 140, w: 120, h: 120 },
    { x: 360, y: 140, w: 100, h: 120 },
  ];

  const debris = [
    { x: 150, y: 105, w: 38, h: 18, r: -15 },   // left scatter
    { x: 290, y: 62,  w: 28, h: 14, r: 10  },   // top-right scatter
    { x: 78,  y: 198, w: 34, h: 18, r: -5  },   // left-wall rubble
    { x: 238, y: 195, w: 50, h: 22, r:  8  },   // inside danger zone ← primary hazard
    { x: 245, y: 240, w: 42, h: 18, r: -10 },   // inside danger zone ← secondary hazard
    { x: 400, y: 172, w: 28, h: 12, r: -12 },   // right scatter
  ];

  // AI-planned route — cuts directly through the danger zone (structural collapse area)
  const routeWaypoints = [
    [55, 265],   // START — bottom left
    [55, 130],   // up left corridor
    [145, 88],   // angle toward top-centre
    [248, 88],   // across top — approaching danger zone from above
    [258, 168],  // heads DOWN into danger zone (x 230-300, y 148-290)
    [258, 265],  // through hazard zone toward target
    [430, 265],  // TARGET — bottom right
  ];
  // Replanned safe route — arcs right, completely bypassing the danger zone
  const replanWaypoints = [
    [55, 265],
    [55, 130],
    [145, 88],
    [248, 88],
    [345, 88],   // continue right, staying ABOVE and right of danger zone
    [430, 130],  // curve down clear of zone
    [430, 265],  // TARGET
  ];

  let routeProgress  = 0;   // 0..1
  let replanProgress = 0;
  let dronePos = { x: 50, y: 270 };
  let showDanger = false;
  let showVeto   = false;
  let showReplan = false;
  let dangerPulse = 0;

  function draw() {
    canvas.width  = canvas.offsetWidth || 600;
    canvas.height = canvas.offsetHeight || 300;
    const W = canvas.width;
    const H = canvas.height;
    const scaleX = W / 530;
    const scaleY = H / 310;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(scaleX, scaleY);

    // Background
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, 530, 310);

    // Grid
    ctx.strokeStyle = 'rgba(0,208,220,0.04)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < 530; x += 20) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,310); ctx.stroke();
    }
    for (let y = 0; y < 310; y += 20) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(530,y); ctx.stroke();
    }

    // Rooms (wireframe)
    rooms.forEach(r => {
      ctx.strokeStyle = 'rgba(0,208,220,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(0,208,220,0.02)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });

    // Debris
    debris.forEach(d => {
      ctx.save();
      ctx.translate(d.x + d.w/2, d.y + d.h/2);
      ctx.rotate(d.r * Math.PI / 180);
      ctx.fillStyle = showDanger
        ? `rgba(255,59,59,${0.25 + Math.sin(dangerPulse) * 0.1})`
        : 'rgba(80,70,60,0.5)';
      ctx.strokeStyle = showDanger ? 'rgba(255,59,59,0.6)' : 'rgba(120,100,80,0.3)';
      ctx.lineWidth = 0.8;
      ctx.fillRect(-d.w/2, -d.h/2, d.w, d.h);
      ctx.strokeRect(-d.w/2, -d.h/2, d.w, d.h);
      ctx.restore();
    });

    // Route
    if (routeProgress > 0 && !showReplan) {
      drawRoute(ctx, routeWaypoints, routeProgress,
        showVeto ? 'rgba(255,107,53,0.6)' : 'rgba(0,208,220,0.7)', 2.5, showDanger);
    }

    // Replan route
    if (showReplan && replanProgress > 0) {
      drawRoute(ctx, replanWaypoints, replanProgress, 'rgba(34,196,123,0.85)', 2.5, false);
    }

    // Danger zone overlay — centred over the route at x≈258, y 148-290
    if (showDanger) {
      dangerPulse += 0.08;
      const alpha = 0.08 + Math.sin(dangerPulse) * 0.04;
      ctx.fillStyle = `rgba(255,59,59,${alpha})`;
      ctx.fillRect(228, 148, 70, 142);
      ctx.strokeStyle = `rgba(255,59,59,${0.35 + Math.sin(dangerPulse) * 0.15})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(228, 148, 70, 142);
      ctx.setLineDash([]);

      // Hazard label inside box
      ctx.fillStyle = `rgba(255,59,59,${0.55 + Math.sin(dangerPulse) * 0.2})`;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STRUCTURAL', 263, 164);
      ctx.fillText('HAZARD', 263, 174);
      ctx.textAlign = 'left';
    }

    // Drone dot
    ctx.beginPath();
    ctx.arc(dronePos.x, dronePos.y, 5, 0, Math.PI*2);
    ctx.fillStyle = showReplan ? '#22C47B' : '#00D0DC';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dronePos.x, dronePos.y, 10, 0, Math.PI*2);
    ctx.fillStyle = showReplan ? 'rgba(34,196,123,0.2)' : 'rgba(0,208,220,0.2)';
    ctx.fill();

    // Drone cross-hair
    ctx.strokeStyle = showReplan ? 'rgba(34,196,123,0.6)' : 'rgba(0,208,220,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(dronePos.x - 14, dronePos.y);
    ctx.lineTo(dronePos.x + 14, dronePos.y);
    ctx.moveTo(dronePos.x, dronePos.y - 14);
    ctx.lineTo(dronePos.x, dronePos.y + 14);
    ctx.stroke();

    ctx.restore();
    requestAnimationFrame(draw);
  }

  function drawRoute(ctx, waypoints, progress, color, width, dashed) {
    const totalSegments = waypoints.length - 1;
    const totalDist = waypoints.reduce((acc, wp, i) => {
      if (i === 0) return 0;
      const dx = wp[0] - waypoints[i-1][0];
      const dy = wp[1] - waypoints[i-1][1];
      return acc + Math.sqrt(dx*dx+dy*dy);
    }, 0);

    let drawn = progress * totalDist;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowBlur = 6;
    ctx.shadowColor = color;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();

    let moved = false;
    let cumDist = 0;

    for (let i = 1; i < waypoints.length; i++) {
      const dx = waypoints[i][0] - waypoints[i-1][0];
      const dy = waypoints[i][1] - waypoints[i-1][1];
      const segLen = Math.sqrt(dx*dx+dy*dy);

      if (cumDist >= drawn) break;

      if (!moved) { ctx.moveTo(waypoints[i-1][0], waypoints[i-1][1]); moved = true; }

      if (cumDist + segLen <= drawn) {
        ctx.lineTo(waypoints[i][0], waypoints[i][1]);
        // Update drone pos to end of this segment
        dronePos.x = waypoints[i][0];
        dronePos.y = waypoints[i][1];
      } else {
        const frac = (drawn - cumDist) / segLen;
        const px = waypoints[i-1][0] + dx * frac;
        const py = waypoints[i-1][1] + dy * frac;
        ctx.lineTo(px, py);
        dronePos.x = px;
        dronePos.y = py;
      }
      cumDist += segLen;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  draw();

  // Expose controls for sequence
  mapRoutePath  = { advance: () => { routeProgress = Math.min(routeProgress + 0.004, 1); } };
  window._mapState = {
    setRouteProgress: v => { routeProgress = v; },
    setShowDanger: v => { showDanger = v; },
    setShowVeto: v => { showVeto = v; },
    setShowReplan: v => { showReplan = v; },
    setReplanProgress: v => { replanProgress = v; },
    resetDronePo: () => { dronePos = { x: 50, y: 270 }; },
  };

  // Animate route progress continuously — speed 0.004 so at 2.5 s the drone
  // reaches progress ≈ 0.60, placing it right at the hazard-zone entrance.
  (function animLoop() {
    if (routeProgress < 1 && !showDanger)  routeProgress = Math.min(routeProgress + 0.004, 1);
    if (showReplan && replanProgress < 1)  replanProgress = Math.min(replanProgress + 0.004, 1);
    requestAnimationFrame(animLoop);
  })();
}

function runDashboardSequence() {
  state.dashboardStep = 0;

  // Reset map state
  if (window._mapState) {
    window._mapState.setRouteProgress(0);
    window._mapState.setShowDanger(false);
    window._mapState.setShowVeto(false);
    window._mapState.setShowReplan(false);
    window._mapState.setReplanProgress(0);
    window._mapState.resetDronePo?.();
  }

  // Reset log entries
  ['log1','log2','log3','log4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(-8px)'; }
  });

  // Reset chips
  ['chipDanger','chipVeto','chipReplan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Reset EEG dot
  const eegDot = document.getElementById('eegDot');
  if (eegDot) { eegDot.classList.add('active'); }

  // Reset system status
  const sysSafety = document.getElementById('sysSafety');
  if (sysSafety) { sysSafety.textContent = 'COMPUTING'; sysSafety.style.color = '#fdab43'; }

  const cmdValue = document.getElementById('cmdValue');
  if (cmdValue) cmdValue.textContent = 'ADVANCE';

  setNarrative('The responder sets intent. AI plots a safe route through the debris.');

  // Step sequence timeline
  // Step 1 (1s): Route computed
  setTimeout(() => {
    showLog('log1');
    if (sysSafety) { sysSafety.textContent = 'CLEAR'; sysSafety.style.color = '#22C47B'; }
  }, 1000);

  // Step 2 (2.5s): Danger detected
  setTimeout(() => {
    showLog('log2');
    if (window._mapState) window._mapState.setShowDanger(true);
    const chipDanger = document.getElementById('chipDanger');
    if (chipDanger) chipDanger.style.display = 'block';
    if (sysSafety) { sysSafety.textContent = 'HAZARD'; sysSafety.style.color = '#FF3B3B'; }
    if (cmdValue) cmdValue.textContent = 'HOLD';
    setNarrative('Structural instability detected. The human perceives the hazard.');
  }, 2500);

  // Step 3 (4s): ErrP veto — drone is already frozen at hazard-zone entrance
  // (showDanger stopped the advance at ~0.60 progress); no rewind needed.
  setTimeout(() => {
    showLog('log3');
    if (window._mapState) {
      window._mapState.setShowVeto(true);
      // Keep drone exactly where it is — right at the danger zone edge
    }
    const chipVeto = document.getElementById('chipVeto');
    if (chipVeto) chipVeto.style.display = 'block';
    if (cmdValue) cmdValue.textContent = 'VETO';
    if (eegDot) { eegDot.style.background = '#FF3B3B'; eegDot.style.boxShadow = '0 0 6px #FF3B3B'; }
    setNarrative("ErrP detected. The brain's error response vetoes the path.");
  }, 4000);

  // Step 4 (5.5s): Replanning
  setTimeout(() => {
    showLog('log4');
    if (window._mapState) {
      window._mapState.setShowDanger(false);
      window._mapState.setShowVeto(false);
      window._mapState.setShowReplan(true);
    }
    const chipReplan = document.getElementById('chipReplan');
    if (chipReplan) chipReplan.style.display = 'block';
    const chipDanger = document.getElementById('chipDanger');
    if (chipDanger) chipDanger.style.display = 'none';
    const chipVeto = document.getElementById('chipVeto');
    if (chipVeto) chipVeto.style.display = 'none';
    if (sysSafety) { sysSafety.textContent = 'SAFE'; sysSafety.style.color = '#22C47B'; }
    if (cmdValue) cmdValue.textContent = 'ADVANCE';
    if (eegDot) { eegDot.style.background = '#22C47B'; eegDot.style.boxShadow = '0 0 6px #22C47B'; }
    setNarrative('Replanning complete. AI finds a safer route and the drone continues.');
  }, 5500);
}

function showLog(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transition = 'opacity 0.5s, transform 0.5s';
  el.style.opacity = '1';
  el.style.transform = 'translateX(0)';
}

function setNarrative(text) {
  const el = document.getElementById('narrativeText');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 200);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 5 — TECH CANVAS + REVEALS
// ══════════════════════════════════════════════════════════════════
function initTechCanvas() {
  const canvas = document.getElementById('techCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Diagonal grid
    ctx.strokeStyle = 'rgba(0,208,220,0.025)';
    ctx.lineWidth = 0.5;
    for (let i = -canvas.height; i < canvas.width + canvas.height; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + canvas.height, canvas.height);
      ctx.stroke();
    }

    // Corner glow
    const grd = ctx.createRadialGradient(canvas.width, 0, 0, canvas.width, 0, canvas.width * 0.6);
    grd.addColorStop(0, 'rgba(0,208,220,0.05)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  draw();
  window.addEventListener('resize', draw);
}

function initTechReveals() {
  const cards = document.querySelectorAll('#deck .slide--tech .tech-card');

  cards.forEach((card, i) => {
    setTimeout(() => card.classList.add('revealed'), 100 + i * 180);
  });
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 6 — ROADMAP CANVAS + REVEALS
// ══════════════════════════════════════════════════════════════════
function initRoadmapCanvas() {
  const canvas = document.getElementById('roadmapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grd.addColorStop(0, 'rgba(0,208,220,0.03)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dotted vertical line (left margin)
    ctx.strokeStyle = 'rgba(0,208,220,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(60, 40);
    ctx.lineTo(60, canvas.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  draw();
  window.addEventListener('resize', draw);
}

function initRoadmapReveals() {
  const slide  = document.querySelector('#deck .slide--roadmap');
  if (!slide) return;
  const cards  = slide.querySelectorAll('.rp-card');
  const arrows = slide.querySelectorAll('.rp-arrow');

  const seq = [
    { el: cards[0],  delay: 100 },
    { el: arrows[0], delay: 300 },
    { el: cards[1],  delay: 420 },
    { el: arrows[1], delay: 620 },
    { el: cards[2],  delay: 740 },
  ];
  seq.forEach(({ el, delay }) => {
    if (el) setTimeout(() => el.classList.add('revealed'), delay);
  });
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 3 — CURRENT DRONE SYSTEM ISSUES
// ══════════════════════════════════════════════════════════════════
function initIssuesCanvas() {
  const canvas = document.getElementById('issuesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  const dots = Array.from({ length: 28 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0001,
    vy: (Math.random() - 0.5) * 0.0001,
    r: Math.random() * 1 + 0.3,
    o: Math.random() * 0.2 + 0.04,
  }));

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = 'rgba(8,10,14,0.97)';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0,208,220,0.035)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 12; i++) {
      const x = (W * i) / 12;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      const y = (H * i) / 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    dots.forEach(d => {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0) d.x = 1; if (d.x > 1) d.x = 0;
      if (d.y < 0) d.y = 1; if (d.y > 1) d.y = 0;
      ctx.globalAlpha = d.o;
      ctx.fillStyle = '#00D0DC';
      ctx.beginPath();
      ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    requestAnimationFrame(draw);
  }
  draw();
}

function initIssuesReveals() {
  const slide = document.querySelector('#deck .slide--issues');
  if (!slide) return;
  slide.querySelectorAll('[data-issue-reveal]').forEach(el => {
    const i = parseInt(el.getAttribute('data-issue-reveal'), 10);
    setTimeout(() => el.classList.add('revealed'), 50 + i * 95);
  });
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 8 — FEASIBILITY & SCALABILITY
// ══════════════════════════════════════════════════════════════════
function initBeyondCanvas() {
  const canvas = document.getElementById('beyondCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let raf;

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  // Floating grid nodes
  const nodes = Array.from({ length: 55 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00018,
    vy: (Math.random() - 0.5) * 0.00018,
    r: Math.random() * 1.5 + 0.5,
    opacity: Math.random() * 0.4 + 0.1,
  }));

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Deep background gradient
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, 'rgba(18,24,38,0.96)');
    bg.addColorStop(1, 'rgba(8,10,18,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Perspective grid — horizontal lines converging to center-top vanishing point
    const vx = W * 0.5, vy = H * 0.18;
    ctx.strokeStyle = 'rgba(0,208,220,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const bx = (W * i) / 10;
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(bx, H);
      ctx.stroke();
    }
    // Horizontal cross-lines (perspective rows)
    for (let i = 0; i <= 8; i++) {
      const t   = i / 8;
      const yy  = vy + (H - vy) * Math.pow(t, 1.8);
      const xSpan = (W * 0.5) * t;
      ctx.globalAlpha = t * 0.12;
      ctx.beginPath();
      ctx.moveTo(vx - xSpan, yy);
      ctx.lineTo(vx + xSpan, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Warm radial glow upper-right
    const glow = ctx.createRadialGradient(W * 0.82, H * 0.12, 0, W * 0.82, H * 0.12, W * 0.45);
    glow.addColorStop(0, 'rgba(255,107,26,0.07)');
    glow.addColorStop(1, 'rgba(255,107,26,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Cyan glow lower-left
    const glow2 = ctx.createRadialGradient(W * 0.12, H * 0.88, 0, W * 0.12, H * 0.88, W * 0.4);
    glow2.addColorStop(0, 'rgba(0,208,220,0.06)');
    glow2.addColorStop(1, 'rgba(0,208,220,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // Update + draw nodes
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0) n.x = 1; if (n.x > 1) n.x = 0;
      if (n.y < 0) n.y = 1; if (n.y > 1) n.y = 0;

      ctx.globalAlpha = n.opacity;
      ctx.fillStyle = '#00D0DC';
      ctx.beginPath();
      ctx.arc(n.x * W, n.y * H, n.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Thin connecting lines between close nodes
    ctx.strokeStyle = 'rgba(0,208,220,0.09)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = (nodes[i].x - nodes[j].x) * W;
        const dy = (nodes[i].y - nodes[j].y) * H;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 90) {
          ctx.globalAlpha = (1 - d / 90) * 0.12;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x * W, nodes[i].y * H);
          ctx.lineTo(nodes[j].x * W, nodes[j].y * H);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(draw);
  }
  draw();
}

function initBeyondReveals() {
  const slide = document.querySelector('[data-slide="8"].slide--beyond');
  if (!slide) return;

  const header  = slide.querySelector('[data-reveal="0"]');
  const unified = slide.querySelector('[data-reveal="1"]');

  const seq = [
    { el: header,  delay: 80  },
    { el: unified, delay: 400 },
  ];

  seq.forEach(({ el, delay }) => {
    if (el) setTimeout(() => el.classList.add('revealed'), delay);
  });
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 10 — PERSONAL WORKFLOW
// ══════════════════════════════════════════════════════════════════
function initWorkflowCanvas() {
  const canvas = document.getElementById('workflowCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  let raf;
  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(W * 0.45, H * 0.35, 0, W * 0.5, H * 0.55, W * 0.75);
    bg.addColorStop(0, 'rgba(16, 22, 36, 0.98)');
    bg.addColorStop(1, 'rgba(5, 8, 16, 1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const g1 = ctx.createRadialGradient(W * 0.2, H * 0.85, 0, W * 0.2, H * 0.85, W * 0.45);
    g1.addColorStop(0, 'rgba(0, 208, 220, 0.055)');
    g1.addColorStop(1, 'transparent');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(W * 0.88, H * 0.12, 0, W * 0.88, H * 0.12, W * 0.42);
    g2.addColorStop(0, 'rgba(255, 107, 26, 0.04)');
    g2.addColorStop(1, 'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0, 208, 220, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const x = (W * i) / 11;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(W * 0.5, H * 0.55);
      ctx.stroke();
    }

    raf = requestAnimationFrame(draw);
  }
  draw();
}

function initWorkflowReveals() {
  const slide = document.querySelector('#deck [data-slide="9"].slide--workflow');
  if (!slide) return;
  const items = slide.querySelectorAll('[data-wf-reveal]');
  items.forEach((el, i) => {
    setTimeout(() => el.classList.add('revealed'), 90 + i * 110);
  });
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 11 — CLOSING CANVAS
// ══════════════════════════════════════════════════════════════════
function initClosingCanvas() {
  const canvas = document.getElementById('closingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let t = 0;

  function draw() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t++;

    // Atmospheric radial from center-bottom
    const grd = ctx.createRadialGradient(
      canvas.width/2, canvas.height * 0.85, 0,
      canvas.width/2, canvas.height * 0.85, canvas.width * 0.9
    );
    grd.addColorStop(0, 'rgba(0,208,220,0.06)');
    grd.addColorStop(0.4, 'rgba(0,80,100,0.03)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle particle dust
    ctx.fillStyle = 'rgba(0,208,220,0.4)';
    for (let i = 0; i < 6; i++) {
      const x = (Math.sin(t * 0.005 + i * 1.5) * 0.3 + 0.5) * canvas.width;
      const y = (Math.cos(t * 0.007 + i * 2.1) * 0.2 + 0.5) * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function loop() { draw(); requestAnimationFrame(loop); }
  loop();
}

// ══════════════════════════════════════════════════════════════════
// BACKGROUND MICRO-ANIMATIONS (shared across all slides)
// ══════════════════════════════════════════════════════════════════
function startBackgroundAnimations() {
  // Subtle parallax on mouse move for HUD corners
  document.addEventListener('mousemove', e => {
    const mx = (e.clientX / window.innerWidth  - 0.5) * 4;
    const my = (e.clientY / window.innerHeight - 0.5) * 4;
    document.querySelectorAll('.hud-corner').forEach(c => {
      c.style.transform = `translate(${mx}px, ${my}px)`;
    });
  });
}

// ── KICK OFF ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
