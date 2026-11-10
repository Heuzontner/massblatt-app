// Tür-/Fenster-Erkennung am Gerät: kleines YOLOv8n-Modell (Open Images, 14 MB, liegt im Repo → kein Fremd-Download),
// direkt über onnxruntime-web (WASM). Ersetzt seit 3.5 das 150-MB-OWL-ViT, das am Tablet „ewig“ brauchte.
// Ergebnis nur Türen und Fenster des Raums – Fenster, die man DURCH ein Fenster sieht (Nachbarhaus), werden verworfen.
const SIZE = 480, DOOR = 164, WINDOW = 587, NC = 601;
const MODEL_URL = new URL('./model/dw480.onnx', import.meta.url).href;
const CACHE = 'mbmodel-1';
let sessP = null, ortMod = null;
export let lastMs = 0;

export function modelState() {
  try { return localStorage.getItem('mb_model_ready') === '2' ? 'bereit' : 'nicht geladen'; } catch (e) { return 'nicht geladen'; }
}

async function modelBytes(onProgress) {
  let c = null;
  try { c = await caches.open(CACHE); const hit = await c.match(MODEL_URL); if (hit) return await hit.arrayBuffer(); } catch (e) { }
  const r = await fetch(MODEL_URL); if (!r.ok) throw new Error('Modell nicht ladbar (' + r.status + ')');
  const total = +r.headers.get('content-length') || 14149299, rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress && onProgress(Math.min(1, got / total), got, total); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  try { if (c) await c.put(MODEL_URL, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { }
  return buf.buffer;
}

export function loadModel(onProgress) {
  if (sessP) return sessP;
  sessP = (async () => {
    ortMod = await import('./vendor/ort.wasm.min.mjs');
    ortMod.env.wasm.wasmPaths = { mjs: new URL('./vendor/ort-wasm-simd-threaded.mjs', import.meta.url).href, wasm: new URL('./vendor/ort-wasm-simd-threaded.wasm', import.meta.url).href };
    ortMod.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ortMod.env.wasm.proxy = false;
    const s = await ortMod.InferenceSession.create(await modelBytes(onProgress), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    // einmal leer rechnen: der erste Lauf ist sonst deutlich langsamer
    await s.run({ [s.inputNames[0]]: new ortMod.Tensor('float32', new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]) });
    try { localStorage.setItem('mb_model_ready', '2'); } catch (e) { }
    return s;
  })();
  sessP.catch(() => { sessP = null; });
  return sessP;
}

const clamp = v => Math.min(1, Math.max(0, v));
const area = b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function inter(a, b) { return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); }
function iou(a, b) { const i = inter(a, b), u = area(a) + area(b) - i; return u > 0 ? i / u : 0; }

// Auswahl getrennt, damit sie ohne Modell prüfbar ist. cand: [{type, score, box}] (normiert auf das Foto)
export function pick(cand) {
  let objs = cand.filter(o => (o.box.x1 - o.box.x0) > 0.06 && (o.box.y1 - o.box.y0) > 0.08);
  objs.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const o of objs) if (!keep.some(k => iou(k.box, o.box) > 0.45)) keep.push(o); // gleiche Stelle nur einmal (auch Tür/Fenster-Doppel)
  const doors = keep.filter(o => o.type === 'door' && o.score > 0.2 && (o.box.y1 - o.box.y0) > 0.35).slice(0, 1);
  let wins = keep.filter(o => o.type === 'window' && o.score > 0.2 && !(doors[0] && iou(doors[0].box, o.box) > 0.5));
  // „Fenster draußen“: liegt ein Fenster (fast) ganz in einem größeren Fenster, ist es das Nachbarhaus oder eine Sprosse → weg.
  // Ebenso sehr kleine Fenster neben einem deutlich größeren (weniger als ein Achtel der Fläche).
  const big = wins.reduce((m, o) => Math.max(m, area(o.box)), 0);
  wins = wins.filter(o => !wins.some(k => k !== o && area(k.box) > area(o.box) * 1.3 && inter(k.box, o.box) > area(o.box) * 0.7) && area(o.box) >= big / 8);
  return [...wins.slice(0, 3), ...doors];
}

// canvas: Foto (darf verkleinert sein). Ergebnis: [{type:'door'|'window', score, box:{x0,y0,x1,y1} normiert}]
export async function detect(canvas, onProgress) {
  const s = await loadModel(onProgress);
  const t0 = performance.now();
  const k = SIZE / Math.max(canvas.width, canvas.height), w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
  const ox = (SIZE - w) >> 1, oy = (SIZE - h) >> 1;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, SIZE, SIZE); g.drawImage(canvas, ox, oy, w, h);
  const px = g.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, x = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { x[i] = px[j] / 255; x[n + i] = px[j + 1] / 255; x[2 * n + i] = px[j + 2] / 255; }
  const out = (await s.run({ [s.inputNames[0]]: new ortMod.Tensor('float32', x, [1, 3, SIZE, SIZE]) }))[s.outputNames[0]];
  const d = out.data, N = out.dims[2]; // [1, 4 + NC, N]
  const cand = [];
  for (const [cls, type] of [[DOOR, 'door'], [WINDOW, 'window']]) {
    const row = (4 + cls) * N;
    for (let i = 0; i < N; i++) {
      const sc = d[row + i]; if (sc < 0.15) continue;
      const cx = d[i], cy = d[N + i], bw = d[2 * N + i], bh = d[3 * N + i];
      cand.push({ type, score: sc, box: { x0: clamp((cx - bw / 2 - ox) / w), y0: clamp((cy - bh / 2 - oy) / h), x1: clamp((cx + bw / 2 - ox) / w), y1: clamp((cy + bh / 2 - oy) / h) } });
    }
  }
  const res = pick(cand);
  lastMs = Math.round(performance.now() - t0);
  return res;
}
