// Tür-/Fenster-Erkennung offline am Handy (OWL-ViT über transformers.js).
// Das Modell (~150 MB) wird beim ersten Mal von Hugging Face geladen und danach im Browser-Cache gehalten.
const MODEL = 'Xenova/owlvit-base-patch32';
const LABELS = ['a door', 'an open door frame', 'a doorway', 'a window', 'a glass window pane'];
const DOOR = new Set([0, 1, 2]);

let detectorP = null;

export function modelState() {
  try { return localStorage.getItem('mb_model_ready') === '1' ? 'bereit' : 'nicht geladen'; } catch (e) { return 'nicht geladen'; }
}

export function loadModel(onProgress) {
  if (detectorP) return detectorP;
  detectorP = (async () => {
    // Bibliothek vom CDN (feste Version); der Service Worker hält sie danach offline bereit
    const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js');
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = true;
    T.env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', location.href).href;
    T.env.backends.onnx.wasm.numThreads = 1;
    const files = {};
    const det = await T.pipeline('zero-shot-object-detection', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: p => {
        if (p.status === 'progress' && p.file) {
          files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
          const l = Object.values(files).reduce((s, f) => s + f.loaded, 0);
          const t = Object.values(files).reduce((s, f) => s + f.total, 0);
          onProgress && onProgress(t ? l / t : 0, l, t);
        }
      },
    });
    try { localStorage.setItem('mb_model_ready', '1'); } catch (e) { }
    return det;
  })();
  detectorP.catch(() => { detectorP = null; });
  return detectorP;
}

function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}

// canvas: Foto (verkleinert). Ergebnis: [{type:'door'|'window', score, box:{x0,y0,x1,y1} normiert}]
export async function detect(canvas, onProgress) {
  const det = await loadModel(onProgress);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  const raw = await det(url, LABELS, { threshold: 0.06, percentage: true });
  let objs = raw.map(r => ({
    type: DOOR.has(LABELS.indexOf(r.label)) ? 'door' : 'window',
    score: r.score,
    box: { x0: clamp(r.box.xmin), y0: clamp(r.box.ymin), x1: clamp(r.box.xmax), y1: clamp(r.box.ymax) },
  })).filter(o => (o.box.x1 - o.box.x0) > 0.04 && (o.box.y1 - o.box.y0) > 0.05);
  // Nicht-Maximum-Unterdrückung je Typ
  objs.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const o of objs) if (!keep.some(k => k.type === o.type && iou(k.box, o.box) > 0.35)) keep.push(o);
  // Türen: nur die beste; muss hoch sein (Höhe > 35 % des Bildes) und hochformatig
  const doors = keep.filter(o => o.type === 'door' && o.score > 0.08 && (o.box.y1 - o.box.y0) > 0.35 &&
    (o.box.y1 - o.box.y0) > (o.box.x1 - o.box.x0) * 0.9 * (canvas.width / canvas.height));
  // Fenster: bis 3, nicht fast identisch mit der Tür
  const wins = keep.filter(o => o.type === 'window' && o.score > 0.1 && !(doors[0] && iou(doors[0].box, o.box) > 0.6)).slice(0, 3);
  return [...wins, ...(doors[0] ? [doors[0]] : [])];
}

const clamp = v => Math.min(1, Math.max(0, v));
