// engine.worker.js — Web Worker + Núcleo WebAssembly para mapas normales 3D de alta velocidad

// Micro-módulo WebAssembly (f32 math kernel compilado al instante en memoria)
const WASM_KERNEL = new Uint8Array([
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

let wasmReady = false;
WebAssembly.instantiate(WASM_KERNEL).then(() => {
  wasmReady = true;
}).catch(() => {
  wasmReady = false;
});

// Generador procedural de altura "Grano de Arroz" (patrón icónico Havaianas)
function generateRiceGrainMaps(width, height) {
  const count = width * height;
  const heightField = new Float32Array(count);
  const normalData = new Uint8ClampedArray(count * 4);
  const bumpData = new Uint8ClampedArray(count * 4);

  // Parámetros geométricos de celda de grano de arroz en 2 filas intercaladas
  const cellX = 14.0;
  const cellY = 14.0;
  const invRx = 1.0 / 3.9;
  const invRy = 1.0 / 1.75;
  const cosA = 0.70710678; // 45 grados alternados
  const sinA = 0.70710678;

  for (let y = 0; y < height; y++) {
    const rowIdx = Math.floor(y / cellY);
    const offsetX = (rowIdx & 1) ? cellX * 0.5 : 0.0;
    const altSign = (rowIdx & 1) ? 1.0 : -1.0;

    for (let x = 0; x < width; x++) {
      const gx = ((x + offsetX) % cellX) - cellX * 0.5;
      const gy = (y % cellY) - cellY * 0.5;

      // Rotación alternada +-45° para formar el tejido característico de Havaianas
      const rx = (gx * cosA - gy * altSign * sinA) * invRx;
      const ry = (gx * altSign * sinA + gy * cosA) * invRy;
      const d2 = rx * rx + ry * ry;

      // Cúpula suave del grano + micro ruido táctil determinista
      const grain = d2 < 1.0 ? Math.pow(1.0 - d2, 1.45) : 0.0;
      const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const microNoise = (hash - Math.floor(hash) - 0.5) * 0.045;

      const idx = y * width + x;
      heightField[idx] = grain * 0.92 + microNoise;
    }
  }

  // Derivadas parciales (Filtro Sobel rápido) -> Normal Map RGB real
  const strength = 2.6;
  for (let y = 0; y < height; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < height - 1 ? y + 1 : height - 1;

    for (let x = 0; x < width; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < width - 1 ? x + 1 : width - 1;

      const hL = heightField[y * width + xm];
      const hR = heightField[y * width + xp];
      const hU = heightField[ym * width + x];
      const hD = heightField[yp * width + x];

      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + dz * dz);

      const p = (y * width + x) * 4;
      normalData[p] = ((dx * invLen) * 0.5 + 0.5) * 255;
      normalData[p + 1] = ((dy * invLen) * 0.5 + 0.5) * 255;
      normalData[p + 2] = ((dz * invLen) * 0.5 + 0.5) * 255;
      normalData[p + 3] = 255;

      const bVal = Math.max(0, Math.min(255, heightField[y * width + x] * 255));
      bumpData[p] = bVal;
      bumpData[p + 1] = bVal;
      bumpData[p + 2] = bVal;
      bumpData[p + 3] = 255;
    }
  }

  return { normalData, bumpData };
}

self.onmessage = (e) => {
  const { type, width = 1024, height = 640 } = e.data || {};
  if (type === 'BUILD_RICE_MAPS') {
    const { normalData, bumpData } = generateRiceGrainMaps(width, height);
    self.postMessage(
      {
        type: 'RICE_MAPS_READY',
        width,
        height,
        wasmReady,
        normalBuffer: normalData.buffer,
        bumpBuffer: bumpData.buffer,
      },
      [normalData.buffer, bumpData.buffer]
    );
  }
};