// ============================================================
// 05-eq-waveform.js — Curva de EQ, waveform, loudness meter
// ============================================================

// ── Web Worker para el cálculo de la curva EQ ────────────────
// El worker recibe { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands, SR, W }
// y devuelve { gains, freqs } para dibujar.
(function() {
  const workerCode = `
    function peakResponse(f, freq, gainDb, q, SR) {
      if (gainDb === 0) return 0;
      const A = Math.pow(10, gainDb / 40);
      const w0 = (2 * Math.PI * freq) / SR;
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = 1 + alpha * A,
        b1 = -2 * Math.cos(w0),
        b2 = 1 - alpha * A;
      const a0 = 1 + alpha / A,
        a1 = -2 * Math.cos(w0),
        a2 = 1 - alpha / A;
      const w = (2 * Math.PI * f) / SR;
      const cosW = Math.cos(w),
        sinW = Math.sin(w);
      const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
      const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
      const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
      const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
      const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
      return 20 * Math.log10(mag + 1e-12);
    }
    function hpResponse(f, cutoff) {
      if (f <= 0) return -100;
      const r = f / cutoff;
      return 20 * Math.log10((r * r) / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
    }
    function lpResponse(f, cutoff) {
      if (!cutoff || f <= 0) return 0;
      const r = f / cutoff;
      return 20 * Math.log10(1 / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
    }
    function highShelfResponse(f, cutoff, gainDb, SR) {
      if (gainDb === 0) return 0;
      const A = Math.pow(10, gainDb / 40);
      const w0 = (2 * Math.PI * cutoff) / SR;
      const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
      const alpha = (sin_w0 / 2) * Math.sqrt(2);
      const sqrtA = Math.sqrt(A);
      const b0 = A * (A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha);
      const b1 = -2 * A * (A - 1 + (A + 1) * cos_w0);
      const b2 = A * (A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha);
      const a0 = A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha;
      const a1 = 2 * (A - 1 - (A + 1) * cos_w0);
      const a2 = A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha;
      const w = (2 * Math.PI * f) / SR;
      const cosW = Math.cos(w), sinW = Math.sin(w);
      const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
      const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
      const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
      const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
      const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
      return 20 * Math.log10(mag + 1e-12);
    }
    function lowShelfResponse(f, cutoff, gainDb, SR) {
      if (gainDb === 0) return 0;
      const A = Math.pow(10, gainDb / 40);
      const w0 = (2 * Math.PI * cutoff) / SR;
      const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
      const alpha = (sin_w0 / 2) * Math.sqrt(2);
      const sqrtA = Math.sqrt(A);
      const b0 = A * (A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha);
      const b1 = 2 * A * (A - 1 - (A + 1) * cos_w0);
      const b2 = A * (A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha);
      const a0 = A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha;
      const a1 = -2 * (A - 1 + (A + 1) * cos_w0);
      const a2 = A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha;
      const w = (2 * Math.PI * f) / SR;
      const cosW = Math.cos(w), sinW = Math.sin(w);
      const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
      const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
      const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
      const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
      const mag2 = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
      return 20 * Math.log10(mag2 + 1e-12);
    }

    self.onmessage = function(e) {
      const { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands, SR, W } = e.data;
      const freqs = [];
      for (let i = 0; i < W; i++) {
        freqs.push(Math.pow(10, Math.log10(20) + (i / (W - 1)) * (Math.log10(20000) - Math.log10(20))));
      }
      const gains = freqs.map((f) => {
        let g = hpResponse(f, hp);
        if (lp) g += lpResponse(f, lp);
        bands.forEach((b) => {
          g += peakResponse(f, b.freq, b.gain, b.q, SR);
        });
        g += highShelfResponse(f, shelfFreq || 8000, air, SR);
        g += lowShelfResponse(f, lowShelfFreq || 100, lowShelfGain, SR);
        return g;
      });
      self.postMessage({ gains, freqs });
    };
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const eqWorker = new Worker(workerUrl);
  let eqCallback = null;

  // ── Función pública para pedir el cálculo al worker ──────────
  function computeEQCurve(params, callback) {
    eqCallback = callback;
    eqWorker.postMessage(params);
  }

  eqWorker.onmessage = function(e) {
    if (eqCallback) {
      eqCallback(e.data);
      eqCallback = null;
    }
  };

  // Exponer la función globalmente
  window.computeEQCurve = computeEQCurve;
})();

// ── Funciones existentes ──────────────────────────────────────
function getEQParams() {
  const hp = parseFloat(document.getElementById("s-hp").value);
  const lpBypass = document.getElementById("s-lp-bypass")?.checked ?? true;
  const lp = lpBypass ? null : parseFloat(document.getElementById("s-lp-cutoff").value);
  const air = parseFloat(document.getElementById("s-air").value);
  const shelfFreq = parseFloat(document.getElementById("s-shelf-freq").value);
  const lowShelfGain = parseFloat(document.getElementById("s-lowshelf").value);
  const lowShelfFreq = parseFloat(document.getElementById("s-lowshelf-freq").value);
  const bands = [];
  for (let i = 1; i <= 6; i++) {
    bands.push({
      freq: parseFloat(document.getElementById(`s-eq${i}freq`).value),
      gain: parseFloat(document.getElementById(`s-eq${i}gain`).value),
      q: parseFloat(document.getElementById(`s-eq${i}q`).value),
    });
  }
  return { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands };
}

// ── drawEQCurve ahora usa el worker ──────────────────────────
function drawEQCurve() {
  const canvas = document.getElementById("eqCurveCanvas");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 280,
    H = 140;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { surface2: bg, border: borderC, accent: accentC } = themeColors();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const params = getEQParams();
  const SR = 44100;

  // Pedir cálculo al worker
  if (typeof window.computeEQCurve === 'function') {
    window.computeEQCurve({
      hp: params.hp,
      lp: params.lp,
      air: params.air,
      shelfFreq: params.shelfFreq,
      lowShelfGain: params.lowShelfGain,
      lowShelfFreq: params.lowShelfFreq,
      bands: params.bands,
      SR: SR,
      W: W
    }, function(result) {
      const { gains, freqs } = result;
      // Dibujar la curva con los datos recibidos
      drawEQCurveOnCanvas(ctx, W, H, gains, freqs, borderC, accentC);
    });
  } else {
    // Fallback síncrono (por si el worker falla)
    const gains = calculateEQSync(params, SR, W);
    drawEQCurveOnCanvas(ctx, W, H, gains, null, borderC, accentC);
  }
}

function drawEQCurveOnCanvas(ctx, W, H, gains, freqs, borderC, accentC) {
  const maxG = 18;
  const padL = 32,
    padT = 8,
    padB = 18,
    padR = 6;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;
  const yOf = (g) => padT + plotH / 2 - (g / maxG) * (plotH / 2 - 2);
  const xOfFreq = (f) => padL + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * plotW;

  // Grid horizontal (dB)
  ctx.font = "9px monospace";
  [-18, -12, -6, 0, 6, 12, 18].forEach((db) => {
    const y = yOf(db);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.strokeStyle = db === 0 ? "rgba(139,108,255,.35)" : borderC;
    ctx.lineWidth = db === 0 ? 1 : 0.5;
    ctx.stroke();
    ctx.fillStyle = db === 0 ? accentC : "#6b678a";
    ctx.fillText((db >= 0 ? "+" : "") + db, 2, y + 3);
  });

  // Grid vertical (freq)
  [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
    const x = xOfFreq(f);
    if (x < padL || x > padL + plotW) return;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.strokeStyle = borderC;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    const lbl = f >= 1000 ? f / 1000 + "k" : String(f);
    ctx.fillStyle = "#6b678a";
    ctx.font = "8px monospace";
    ctx.fillText(lbl, x - 8, H - 4);
  });

  // Curve
  const curvePoints = gains.map((g, i) => {
    const f = freqs ? freqs[i] : Math.pow(10, Math.log10(20) + (i / (gains.length - 1)) * (Math.log10(20000) - Math.log10(20)));
    return [
      padL + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * plotW,
      Math.max(padT + 2, Math.min(padT + plotH - 2, yOf(g))),
    ];
  });
  // Fill under curve
  ctx.beginPath();
  curvePoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.lineTo(curvePoints[curvePoints.length - 1][0], yOf(0));
  ctx.lineTo(curvePoints[0][0], yOf(0));
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, "rgba(139,108,255,.25)");
  grad.addColorStop(1, "rgba(139,108,255,.03)");
  ctx.fillStyle = grad;
  ctx.fill();
  // Stroke
  ctx.beginPath();
  curvePoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = accentC;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Fallback síncrono (copia de las funciones de respuesta)
function calculateEQSync(params, SR, W) {
  const { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands } = params;
  const freqs = [];
  for (let i = 0; i < W; i++) {
    freqs.push(Math.pow(10, Math.log10(20) + (i / (W - 1)) * (Math.log10(20000) - Math.log10(20))));
  }
  // Funciones de respuesta (copiadas del worker)
  function peakResponse(f, freq, gainDb, q) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * freq) / SR;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = 1 + alpha * A,
      b1 = -2 * Math.cos(w0),
      b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A,
      a1 = -2 * Math.cos(w0),
      a2 = 1 - alpha / A;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag + 1e-12);
  }
  function hpResponse(f, cutoff) {
    if (f <= 0) return -100;
    const r = f / cutoff;
    return 20 * Math.log10((r * r) / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
  }
  function lpResponse(f, cutoff) {
    if (!cutoff || f <= 0) return 0;
    const r = f / cutoff;
    return 20 * Math.log10(1 / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
  }
  function highShelfResponse(f, cutoff, gainDb) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * cutoff) / SR;
    const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
    const alpha = (sin_w0 / 2) * Math.sqrt(2);
    const sqrtA = Math.sqrt(A);
    const b0 = A * (A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha);
    const b1 = -2 * A * (A - 1 + (A + 1) * cos_w0);
    const b2 = A * (A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha);
    const a0 = A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha;
    const a1 = 2 * (A - 1 - (A + 1) * cos_w0);
    const a2 = A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag + 1e-12);
  }
  function lowShelfResponse(f, cutoff, gainDb) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * cutoff) / SR;
    const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
    const alpha = (sin_w0 / 2) * Math.sqrt(2);
    const sqrtA = Math.sqrt(A);
    const b0 = A * (A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha);
    const b1 = 2 * A * (A - 1 - (A + 1) * cos_w0);
    const b2 = A * (A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha);
    const a0 = A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha;
    const a1 = -2 * (A - 1 + (A + 1) * cos_w0);
    const a2 = A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag2 = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag2 + 1e-12);
  }

  const gains = freqs.map((f) => {
    let g = hpResponse(f, hp);
    if (lp) g += lpResponse(f, lp);
    bands.forEach((b) => {
      g += peakResponse(f, b.freq, b.gain, b.q);
    });
    g += highShelfResponse(f, shelfFreq || 8000, air);
    g += lowShelfResponse(f, lowShelfFreq || 100, lowShelfGain);
    return g;
  });
  return gains;
}

// ── Throttle: un solo repintado por frame ────────────────────
let _eqRafPending = false;
function scheduleEQCurve() {
  if (_eqRafPending) return;
  _eqRafPending = true;
  requestAnimationFrame(() => {
    _eqRafPending = false;
    drawEQCurve();
  });
}
[
  "s-hp",
  "s-lp-cutoff",
  "s-eq1freq",
  "s-eq1gain",
  "s-eq1q",
  "s-eq2freq",
  "s-eq2gain",
  "s-eq2q",
  "s-eq3freq",
  "s-eq3gain",
  "s-eq3q",
  "s-eq4freq",
  "s-eq4gain",
  "s-eq4q",
  "s-eq5freq",
  "s-eq5gain",
  "s-eq5q",
  "s-eq6freq",
  "s-eq6gain",
  "s-eq6q",
  "s-air",
  "s-shelf-freq",
  "s-lowshelf",
  "s-lowshelf-freq",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", scheduleEQCurve);
});
document.getElementById("s-lp-bypass")?.addEventListener("change", scheduleEQCurve);
drawEQCurve();

// ── Waveform ────────────────────────────────────────────────────────────────
function drawWaveform(audioBuffer) {
  const container = document.getElementById("content");
  let wrap = document.getElementById("waveformWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "waveformWrap";
    wrap.className = "waveform-wrap";
    wrap.innerHTML = `<h3>Waveform <span style="color:var(--muted);font-size:.7rem;font-weight:400;font-family:var(--mono)">${audioBuffer.duration.toFixed(1)}s · ${audioBuffer.sampleRate}Hz · ${audioBuffer.numberOfChannels}ch</span></h3><canvas id="waveformCanvas"></canvas><div class="waveform-legend"><span style="color:var(--muted)">■</span> Original&nbsp;&nbsp;<span style="color:var(--accent)">■</span> Masterizado</div>`;
    container.prepend(wrap);
  }
  const canvas = document.getElementById("waveformCanvas");
  renderWaveformToCanvas(canvas, audioBuffer, "var(--muted)");
}

function renderWaveformToCanvas(canvas, audioBuffer, color = "var(--accent)", alpha = 1) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600,
    H = 100;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = themeColors();
  ctx.fillStyle = theme.surface2;
  ctx.fillRect(0, 0, W, H);
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const resolvedColor = color.startsWith("var(") ? theme.get(color.slice(4, -1)) : color;
  ctx.strokeStyle = resolvedColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    let min = 1,
      max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = (1 - (min + 1) / 2) * H,
      yMax = (1 - (max + 1) / 2) * H;
    if (i === 0) ctx.moveTo(i, yMin);
    else ctx.lineTo(i, yMin);
    ctx.lineTo(i, yMax);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Loudness meter ──────────────────────────────────────────────────────────
function showLoudnessMeter(lufsValue) {
  let wrap = document.getElementById("loudnessMeterWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "loudnessMeterWrap";
    wrap.className = "loudness-meter";
    wrap.innerHTML = `<h3>Loudness Meter (LUFS)</h3><div class="lufs-display"><div><div class="lufs-number" id="lufsNumber">---</div><div class="lufs-label">LUFS integrado</div></div><div style="flex:1"><div class="lufs-bar-track"><div class="lufs-bar-fill" id="lufsBarFill"></div></div><div class="lufs-zones"><span>-40</span><span>-24</span><span>-18</span><span>-14</span><span>-9</span><span>-6</span><span>0</span></div></div></div><div style="font-size:.75rem;color:var(--muted);font-family:var(--mono)" id="lufsTarget">Target Spotify/YouTube: -14 LUFS · Club: -9 LUFS</div>`;
    document.getElementById("content").prepend(wrap);
  }
  document.getElementById("lufsNumber").textContent = lufsValue.toFixed(1);
  const pct = Math.max(0, Math.min(100, ((lufsValue + 40) / 40) * 100));
  const fill = document.getElementById("lufsBarFill");
  fill.style.width = pct + "%";
  fill.style.background =
    lufsValue > -6
      ? "var(--red)"
      : lufsValue > -9
        ? "var(--yellow)"
        : lufsValue >= -18
          ? "var(--yellow)"
          : "var(--muted)";
}