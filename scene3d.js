// scene3d.js — Motor WebGL PBR Optimizado, Luz Calibrada, Física WASM y Sombras Reales
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARD_DATA, PALETTES, makeThemedColor, createCardMaps } from './card-textures.js';

const isMobilePerf =
  window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;

/* ==========================================================================
   1. NÚCLEO WEBASSEMBLY PARA FÍSICA DE RESORTE AMORTIGUADO (NASA / TOYOTA)
   ========================================================================== */
const WASM_SPRING_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x09, 0x01, 0x60, 0x05, 0x7f, 0x7d, 0x7d, 0x7d, 0x7d, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0e, 0x02, 0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00, 0x04, 0x73, 0x74, 0x65, 0x70, 0x00, 0x00,
  0x0a, 0x40, 0x01, 0x3e, 0x01, 0x02, 0x7d,
  0x20, 0x00, 0x2a, 0x02, 0x00, 0x21, 0x05,
  0x20, 0x00, 0x2a, 0x02, 0x04, 0x21, 0x06,
  0x20, 0x01, 0x20, 0x05, 0x93, 0x20, 0x02, 0x94, 0x20, 0x06, 0x20, 0x03, 0x94, 0x93,
  0x20, 0x04, 0x94, 0x20, 0x06, 0x92, 0x22, 0x06,
  0x20, 0x04, 0x94, 0x20, 0x05, 0x92, 0x21, 0x05,
  0x20, 0x00, 0x20, 0x05, 0x38, 0x02, 0x00,
  0x20, 0x00, 0x20, 0x06, 0x38, 0x02, 0x04,
  0x0b
]);

class SpringBank {
  constructor(count) {
    this.count = count;
    this.targets = new Float32Array(count);
    this.stiffness = new Float32Array(count);
    this.damping = new Float32Array(count);
    this.fallback = new Float32Array(count * 2);
    this.wasm = null;
    this.f32 = null;

    WebAssembly.instantiate(WASM_SPRING_BYTES).then(({ instance }) => {
      this.wasm = instance.exports;
      this.f32 = new Float32Array(this.wasm.mem.buffer);
      this.f32.set(this.fallback.subarray(0, count * 2), 0);
    }).catch(() => {});
  }

  setImmediate(idx, val) {
    this.targets[idx] = val;
    this.fallback[idx * 2] = val;
    this.fallback[idx * 2 + 1] = 0;
    if (this.f32) {
      this.f32[idx * 2] = val;
      this.f32[idx * 2 + 1] = 0;
    }
  }

  configure(idx, target, k = 175, c = 24) {
    this.targets[idx] = target;
    this.stiffness[idx] = k;
    this.damping[idx] = c;
  }

  stepAll(dt) {
    const substeps = dt > 0.018 ? 2 : 1;
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      if (this.wasm && this.f32) {
        for (let i = 0; i < this.count; i++) {
          this.wasm.step(i * 8, this.targets[i], this.stiffness[i], this.damping[i], h);
        }
      } else {
        for (let i = 0; i < this.count; i++) {
          const pIdx = i * 2;
          const pos = this.fallback[pIdx];
          const vel = this.fallback[pIdx + 1];
          const acc = (this.targets[i] - pos) * this.stiffness[i] - vel * this.damping[i];
          const nVel = vel + acc * h;
          this.fallback[pIdx + 1] = nVel;
          this.fallback[pIdx] = pos + nVel * h;
        }
      }
    }
  }

  get(idx) {
    return this.f32 ? this.f32[idx * 2] : this.fallback[idx * 2];
  }
}

/* ==========================================================================
   2. MICRO AUDIO SINTÉTICO TÁCTIL (0 KB)
   ========================================================================== */
let audioCtx = null;
function playTactileTone(freq = 520, duration = 0.055, vol = 0.032) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.65, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {}
}

/* ==========================================================================
   3. CICLO CALMO DE LOS 3 FONDOS
   ========================================================================== */
const bgSlides = Array.from(document.querySelectorAll('#bg-stage .bg-slide'));
let activeBgIndex = 0;
if (bgSlides.length > 1) {
  setInterval(() => {
    bgSlides[activeBgIndex].classList.remove('is-active');
    activeBgIndex = (activeBgIndex + 1) % bgSlides.length;
    bgSlides[activeBgIndex].classList.add('is-active');
  }, 9500);
}

/* ==========================================================================
   4. MOTOR THREE.JS + LUZ CALIBRADA PANTONE + RENDIMIENTO MÓVIL
   ========================================================================== */
const canvas = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobilePerf ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88; // Calibrado para colores Pantone intensos sin sobreexponer
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
scene.environmentIntensity = 0.44; // Sutil para que no lave el rojo ni el dorso blanco

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 100);

// Luz lateral de estudio (proyecta sombra diagonal limpia y evita reflejo blanco plano frontal)
const shadowRes = isMobilePerf ? 1024 : 2048;
const keyLight = new THREE.DirectionalLight(0xfffaf3, 1.15);
keyLight.position.set(3.8, 4.2, 5.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(shadowRes, shadowRes);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 22;
keyLight.shadow.camera.left = -6.5;
keyLight.shadow.camera.right = 6.5;
keyLight.shadow.camera.top = 6.5;
keyLight.shadow.camera.bottom = -6.5;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.018;
keyLight.shadow.radius = isMobilePerf ? 2.5 : 4.2;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xe5f5ff, 0.48);
fillLight.position.set(-4.5, -2.5, 4.5);
scene.add(fillLight);

// Plano receptor de sombra real
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.ShadowMaterial({ opacity: 0.34 })
);
shadowCatcher.position.set(0, 0, -1.45);
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// Geometría única de esquinas redondeadas exactas (optimizada para 60 FPS móvil)
const CARD_W = 3.40;
const CARD_H = 2.14;
const CARD_R = 0.17;
const EXTRUDE_DEPTH = 0.036;
const BEVEL = 0.012;

function createCardShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const cardShape = createCardShape(CARD_W, CARD_H, CARD_R);

const bodyGeo = new THREE.ExtrudeGeometry(cardShape, {
  depth: EXTRUDE_DEPTH,
  bevelEnabled: true,
  bevelThickness: BEVEL,
  bevelSize: BEVEL,
  bevelSegments: isMobilePerf ? 4 : 6,
  curveSegments: isMobilePerf ? 14 : 20,
});
bodyGeo.translate(0, 0, -EXTRUDE_DEPTH / 2);

const faceGeo = new THREE.ShapeGeometry(cardShape, isMobilePerf ? 14 : 20);
const posAttr = faceGeo.attributes.position;
const uvAttr = faceGeo.attributes.uv;
for (let i = 0; i < posAttr.count; i++) {
  uvAttr.setXY(i, (posAttr.getX(i) + CARD_W / 2) / CARD_W, (posAttr.getY(i) + CARD_H / 2) / CARD_H);
}

let currentPalette = PALETTES[0];
let activeMaps = createCardMaps(currentPalette, isMobilePerf);
let riceNormalTex = null;

const rimMaterial = new THREE.MeshPhysicalMaterial({
  color: currentPalette.rimEdge,
  metalness: 0.72,
  roughness: 0.25,
  clearcoat: 0.45,
  clearcoatRoughness: 0.18,
});

const frontMaterial = new THREE.MeshPhysicalMaterial({
  map: activeMaps.frontTex,
  roughnessMap: activeMaps.roughTex,
  metalness: 0.10,
  roughness: 0.60,
  clearcoat: 0.52,
  clearcoatRoughness: 0.16,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});

const backMaterial = new THREE.MeshPhysicalMaterial({
  map: activeMaps.backTex,
  metalness: 0.04,
  roughness: 0.54,
  clearcoat: 0.22,
  clearcoatRoughness: 0.28,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});

function createCardMesh(role) {
  const group = new THREE.Group();
  group.userData.role = role;

  const body = new THREE.Mesh(bodyGeo, rimMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.role = role;
  group.add(body);

  const zFace = EXTRUDE_DEPTH / 2 + BEVEL + 0.0008;

  const front = new THREE.Mesh(faceGeo, frontMaterial);
  front.position.z = zFace;
  front.receiveShadow = true;
  front.userData.role = role;
  group.add(front);

  const back = new THREE.Mesh(faceGeo, backMaterial);
  back.position.z = -zFace;
  back.rotation.y = Math.PI;
  back.receiveShadow = true;
  back.userData.role = role;
  group.add(back);

  return group;
}

const stage = new THREE.Group();
scene.add(stage);

const cardTop = createCardMesh('top');
const cardBottom = createCardMesh('bottom');
stage.add(cardTop, cardBottom);

/* ==========================================================================
   5. WEB WORKER: RELIEVE 3D "GRANO DE ARROZ" EN PARALELO
   ========================================================================== */
const worker = new Worker('./engine.worker.js', { type: 'module' });
worker.postMessage({
  type: 'BUILD_RICE_MAPS',
  width: isMobilePerf ? 512 : 1024,
  height: isMobilePerf ? 320 : 640,
});
worker.onmessage = (e) => {
  if (e.data?.type === 'RICE_MAPS_READY') {
    const { width, height, normalBuffer } = e.data;
    riceNormalTex = new THREE.DataTexture(new Uint8Array(normalBuffer), width, height, THREE.RGBAFormat);
    riceNormalTex.colorSpace = THREE.NoColorSpace;
    riceNormalTex.anisotropy = isMobilePerf ? 2 : 4;
    riceNormalTex.needsUpdate = true;

    frontMaterial.normalMap = riceNormalTex;
    frontMaterial.normalScale.set(0.32, 0.32);
    frontMaterial.needsUpdate = true;

    // Dorso ultra sutil para lectura nítida del QR y textos pequeños
    backMaterial.normalMap = riceNormalTex;
    backMaterial.normalScale.set(0.05, 0.05);
    backMaterial.needsUpdate = true;
  }
};

/* ==========================================================================
   6. BANCO DE RESORTES WASM (POSICIÓN 1, POSICIÓN 2 MÓVIL/PC E INSPECCIÓN)
   ========================================================================== */
const springs = new SpringBank(20);
springs.setImmediate(12, 12);
springs.setImmediate(13, 0.65);

let currentMode = 'front';
let inspectTarget = null;
let isOpened = false;

const inspectBar = document.getElementById('inspect-bar');
const inspectLabel = document.getElementById('inspect-label');
const btnInspectClose = document.getElementById('btn-inspect-close');
const microHint = document.getElementById('micro-hint');

function updateTargets() {
  const aspect = window.innerWidth / window.innerHeight;
  const isNarrow = aspect < 0.95;

  let tPos = [0, 1.32, 0], tRot = [0, 0, 0];
  let bPos = [0, -1.16, 0], bRot = [0, Math.PI, 0];
  let boxW = 4.1, boxH = 5.65;

  if (inspectTarget === 'top') {
    tPos = [0, -0.02, 0.78];
    tRot = [0, 0, 0];
    bPos = [0, -5.6, -2.5];
    bRot = [0.25, Math.PI, 0];
    boxW = 3.92;
    boxH = 2.95;
    inspectLabel.textContent = 'Vista de Lectura — Frente';
    inspectBar.classList.add('is-visible');
    microHint.classList.add('is-hidden');
  } else if (inspectTarget === 'bottom') {
    tPos = [0, 5.6, -2.5];
    tRot = [-0.25, 0, 0];
    bPos = [0, -0.02, 0.78];
    bRot = [0, Math.PI, 0];
    boxW = 3.92;
    boxH = 2.95;
    inspectLabel.textContent = 'Vista de Lectura — Dorso y QR';
    inspectBar.classList.add('is-visible');
    microHint.classList.add('is-hidden');
  } else {
    inspectBar.classList.remove('is-visible');
    microHint.classList.remove('is-hidden');

    if (currentMode === 'front') {
      tPos = [0, 1.32, 0];
      tRot = [0, 0, 0];
      bPos = [0, -1.16, 0];
      bRot = [0, Math.PI, 0];
      boxW = 4.1;
      boxH = 5.65;
    } else {
      if (isNarrow) {
        // En teléfonos: separadas con aire limpio para que NO se pisen entre sí
        tPos = [-0.16, 1.28, 0.36];
        tRot = [-0.14, 0.36, 0.21];
        bPos = [0.18, -1.24, -0.32];
        bRot = [0.13, Math.PI - 0.34, -0.16];
        boxW = 4.35;
        boxH = 5.80;
      } else {
        tPos = [-1.02, 0.24, 0.38];
        tRot = [-0.17, 0.43, 0.26];
        bPos = [1.04, -0.24, -0.34];
        bRot = [0.15, Math.PI - 0.38, -0.17];
        boxW = 6.45;
        boxH = 3.95;
      }
    }
  }

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distV = (boxH / 2) / Math.tan(vFov / 2);
  const distH = (boxW / 2) / (Math.tan(vFov / 2) * aspect);
  const targetZ = Math.max(distV, distH) + (inspectTarget ? 0.65 : 0.95);

  const K = 165, C = 22.5;
  tPos.forEach((v, i) => springs.configure(i, v, K, C));
  tRot.forEach((v, i) => springs.configure(3 + i, v, K, C));
  bPos.forEach((v, i) => springs.configure(6 + i, v, K, C));
  bRot.forEach((v, i) => springs.configure(9 + i, v, K, C));
  springs.configure(12, targetZ, 145, 22);
}

springs.setImmediate(1, -1.2);
springs.setImmediate(2, -1.8);
springs.setImmediate(7, -2.6);
springs.setImmediate(8, -2.2);
updateTargets();

/* ==========================================================================
   7. SELECTOR DE LAS 5 ARMONÍAS PANTONE BRASILEÑAS
   ========================================================================== */
const paletteBar = document.getElementById('palette-bar');
const hudDot = document.getElementById('hud-dot');

function applyPalette(palette) {
  currentPalette = palette;
  const root = document.documentElement.style;
  root.setProperty('--accent', palette.base);
  root.setProperty('--accent-light', makeThemedColor(palette.base, 12));
  root.setProperty('--accent-dark', makeThemedColor(palette.base, -20));
  hudDot.style.background = palette.base;

  const oldMaps = activeMaps;
  activeMaps = createCardMaps(palette, isMobilePerf);

  frontMaterial.map = activeMaps.frontTex;
  frontMaterial.roughnessMap = activeMaps.roughTex;
  frontMaterial.needsUpdate = true;

  backMaterial.map = activeMaps.backTex;
  backMaterial.needsUpdate = true;

  rimMaterial.color.set(palette.rimEdge);

  if (oldMaps) {
    oldMaps.frontTex.dispose();
    oldMaps.backTex.dispose();
    oldMaps.roughTex.dispose();
  }

  springs.setImmediate(13, 0.94);
  springs.configure(13, 1.0, 260, 20);
  playTactileTone(640, 0.045, 0.025);
}

PALETTES.forEach((p, idx) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `swatch-btn${idx === 0 ? ' is-active' : ''}`;
  btn.style.background = p.swatch;
  btn.title = p.name;
  btn.setAttribute('aria-label', p.name);
  btn.addEventListener('click', () => {
    paletteBar.querySelectorAll('.swatch-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    applyPalette(p);
  });
  paletteBar.appendChild(btn);
});

/* ==========================================================================
   8. MOUSE, GIROSCOPIO, ARRASTRE ELÁSTICO Y RAYCASTER
   ========================================================================== */
let inputX = 0, inputY = 0;
let isDragging = false;
let downX = 0, downY = 0, movedDist = 0;
let dragOffsetRx = 0, dragOffsetRy = 0;
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

canvas.addEventListener('pointerdown', (e) => {
  if (!isOpened) return;
  isDragging = true;
  downX = e.clientX;
  downY = e.clientY;
  movedDist = 0;
});

window.addEventListener('pointermove', (e) => {
  inputX = (e.clientX / window.innerWidth - 0.5) * 2;
  inputY = (e.clientY / window.innerHeight - 0.5) * 2;

  if (isDragging && isOpened) {
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    movedDist = Math.hypot(dx, dy);
    dragOffsetRy = THREE.MathUtils.clamp(dx / window.innerWidth * 1.4, -0.65, 0.65);
    dragOffsetRx = THREE.MathUtils.clamp(dy / window.innerHeight * 1.1, -0.45, 0.45);
    springs.configure(14, dragOffsetRx, 280, 26);
    springs.configure(15, dragOffsetRy, 280, 26);
  }
});

window.addEventListener('pointerup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  springs.configure(14, 0, 140, 16);
  springs.configure(15, 0, 140, 16);

  if (movedDist < 9 && isOpened) {
    pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    const hits = raycaster.intersectObjects([cardTop, cardBottom], true);
    if (hits.length > 0) {
      const hitRole = hits[0].object.userData.role;
      inspectTarget = inspectTarget === hitRole ? null : hitRole;
      playTactileTone(inspectTarget ? 720 : 480, 0.055, 0.03);
      updateTargets();
    } else if (inspectTarget) {
      inspectTarget = null;
      playTactileTone(480, 0.05, 0.025);
      updateTargets();
    }
  }
});

function enableGyroscope() {
  const onOrient = (e) => {
    if (e.gamma === null || e.beta === null) return;
    inputX = THREE.MathUtils.clamp(e.gamma / 30, -1, 1);
    inputY = THREE.MathUtils.clamp((e.beta - 42) / 30, -1, 1);
  };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((res) => { if (res === 'granted') window.addEventListener('deviceorientation', onOrient); })
      .catch(() => {});
  } else {
    window.addEventListener('deviceorientation', onOrient);
  }
}

/* ==========================================================================
   9. UNBOXING DEL SOBRE Y BOTONES DE NAVEGACIÓN
   ========================================================================== */
const overlay = document.getElementById('envelope-overlay');
document.getElementById('envelope-recipient').textContent = `Para ${CARD_DATA.recipient}`;
document.getElementById('envelope-sender').textContent = `De ${CARD_DATA.sender} · ${CARD_DATA.amount}`;
document.getElementById('hud-amount').textContent = CARD_DATA.amount.replace(' ARS', '');

function openGiftCard() {
  if (isOpened) return;
  isOpened = true;
  enableGyroscope();
  playTactileTone(540, 0.08, 0.04);

  const tl = gsap.timeline();
  tl.to('#envelope-pull', { y: -18, opacity: 0, duration: 0.25, ease: 'power2.out' })
    .to('#envelope-flap', { rotateX: 170, duration: 0.36, ease: 'power2.inOut' }, '-=0.18')
    .to('#envelope-overlay', {
      opacity: 0,
      scale: 1.05,
      duration: 0.42,
      ease: 'power2.out',
      onComplete: () => overlay.remove(),
    }, '-=0.12')
    .call(() => {
      springs.configure(13, 1.0, 170, 19);
      updateTargets();
    }, null, '-=0.35')
    .to('#hud-top', { opacity: 1, duration: 0.45, ease: 'power2.out' }, '-=0.15')
    .to('#hud-bottom-wrap', { opacity: 1, duration: 0.45, ease: 'power2.out' }, '-=0.35');
}

overlay.addEventListener('click', openGiftCard);
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') openGiftCard();
});

btnInspectClose.addEventListener('click', () => {
  inspectTarget = null;
  playTactileTone(480, 0.05, 0.025);
  updateTargets();
});

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    inspectTarget = null;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    currentMode = btn.dataset.mode;
    playTactileTone(580, 0.05, 0.025);
    updateTargets();
  });
});

const btnCopy = document.getElementById('btn-copy');
btnCopy.addEventListener('click', async () => {
  playTactileTone(760, 0.06, 0.03);
  try {
    await navigator.clipboard.writeText(CARD_DATA.code);
    btnCopy.textContent = '¡Código Copiado!';
    setTimeout(() => { btnCopy.textContent = 'Copiar Código'; }, 1800);
  } catch {
    btnCopy.textContent = CARD_DATA.code;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateTargets();
});

/* ==========================================================================
   10. LOOP 60/120 FPS CON LUZ LATERAL Y SOMBRA DINÁMICA
   ========================================================================== */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  const elapsed = clock.elapsedTime;

  const tiltFactor = inspectTarget ? 0.09 : 0.21;
  springs.configure(16, inputX * tiltFactor, 120, 20);
  springs.configure(17, inputY * (tiltFactor * 0.65), 120, 20);
  springs.configure(18, inputX, 95, 18);
  springs.configure(19, inputY, 95, 18);

  springs.stepAll(dt);

  cardTop.position.set(springs.get(0), springs.get(1), springs.get(2));
  cardTop.rotation.set(springs.get(3), springs.get(4), springs.get(5));

  cardBottom.position.set(springs.get(6), springs.get(7), springs.get(8));
  cardBottom.rotation.set(springs.get(9), springs.get(10), springs.get(11));

  camera.position.z = springs.get(12);
  const sc = springs.get(13);
  stage.scale.set(sc, sc, sc);

  stage.rotation.y = springs.get(16) + springs.get(15);
  stage.rotation.x = springs.get(17) + springs.get(14);
  stage.position.y = Math.sin(elapsed * 1.35) * (inspectTarget ? 0.015 : 0.04);

  keyLight.position.set(
    3.8 + springs.get(18) * 2.2,
    4.2 - springs.get(19) * 1.8,
    5.8
  );

  renderer.render(scene, camera);
}

animate();
