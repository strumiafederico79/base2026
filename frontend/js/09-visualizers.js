// ============================================================
// 09-visualizers.js — FFT, EQ dinámico en vivo, Preview, FFT Web Worker
// ============================================================

// ── Extensión de caché para selectores ──────────────────────
// Reutilizamos la caché de 10-meters-dashboard.js, pero por si no está definida,
// creamos una propia.
if (typeof cachedEl === 'undefined') {
  const _domCache = new Map();
  window.cachedEl = function(id) {
    if (!_domCache.has(id)) {
      const el = document.getElementById(id);
      _domCache.set(id, el);
    }
    return _domCache.get(id);
  };
}

// ── FFT ──────────────────────────────────────────────────────
// ── Visualizador de espectro en tiempo real (streaming chunk a chunk) ─────────
// Recibe el array bands_db (32 bandas log) que viene en metrics.spectrum
// y dibuja un bar graph animado sobre el canvas jobSpectrumCanvas.
// BUGFIX: esta función se llamaba también "drawLiveSpectrum", igual que la
// función de más abajo (canvas, dataL, dataR, sampleRate) que dibuja el
// espectro del monitor de entrada en vivo. Al haber DOS declaraciones
// "function drawLiveSpectrum" en el mismo scope global, la segunda
// pisaba a la primera (hoisting), y la llamada de acá (con 1 solo
// argumento, bandsDb) terminaba ejecutando la función equivocada —
// tratando el array bandsDb como si fuera un elemento <canvas>, lo que
// tiraba "canvas.getContext is not a function" cada vez que llegaba
// espectro por streaming durante el render. Se renombra a drawJobSpectrum
// para que ambas funciones convivan sin pisarse.
let _liveSpecSmooth = null; // suavizado exponencial entre chunks

function drawJobSpectrum(bandsDb) {
  const canvas = document.getElementById("jobSpectrumCanvas");
  if (!canvas) return;
  const wrap = document.getElementById("liveSpectrumWrap");
  if (wrap) wrap.style.display = "block";

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement.clientWidth || 600;
  const cssH = 80;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const N = bandsDb.length;
  // Suavizado exponencial para evitar parpadeo entre chunks
  if (!_liveSpecSmooth || _liveSpecSmooth.length !== N) {
    _liveSpecSmooth = Float32Array.from(bandsDb);
  } else {
    const alpha = 0.35; // mayor = más rápido, menor = más suave
    for (let i = 0; i < N; i++) {
      _liveSpecSmooth[i] = alpha * bandsDb[i] + (1 - alpha) * _liveSpecSmooth[i];
    }
  }

  ctx.clearRect(0, 0, cssW, cssH);

  const gap = 2;
  const barW = (cssW - gap * (N - 1)) / N;
  const DB_MIN = -80,
    DB_MAX = 0;

  for (let i = 0; i < N; i++) {
    const db = Math.max(DB_MIN, Math.min(DB_MAX, _liveSpecSmooth[i]));
    const t = (db - DB_MIN) / (DB_MAX - DB_MIN); // 0..1
    const h = Math.max(1, t * (cssH - 4));
    const x = i * (barW + gap);
    const y = cssH - h - 2;

    const brow = 40 - (i / N) * 12;
    const light = 36 + t * 28;
    ctx.fillStyle = `hsl(${brow},85%,${light}%)`;
    ctx.shadowColor = `rgba(231, 177, 90, ${0.18 + t * 0.18})`;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Línea de referencia -18 dBFS
  const refT = (-18 - DB_MIN) / (DB_MAX - DB_MIN);
  const refY = cssH - refT * (cssH - 4) - 2;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, refY);
  ctx.lineTo(cssW, refY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.font = "9px monospace";
  ctx.fillText("-18 dB", 4, refY - 3);
}

function hideLiveSpectrum() {
  const wrap = document.getElementById("liveSpectrumWrap");
  if (wrap) wrap.style.display = "none";
  _liveSpecSmooth = null;
}

// ── Dynamic EQ — recomendación en vivo (resonancias / sibilancia) ───────────
// Viene en metrics.dynamic_eq_recommendation de cada chunk de /ws/master-stream
// (ver streaming_engine.py). Se recalcula cada ~6s de audio, no en cada chunk,
// así que comparamos por "summary" para no re-renderizar (y resetear el botón
// "Aplicado") en cada uno de los chunks que repiten la misma detección.
let _lastDynEqRec = null;
let _lastDynEqRecSummary = null;

function renderDynEqRecommendation(rec) {
  if (!rec) return;
  _lastDynEqRec = rec;
  if (rec.summary === _lastDynEqRecSummary) return;
  _lastDynEqRecSummary = rec.summary;

  const wrap = document.getElementById("dynEqRecWrap");
  const body = document.getElementById("dynEqRecBody");
  if (!wrap || !body) return;
  wrap.style.display = "block";

  const resonances = rec.resonances || [];
  const sib = rec.sibilance || {};

  let html = `<div style="margin-bottom:.5rem">${rec.summary || ""}</div>`;

  if (resonances.length) {
    html += `<div style="margin-bottom:.4rem"><b>Resonancias detectadas:</b><ul style="margin:.25rem 0 0;padding-left:1.1rem">`;
    resonances.slice(0, 4).forEach((r, i) => {
      html += `<li>${r.freq_hz.toFixed(0)} Hz (+${r.excess_db.toFixed(1)} dB)${i === 0 ? ' — <span style="color:var(--lilac)">se usará para Reso</span>' : ""}</li>`;
    });
    html += `</ul></div>`;
  }

  if (sib.present) {
    html += `<div style="margin-bottom:.4rem"><b>Sibilancia:</b> ${sib.band_hz[0].toFixed(0)}-${sib.band_hz[1].toFixed(0)} Hz, severidad ${sib.severity_db.toFixed(1)} dB (${sib.frames_flagged_pct.toFixed(1)}% de cuadros)</div>`;
  }

  if (!resonances.length && !sib.present) {
    html += `<div style="color:var(--muted)">Sin problemas relevantes detectados en este momento del track.</div>`;
  }

  html += `<div style="display:flex;gap:.4rem;margin-top:.5rem">
    <button class="ai-suggestion-apply-btn" id="dynEqApplyBtn" style="flex:1">✓ Aplicar a Reso / De-esser</button>
  </div>`;

  body.innerHTML = html;

  const applyBtn = document.getElementById("dynEqApplyBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!_lastDynEqRec || !_lastDynEqRec.recommended_params) return;
      applyPresetToUI(_lastDynEqRec.recommended_params);
      applyBtn.textContent = "✓ Aplicado";
      applyBtn.disabled = true;
    });
  }
}

function hideDynEqRecommendation() {
  const wrap = document.getElementById("dynEqRecWrap");
  if (wrap) wrap.style.display = "none";
  const body = document.getElementById("dynEqRecBody");
  if (body) body.innerHTML = "";
  _lastDynEqRec = null;
  _lastDynEqRecSummary = null;
}

// ── FFT rendering ────────────────────────────────────────────
function drawFFTOnCanvas(canvas, series) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600,
    cssHeight = 220;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const allDb = series.flatMap((s) => s.data.magnitudes_db);
  const minDb = Math.min(...allDb, -80),
    maxDb = Math.max(...allDb, -10);
  const padL = 36,
    padB = 18,
    padT = 8,
    padR = 8;
  const plotW = cssWidth - padL - padR,
    plotH = cssHeight - padT - padB;
  const theme = themeColors();
  const colorOf = (c) => {
    if (!c) return theme.accent;
    const m = c.match(/var\((--[a-z0-9-]+)\)/);
    return m ? theme.get(m[1]) : c;
  };
  const borderColor = theme.border,
    mutedColor = theme.muted;
  ctx.strokeStyle = borderColor;
  ctx.fillStyle = mutedColor;
  ctx.font = "10px monospace";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const db = maxDb - (i / 4) * (maxDb - minDb);
    const y = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(Math.round(db) + "dB", 2, y + 3);
  }
  const freqs = series[0].data.frequencies_hz;
  const fMin = Math.max(freqs[0], 20),
    fMax = freqs[freqs.length - 1];
  const xForFreq = (f) =>
    padL + ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * plotW;
  [20, 100, 1000, 10000, 20000].forEach((f) => {
    if (f < fMin || f > fMax) return;
    const x = xForFreq(f);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(f >= 1000 ? f / 1000 + "k" : f, x - 8, cssHeight - 4);
  });
  series.forEach((s) => {
    const freqs = s.data.frequencies_hz,
      mags = s.data.magnitudes_db;
    ctx.beginPath();
    ctx.strokeStyle = colorOf(s.color);
    ctx.lineWidth = 2;
    freqs.forEach((f, i) => {
      const x = xForFreq(Math.max(f, fMin));
      const norm = (mags[i] - minDb) / (maxDb - minDb);
      const y = padT + plotH - Math.max(0, Math.min(1, norm)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  let lx = padL + 6,
    ly = padT + 6;
  series.forEach((s) => {
    ctx.fillStyle = colorOf(s.color);
    ctx.fillRect(lx, ly - 7, 8, 8);
    ctx.fillStyle = mutedColor;
    ctx.fillText(s.label, lx + 12, ly);
    lx += 12 + ctx.measureText(s.label).width + 16;
  });
}

function renderFFT(series) {
  const wrap = document.createElement("div");
  wrap.className = "fft-wrap";
  const legendHtml = series
    .map(
      (s) =>
        `<span style="color:${s.color || "var(--accent)"}">■</span> <span style="color:var(--muted);margin-right:1rem;font-size:.72rem;font-family:var(--mono)">${s.label}</span>`,
    )
    .join("");
  wrap.innerHTML = `<h3>Spectrum Analyzer (FFT)</h3><canvas></canvas><div style="margin-top:.6rem">${legendHtml}</div>`;
  getContent().appendChild(wrap);
  drawFFTOnCanvas(wrap.querySelector("canvas"), series);
}

function renderSpectrum(datasets, labels) {
  const wrap = document.createElement("div");
  wrap.className = "spectrum-wrap";
  const bandNames = {
    sub_bass: "Sub",
    bass: "Bass",
    low_mid: "Lo-Mid",
    mid: "Mid",
    upper_mid: "Hi-Mid",
    presence: "Pres",
    air: "Air",
  };
  const keys = Object.keys(bandNames);
  const FLOOR_DB = -80;
  const clamp = (v) => Math.max(v, FLOOR_DB);
  const allVals = datasets.flatMap((d) => keys.map((k) => clamp(d.spectrum[k] ?? FLOOR_DB)));
  const minV = Math.min(...allVals) - 5,
    maxV = Math.max(...allVals) + 5;
  const norm = (v) => Math.max(0, Math.min(100, ((clamp(v) - minV) / (maxV - minV)) * 100));
  const barsHtml = keys
    .map((k) => {
      const [d0, d1] = datasets;
      const v0 = norm(d0?.spectrum[k] ?? FLOOR_DB);
      const v1 = d1 ? norm(d1.spectrum[k] ?? FLOOR_DB) : null;
      return `<div class="bar-wrap"><div class="bar-track"><div class="bar-before" style="height:${v0}%"></div>${v1 != null ? `<div class="bar-after" style="height:${v1}%"></div>` : ""}</div><div class="bar-label">${bandNames[k]}</div></div>`;
    })
    .join("");
  const legendHtml =
    datasets.length === 2
      ? `<div class="legend"><span class="l-before">Antes</span><span class="l-after">Después</span></div>`
      : `<div class="legend"><span class="l-before">Espectro</span></div>`;
  wrap.innerHTML = `<h3>Espectro por bandas</h3><div class="spectrum-bars">${barsHtml}</div>${legendHtml}`;
  getContent().appendChild(wrap);
}

function metricsHtml(a, b) {
  const rows = [
    [
      "LUFS",
      a.lufs,
      b?.lufs,
      (v) => `${v} LUFS`,
      (v) => (v >= -14 && v <= -8 ? "good" : v >= -18 && v < -14 ? "warn" : "bad"),
    ],
    ["RMS", a.rms_db, b?.rms_db, (v) => `${v} dB`, () => "neutral"],
    ["Peak", a.peak_db, b?.peak_db, (v) => `${v} dBFS`, (v) => (v > -0.5 ? "warn" : "good")],
    [
      "Rango dinámico",
      a.dynamic_range_db,
      b?.dynamic_range_db,
      (v) => `${v} dB`,
      (v) => (v < 6 ? "bad" : v <= 12 ? "good" : "warn"),
    ],
    ["BPM", a.bpm, b?.bpm, (v) => `${v}`, () => "neutral"],
    ["Duración", a.duration_sec, null, (v) => `${v} s`, () => "neutral"],
    ["Sample rate", a.sample_rate, null, (v) => `${v} Hz`, () => "neutral"],
    ["Canales", a.channels, null, (v) => (v === 1 ? "Mono" : "Estéreo"), () => "neutral"],
  ];
  return rows
    .map(
      ([label, va, vb, fmt, cls]) =>
        `<div class="metric-row"><span class="metric-label">${label}</span><span class="metric-value ${cls(va)}">${fmt(va)}${b && vb != null ? ' <span class="delta ' + (vb > va ? "up" : "down") + '">' + (vb > va ? "+" : "") + (vb - va).toFixed(1) + "</span>" : ""}</span></div>`,
    )
    .join("");
}

function renderAnalysisSingle(a) {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";
  grid.innerHTML = `<div class="analysis-panel"><h3>Métricas del audio</h3>${metricsHtml(a, null)}</div>`;
  getContent().appendChild(grid);
  renderProfessionalMeter(a);
  renderSpectrum([a], ["before"]);
}

function renderAnalysisComparison(before, after) {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";
  grid.innerHTML = `<div class="analysis-panel"><h3>Antes</h3>${metricsHtml(before, null)}</div><div class="analysis-panel"><h3>Después</h3>${metricsHtml(after, before)}</div>`;
  getContent().appendChild(grid);
  renderProfessionalMeter(after);
  renderSpectrum([before, after], ["before", "after"]);
  if (before.fft_spectrum && after.fft_spectrum) {
    renderFFT([
      { label: "Antes", data: before.fft_spectrum, color: "var(--muted)" },
      { label: "Después", data: after.fft_spectrum, color: "var(--accent)" },
    ]);
  }
}

// ── A/B Player con waveforms superpuestas ────────────────────
let _abCtx          = null;
let _abOriginalBuf  = null;   // AudioBuffer del original decodificado
let _abMasterBuf    = null;   // AudioBuffer del master decodificado
let _abMode         = "master";
let _abNode         = null;   // AudioBufferSourceNode activo
let _abStartTime    = 0;      // AudioContext.currentTime cuando arrancó la reproducción
let _abOffset       = 0;      // posición en el buffer al momento de arrancar
let _abPlaying      = false;
let _abGain         = null;   // GainNode para fade suave en el toggle

// ── Nueva función para dibujar waveforms superpuestas ────────
function drawOverlayWaveforms(originalBuffer, masterBuffer, canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600,
    H = 120;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const theme = themeColors();
  ctx.fillStyle = theme.surface2;
  ctx.fillRect(0, 0, W, H);

  // Función para dibujar un waveform con un color y opacidad
  function drawBufferWaveform(buffer, color, alpha, label) {
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / W);
    const resolvedColor = color.startsWith("var(") ? theme.get(color.slice(4, -1)) : color;
    ctx.strokeStyle = resolvedColor;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.2;
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
    // Etiqueta en la esquina superior derecha
    ctx.fillStyle = resolvedColor;
    ctx.font = "10px monospace";
    ctx.fillText(label, W - 80, 14);
  }

  if (originalBuffer) drawBufferWaveform(originalBuffer, "var(--muted)", 0.6, "Original");
  if (masterBuffer) drawBufferWaveform(masterBuffer, "var(--accent2)", 0.9, "Master");
}

// ── A/B player existente con integración de waveforms ────────
function _abGetCtx() {
  if (!_abCtx || _abCtx.state === "closed") {
    _abCtx = new (window.AudioContext || window.webkitAudioContext)();
    _abGain = _abCtx.createGain();
    _abGain.connect(_abCtx.destination);
  }
  return _abCtx;
}

function _abCurrentPosition() {
  if (!_abPlaying || !_abCtx) return _abOffset;
  return _abOffset + (_abCtx.currentTime - _abStartTime);
}

function _abStop() {
  if (_abNode) {
    try { _abNode.stop(); } catch(e) {}
    _abNode.disconnect();
    _abNode = null;
  }
  _abPlaying = false;
}

function _abPlay(buf, offset) {
  if (!buf) return;
  const ctx = _abGetCtx();
  if (ctx.state === "suspended") ctx.resume();
  _abStop();
  _abOffset = Math.max(0, Math.min(offset, buf.duration - 0.01));
  _abNode = ctx.createBufferSource();
  _abNode.buffer = buf;
  _abNode.connect(_abGain);
  _abNode.start(0, _abOffset);
  _abStartTime = ctx.currentTime;
  _abPlaying = true;
  _abNode.onended = () => {
    _abPlaying = false;
    _abOffset = 0;
    _updateABUI();
  };
}

function _abToggle() {
  const pos = _abCurrentPosition();
  _abMode = _abMode === "master" ? "original" : "master";
  const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
  if (_abPlaying) {
    // Fade out suave 30ms, cambia buffer, fade in — sin corte audible
    if (_abGain) {
      _abGain.gain.setTargetAtTime(0, _abCtx.currentTime, 0.015);
      setTimeout(() => {
        _abPlay(buf, pos);
        _abGain.gain.setTargetAtTime(1, _abCtx.currentTime, 0.015);
        _updateABUI();
      }, 40);
    } else {
      _abPlay(buf, pos);
      _updateABUI();
    }
  } else {
    _abOffset = pos;
    _updateABUI();
  }
}

function _updateABUI() {
  const isMaster = _abMode === "master";
  const buf = isMaster ? _abMasterBuf : _abOriginalBuf;
  const label = isMaster ? "🎚 Master" : "🎵 Original";
  const toggleLabel = isMaster ? "⇄ Escuchar Original" : "⇄ Escuchar Master";
  const pos = _abCurrentPosition();
  const dur = buf ? buf.duration : 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  const labelEl  = document.getElementById("abLabel");
  const toggleEl = document.getElementById("btnABToggle");
  const barEl    = document.getElementById("abProgressBar");
  const timeEl   = document.getElementById("abTimeReadout");
  const playEl   = document.getElementById("btnABPlay");

  if (labelEl)  labelEl.textContent = label;
  if (labelEl)  labelEl.style.color = isMaster ? "var(--accent)" : "var(--muted)";
  if (toggleEl) toggleEl.textContent = toggleLabel;
  if (barEl)    barEl.style.width = pct.toFixed(1) + "%";
  if (timeEl && dur > 0) {
    const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
    timeEl.textContent = fmt(pos) + " / " + fmt(dur);
  }
  if (playEl)   playEl.textContent = _abPlaying ? "⏸" : "▶";

  // Actualizar waveform overlay
  const waveformCanvas = document.getElementById("abWaveformCanvas");
  if (waveformCanvas && _abOriginalBuf && _abMasterBuf) {
    drawOverlayWaveforms(_abOriginalBuf, _abMasterBuf, waveformCanvas);
  }
}

function _renderABPlayer() {
  const wrap = document.getElementById("previewAudioWrap");
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="margin-bottom:0.5rem">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap">
        <span id="abLabel" style="font-size:0.78rem;font-weight:700;min-width:6rem;color:var(--accent)">🎚 Master</span>
        <button id="btnABToggle" style="font-size:0.7rem;padding:0.25rem 0.7rem;border-radius:5px;cursor:pointer;background:var(--surface2,#1a1a2e);border:1px solid var(--border,#333);color:var(--text,#eee)">⇄ Escuchar Original</button>
        <span style="font-size:0.62rem;color:var(--muted);margin-left:auto">toggle sin corte</span>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem">
        <button id="btnABPlay" style="font-size:1rem;width:2rem;height:2rem;border-radius:50%;cursor:pointer;background:var(--accent,#7c3aed);border:none;color:#fff;display:flex;align-items:center;justify-content:center">▶</button>
        <button id="btnABStop" style="font-size:0.8rem;width:2rem;height:2rem;border-radius:50%;cursor:pointer;background:var(--surface2,#1a1a2e);border:1px solid var(--border,#333);color:var(--text,#eee)">⏹</button>
        <div style="flex:1;height:6px;background:var(--surface2,#1a1a2e);border-radius:3px;cursor:pointer;position:relative" id="abProgressWrap">
          <div id="abProgressBar" style="height:100%;width:0%;background:var(--accent,#7c3aed);border-radius:3px;pointer-events:none"></div>
        </div>
        <span id="abTimeReadout" style="font-size:0.65rem;color:var(--muted);min-width:5rem;text-align:right">0:00 / 0:00</span>
      </div>
      <div style="margin-top:0.3rem">
        <canvas id="abWaveformCanvas" style="width:100%;height:60px;background:var(--surface2,#1a1a2e);border-radius:4px;display:block"></canvas>
      </div>
    </div>`;

  document.getElementById("btnABToggle")?.addEventListener("click", _abToggle);
  document.getElementById("btnABPlay")?.addEventListener("click", () => {
    if (_abPlaying) {
      _abOffset = _abCurrentPosition();
      _abStop();
    } else {
      const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
      _abPlay(buf, _abOffset);
    }
    _updateABUI();
  });
  document.getElementById("btnABStop")?.addEventListener("click", () => {
    _abOffset = 0;
    _abStop();
    _updateABUI();
  });
  document.getElementById("abProgressWrap")?.addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    const buf  = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
    if (!buf) return;
    const newPos = pct * buf.duration;
    if (_abPlaying) { _abPlay(buf, newPos); }
    else            { _abOffset = newPos; }
    _updateABUI();
  });

  setInterval(() => { if (_abPlaying) _updateABUI(); }, 200);
  _updateABUI();
}

async function setupABPlayer(masterBlob) {
  const origBlob = cachedFileBuffer
    ? new Blob([cachedFileBuffer], { type: selectedFile?.type || "audio/wav" })
    : null;
  if (!origBlob) return;

  const ctx = _abGetCtx();

  // Decodificar ambos en paralelo
  const [origAB, masterAB] = await Promise.all([
    origBlob.arrayBuffer().then(ab => ctx.decodeAudioData(ab)),
    masterBlob.arrayBuffer().then(ab => ctx.decodeAudioData(ab)),
  ]);

  _abOriginalBuf = origAB;
  _abMasterBuf   = masterAB;
  _abMode        = "master";
  _abOffset      = 0;
  _abPlaying     = false;

  _renderABPlayer();
}

function teardownABPlayer() {
  _abStop();
  if (_abCtx) { try { _abCtx.close(); } catch(e) {} _abCtx = null; }
  _abOriginalBuf = null;
  _abMasterBuf   = null;
  _abMode = "master";
  _abOffset = 0;
}

// ── Estado y UI del preview ──────────────────────────────────
function setPreviewStatus(text) {
  const el = document.getElementById("previewStatus");
  if (el) el.textContent = text;
  const panel = document.getElementById("previewPanelStatus");
  if (panel) panel.textContent = text;
}
function setPreviewMode(text) {
  const el = document.getElementById("previewModeBadge");
  if (el) el.textContent = text;
}
function renderProfessionalMeter(a) {
  if (!a) return;
  const existing = document.querySelector(".professional-meter");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.className = "professional-meter";
  const rows = [
    {
      label: "True Peak",
      value: a.true_peak_db,
      unit: "dBTP",
      status: a.true_peak_db > -0.5 ? "bad" : a.true_peak_db > -1.2 ? "warn" : "good",
      hint: "Inter-sample peak real",
    },
    {
      label: "PLR",
      value: a.plr_db,
      unit: "dB",
      status: a.plr_db > 10 ? "good" : a.plr_db > 6 ? "warn" : "bad",
      hint: "Peak-to-Loudness Ratio",
    },
    {
      label: "Dinámica",
      value: a.dynamic_range_db,
      unit: "dB",
      status: a.dynamic_range_db >= 10 ? "good" : a.dynamic_range_db >= 6 ? "warn" : "bad",
      hint: "Rango dinámico global",
    },
    {
      label: "Correlación estéreo",
      value: a.stereo_correlation,
      unit: "",
      status: a.stereo_correlation < 0.85 ? "warn" : "good",
      hint: "L/R total",
    },
    {
      label: "Mono compatibilidad",
      value: a.mono_compatibility_db,
      unit: "dB",
      status: a.mono_compatibility_db < -5 ? "bad" : a.mono_compatibility_db < -3 ? "warn" : "good",
      hint: "Pérdida al sumar L+R",
    },
    {
      label: "Loudness",
      value: a.lufs,
      unit: "LUFS",
      status: a.lufs >= -14 && a.lufs <= -9 ? "good" : a.lufs >= -18 && a.lufs < -14 ? "warn" : "bad",
      hint: "LUFS integrado",
    },
  ];
  const cards = rows
    .map((item) => {
      const suffix = item.unit ? ` ${item.unit}` : "";
      return `<div class="professional-meter-card"><strong>${item.label}</strong><span class="metric-value ${item.status}">${item.value != null ? item.value.toFixed(item.unit === "" ? 3 : 1) + suffix : "--"}</span><em>${item.hint}</em></div>`;
    })
    .join("");
  const warnings = [];
  if (a.true_peak_db != null && a.true_peak_db > -0.5) warnings.push("True peak peligroso: ajustá el ceiling para evitar clipping inter-sample.");
  if (a.mono_compatibility_db != null && a.mono_compatibility_db < -5) warnings.push("Compatibilidad mono baja: el mix puede colapsar al sumarlo a mono.");
  if (a.stereo_correlation != null && a.stereo_correlation < 0.8) warnings.push("Correlación estéreo baja: el paneo o los efectos pueden generar huecos o cancelaciones.");
  if (a.dynamic_range_db != null && a.dynamic_range_db < 6) warnings.push("Dinámica muy comprimida: cuidado con el limiteador para no aplastar el groove.");
  if (a.lufs != null && a.lufs > -9) warnings.push("El loudness ya es alto para streaming, mantené el ceiling conservador.");
  wrap.innerHTML = `
    <h3>Professional Metering</h3>
    <div class="professional-meter-grid">${cards}</div>
    ${warnings.length ? `<div class="professional-meter-warning">${warnings.map((line) => `• ${line}`).join("<br>")}</div>` : ""}
  `;
  getContent().appendChild(wrap);
}

function setPreviewUpdating(v) {
  const dot = document.getElementById("previewDot");
  const panelDot = document.getElementById("previewPanelDot");
  if (dot) dot.classList.toggle("updating", v);
  if (panelDot) panelDot.classList.toggle("updating", v);
  const badge = document.getElementById("previewModeBadge");
  if (badge) badge.style.opacity = v ? "1" : "0.92";
}

// ── FFT Web Worker ────────────────────────────────────────────
// El cálculo corre off-thread para no bloquear la UI
const _fftWorkerCode = `
function fftInPlace(re,im){const n=re.length;if(n<=1)return;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wRe=Math.cos(ang),wIm=Math.sin(ang);for(let i=0;i<n;i+=len){let cR=1,cI=0;for(let k=0;k<len/2;k++){const uR=re[i+k],uI=im[i+k],vR=re[i+k+len/2]*cR-im[i+k+len/2]*cI,vI=re[i+k+len/2]*cI+im[i+k+len/2]*cR;re[i+k]=uR+vR;im[i+k]=uI+vI;re[i+k+len/2]=uR-vR;im[i+k+len/2]=uI-vI;const nr=cR*wRe-cI*wIm,ni=cR*wIm+cI*wRe;cR=nr;cI=ni}}}}
function simpleFFTMag(real){const n=real.length,re=Float64Array.from(real),im=new Float64Array(n);fftInPlace(re,im);const half=n/2+1,mag=new Float64Array(half);for(let i=0;i<half;i++)mag[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i]);return mag;}
function computeFFTFromBuffer(mono,sr,nBins=96){let n=4096;if(mono.length<n)n=Math.max(64,Math.pow(2,Math.floor(Math.log2(Math.max(mono.length,64)))));const hop=Math.floor(n/2);const win=new Float32Array(n);for(let i=0;i<n;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/(n-1));const frames=[];for(let start=0;start+n<=mono.length;start+=hop){const frame=new Float32Array(n);for(let i=0;i<n;i++)frame[i]=mono[start+i]*win[i];frames.push(simpleFFTMag(frame));if(frames.length>=60)break;}if(!frames.length){const f=new Float32Array(n);for(let i=0;i<Math.min(n,mono.length);i++)f[i]=mono[i]*win[i];frames.push(simpleFFTMag(f));}const nBinsFFT=frames[0].length,avg=new Float64Array(nBinsFFT);frames.forEach(f=>{for(let i=0;i<nBinsFFT;i++)avg[i]+=f[i]/frames.length});const freqs=new Float64Array(nBinsFFT);for(let i=0;i<nBinsFFT;i++)freqs[i]=(i*sr)/n;const nyquist=sr/2,edges=[];for(let i=0;i<=nBins;i++)edges.push(Math.pow(10,Math.log10(20)+(i/nBins)*(Math.log10(nyquist)-Math.log10(20))));const binDb=[],binFreq=[];for(let i=0;i<nBins;i++){const lo=edges[i],hi=edges[i+1];let sum=0,count=0;for(let j=0;j<freqs.length;j++)if(freqs[j]>=lo&&freqs[j]<hi){sum+=avg[j];count++}binDb.push(20*Math.log10((count>0?sum/count:1e-9)+1e-9));binFreq.push((lo+hi)/2);}return{frequencies_hz:binFreq,magnitudes_db:binDb};}
self.onmessage = function(e) {
  const { id, mono, sr, nBins } = e.data;
  const result = computeFFTFromBuffer(mono, sr, nBins);
  self.postMessage({ id, result }, []);
};
`;
const _fftWorkerBlob = new Blob([_fftWorkerCode], { type: "application/javascript" });
const _fftWorkerUrl = URL.createObjectURL(_fftWorkerBlob);
const _fftWorker = new Worker(_fftWorkerUrl);
let _fftCallbacks = {};
let _fftCallId = 0;
_fftWorker.onmessage = function (e) {
  const { id, result } = e.data;
  if (_fftCallbacks[id]) {
    _fftCallbacks[id](result);
    delete _fftCallbacks[id];
  }
};
function computeFFTFromBuffer(mono, sr, nBins = 96) {
  // Versión síncrona de respaldo (usada sólo si el worker no está listo)
  return _computeFFTSync(mono, sr, nBins);
}
function _computeFFTSync(mono, sr, nBins = 96) {
  let n = 4096;
  if (mono.length < n) n = Math.max(64, Math.pow(2, Math.floor(Math.log2(Math.max(mono.length, 64)))));
  const hop = Math.floor(n / 2);
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const frames = [];
  for (let start = 0; start + n <= mono.length; start += hop) {
    const frame = new Float32Array(n);
    for (let i = 0; i < n; i++) frame[i] = mono[start + i] * win[i];
    frames.push(simpleFFTMag(frame));
    if (frames.length >= 60) break;
  }
  if (!frames.length) {
    const f = new Float32Array(n);
    for (let i = 0; i < Math.min(n, mono.length); i++) f[i] = mono[i] * win[i];
    frames.push(simpleFFTMag(f));
  }
  const nBinsFFT = frames[0].length,
    avg = new Float64Array(nBinsFFT);
  frames.forEach((f) => {
    for (let i = 0; i < nBinsFFT; i++) avg[i] += f[i] / frames.length;
  });
  const freqs = new Float64Array(nBinsFFT);
  for (let i = 0; i < nBinsFFT; i++) freqs[i] = (i * sr) / n;
  const nyquist = sr / 2,
    edges = [];
  for (let i = 0; i <= nBins; i++)
    edges.push(Math.pow(10, Math.log10(20) + (i / nBins) * (Math.log10(nyquist) - Math.log10(20))));
  const binDb = [],
    binFreq = [];
  for (let i = 0; i < nBins; i++) {
    const lo = edges[i],
      hi = edges[i + 1];
    let sum = 0,
      count = 0;
    for (let j = 0; j < freqs.length; j++)
      if (freqs[j] >= lo && freqs[j] < hi) {
        sum += avg[j];
        count++;
      }
    binDb.push(20 * Math.log10((count > 0 ? sum / count : 1e-9) + 1e-9));
    binFreq.push((lo + hi) / 2);
  }
  return { frequencies_hz: binFreq, magnitudes_db: binDb };
}

function computeFFTAsync(mono, sr, nBins = 96) {
  return new Promise((resolve, reject) => {
    const id = ++_fftCallId;
    // 🔥 FIX 3: Timeout de 5 segundos y reject si no responde
    const timeoutId = setTimeout(() => {
      delete _fftCallbacks[id];
      reject(new Error("FFT worker timeout"));
    }, 5000);

    _fftCallbacks[id] = (result) => {
      clearTimeout(timeoutId);
      resolve(result);
    };
    const transfer = mono.buffer.byteLength > 0 ? [mono.buffer] : [];
    _fftWorker.postMessage({ id, mono, sr, nBins }, transfer);
  });
}

function simpleFFTMag(real) {
  const n = real.length,
    re = Float64Array.from(real),
    im = new Float64Array(n);
  fftInPlace(re, im);
  const half = n / 2 + 1,
    mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return mag;
}

function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len,
      wRe = Math.cos(ang),
      wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1,
        cI = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k],
          uI = im[i + k],
          vR = re[i + k + len / 2] * cR - im[i + k + len / 2] * cI,
          vI = re[i + k + len / 2] * cI + im[i + k + len / 2] * cR;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR;
        im[i + k + len / 2] = uI - vI;
        const nr = cR * wRe - cI * wIm,
          ni = cR * wIm + cI * wRe;
        cR = nr;
        cI = ni;
      }
    }
  }
}

function computeAndCacheOriginalFFT(audioBuffer) {
  const sr = audioBuffer.sampleRate;
  const c0 = audioBuffer.getChannelData(0);
  const mono =
    audioBuffer.numberOfChannels > 1
      ? (() => {
          const c1 = audioBuffer.getChannelData(1),
            m = new Float32Array(c0.length);
          for (let i = 0; i < c0.length; i++) m[i] = (c0[i] + c1[i]) / 2;
          return m;
        })()
      : c0;
  // Usar worker async para no bloquear la UI al cargar el archivo
  computeFFTAsync(mono, sr, 96).then((result) => {
    originalFFTCache = result;
  });
}

// ── Preview ────────────────────────────────────────────────────
function schedulePreview() {
  if (!document.getElementById("s-livepreview").checked || !selectedFile) return;
  clearTimeout(previewDebounceTimer);
  setPreviewStatus("Esperando…");
  previewDebounceTimer = setTimeout(runLivePreview, 600);
}

function wsUrlFor(path) {
  const apiUrl = new URL(API());
  return `${apiUrl.protocol === "https:" ? "wss" : "ws"}://${apiUrl.host}${path}`;
}

function wavBlobFromPcm16(chunks, sampleRate, channels) {
  // El backend (streaming_engine.master_stream_to_pcm16, llamado con
  // pcm_format="int16" desde /ws/master-stream — SOLO el preview
  // estándar, no el de referencia) manda los chunks como PCM int16
  // real (2 bytes/muestra, truncado en el propio backend). El header
  // tiene que declarar formato=1 (PCM entero) y bitsPerSample=16 para
  // que coincida con lo que realmente viaja por el socket.
  const dataSize = chunks.reduce((n, b) => n + b.byteLength, 0);
  const BYTES_PER_SAMPLE = 2; // int16
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM entero
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * BYTES_PER_SAMPLE, true);
  view.setUint16(32, channels * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true); // 16-bit
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return new Blob([header, ...chunks], { type: "audio/wav" });
}

async function runLivePreview() {
  if (!selectedFile) return;
  if (previewAbortController) previewAbortController.abort();
  if (previewWS) {
    try {
      previewWS.close();
    } catch (e) {}
    previewWS = null;
  }
  // Limpiar A/B player anterior si existe
  try { teardownABPlayer(); } catch (e) {}
  // Detener cualquier espectro previo del reproductor
  try { stopPreviewSpectrum(); } catch (e) {}
  previewAbortController = new AbortController();
  const wrap = document.getElementById("previewWrap");
  wrap.style.display = "block";
  setPreviewUpdating(true);
  setPreviewMode("Live stream · 10s");
  setPreviewStatus("Streameando preview…");

  try {
    const ws = new WebSocket(wsUrlFor("/ws/master-stream"));
    previewWS = ws;
    const pcmChunks = [];
    let sampleRate = 44100,
      channels = 2,
      lastMetrics = null;
    previewAbortController.signal.addEventListener("abort", () => {
      try {
        ws.close();
      } catch (e) {}
    });

    await new Promise((resolve, reject) => {
      ws.binaryType = "arraybuffer";
      ws.onopen = async () => {
        const cfg = Object.fromEntries(buildParams().entries());
        cfg.chunk_seconds = 0.35;
        cfg.output_format = "wav";
        cfg.preview_seconds = 10;
        cfg.session_id = _previewSessionId; // para que el servidor identifique la sesión y evite re-upload
        if (_previewLibraryId) cfg.library_id = _previewLibraryId; // archivo elegido desde la librería del server
        console.log("[preview] enviando config al backend:", cfg);
        ws.send(JSON.stringify(cfg));
      };
      const uploadFile = async () => {
        // Usar buffer cacheado en lugar de releer el archivo desde disco
        const buf = cachedFileBuffer || (await selectedFile.arrayBuffer());
        if (!cachedFileBuffer) cachedFileBuffer = buf;

        // El archivo se envía en trozos (256KB) en vez de un único
        // frame binario gigante. Esto evita bloquear el event loop
        // del navegador/servidor con payloads enormes y permite
        // aplicar backpressure real: si el socket todavía tiene datos
        // pendientes de enviar (bufferedAmount alto), esperamos antes
        // de encolar el siguiente trozo en vez de amontonar todo de
        // una. Al terminar, se avisa al backend con un frame de texto
        // {"event":"upload_complete"} para que sepa que ya puede
        // ensamblar el archivo completo y arrancar el procesamiento.
        const CHUNK_SIZE = 256 * 1024; // 256KB por trozo
        const BACKPRESSURE_LIMIT = CHUNK_SIZE * 4;
        for (let offset = 0; offset < buf.byteLength; offset += CHUNK_SIZE) {
          if (ws.readyState !== WebSocket.OPEN) break;
          const slice = buf.slice(offset, offset + CHUNK_SIZE);
          while (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
            await new Promise((r) => setTimeout(r, 20));
          }
          ws.send(slice);
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "upload_complete" }));
        }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.event === "use_cache") {
            // El servidor ya tiene el audio (caché de sesión o
            // librería) → solo mandamos parámetros, sin subir nada.
            ws.send(JSON.stringify({ event: "params_only" }));
            return;
          }
          if (msg.event === "need_upload") {
            // Única señal que dispara la subida real del archivo.
            uploadFile();
            return;
          }
          if (msg.event === "lufs_safety") {
            // Corrección de input_gain_db calculada por el safety-check
            // de LUFS antes de arrancar el stream de chunks.
            setPreviewStatus(
              `Ajustando loudness: gain corregido a ${msg.corrected_input_gain_db >= 0 ? "+" : ""}${msg.corrected_input_gain_db} dB (objetivo ${msg.target_lufs} LUFS)…`,
            );
            return;
          }
          if (msg.event === "chunk") {
            lastMetrics = msg.metrics || null;
            sampleRate = msg.sample_rate || sampleRate;
            channels = msg.channels || channels;
            // Meters en vivo (Peak/RMS/LUFS/Stereo + barras de GR por
            // etapa: Comp, Multibanda, Glue, Parallel, De-esser,
            // Dynamic EQ, M/S Comp) — reactivado a pedido. Es liviano
            // (solo actualiza texto/anchos de barra, sin FFT ni
            // gráficos), así que no reintroduce el overhead que se
            // había sacado antes (eso era la visualización de
            // espectro/waveform, que sigue sin correr por chunk).
            if (typeof updateMainMetersFromMetrics === "function" && lastMetrics) {
              updateMainMetersFromMetrics(lastMetrics);
            }
            // Espectro en vivo (barras log, streaming chunk a chunk) y
            // recomendación de Dynamic EQ (resonancias/sibilancia) —
            // estas dos quedaron con la misma orfandad que los GR: la
            // función existe completa (con su botón "Aplicar a Reso /
            // De-esser" funcionando) pero nada la llamaba desde acá.
            if (typeof drawJobSpectrum === "function" && lastMetrics?.spectrum) {
              drawJobSpectrum(lastMetrics.spectrum);
            }
            if (typeof renderDynEqRecommendation === "function" && lastMetrics?.dynamic_eq_recommendation) {
              renderDynEqRecommendation(lastMetrics.dynamic_eq_recommendation);
            }
            const pct = lastMetrics?.progress_pct != null ? ` ${lastMetrics.progress_pct.toFixed(1)}%` : "";
            setPreviewStatus(`Streameando preview${pct}…`);
          } else if (msg.event === "done") resolve();
          else if (msg.event === "error") reject(new Error(msg.message || "Error de streaming"));
        } else {
          pcmChunks.push(ev.data);
        }
      };
      ws.onerror = (ev) => {
        console.error("[preview] error de WebSocket:", ev);
        reject(new Error("No se pudo abrir /ws/master-stream"));
      };
      ws.onclose = (ev) => {
        console.log(
          "[preview] WebSocket cerrado — code:",
          ev.code,
          "reason:",
          ev.reason,
          "wasClean:",
          ev.wasClean,
        );
        if (!lastMetrics) {
          const detail = [];
          if (ev.code) detail.push(`código ${ev.code}`);
          if (ev.reason) detail.push(`"${ev.reason}"`);
          const extra = detail.length
            ? ` (${detail.join(" — ")})`
            : " — el servidor cerró la conexión sin dar motivo, revisá los logs del backend";
          reject(new Error("Streaming cerrado antes de recibir audio" + extra));
        }
      };
    });

    // PCM crudo del WS — se usa únicamente como fallback del reproductor
    // si /preview (HQ) falla más abajo. Ya no se arma ningún gráfico de
    // espectro/FFT a partir de esto.
    const blob16 = wavBlobFromPcm16(pcmChunks, sampleRate, channels);

    // ── Audio player: /preview HTTP → process_audio completo (dither + encode real) ──
    // El WS stream es para meters/FFT en vivo (rápido, baja latencia). Para lo que
    // realmente se ESCUCHA usamos /preview, que corre la cadena idéntica al master
    // final: misma función (process_audio), mismo dither TPDF, mismo encode. Así el
    // preview que escuchás nunca difiere del master real (importa sobre todo cerca
    // del techo, con clipper/limiter agresivos).
    setPreviewStatus("Procesando audio de alta calidad…");
    try {
      const hqParams = buildParams();
      hqParams.set("preview_seconds", "30"); // más largo para el player
      hqParams.set("output_format", "wav");
      hqParams.set("output_bit_depth", "24");
      const hqUrl = `${API()}/preview?${hqParams.toString()}`;
      const hqFormData = new FormData();
      hqFormData.append("file", selectedFile);
      const hqResp = await fetch(hqUrl, {
        method: "POST",
        body: hqFormData,
        signal: previewAbortController.signal,
      });
      if (hqResp.ok) {
        const hqBlob = await hqResp.blob();
        if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
        previewAudioUrl = URL.createObjectURL(hqBlob);
        // A/B player — alterna entre original y master sincronizado al sample
        setupABPlayer(hqBlob);
        setPreviewMode("A/B · HQ 24-bit WAV");
        setPreviewStatus("Preview listo ✓ · A/B habilitado · usá ⇄ para comparar");
      } else {
        // Fallback: usar el PCM del WS si /preview falla
        // BUGFIX: antes esto no leía el body de la respuesta, así que
        // el mensaje real del error (que el backend manda en el JSON,
        // vía HTTPException(500, str(e))) se perdía en silencio y no
        // había forma de saber por qué falló sin mirar el Network tab.
        try {
          const errBody = await hqResp.text();
          console.error("[preview] /preview HQ falló:", hqResp.status, errBody);
        } catch (_) {}
        if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
        previewAudioUrl = URL.createObjectURL(blob16);
        document.getElementById("previewAudioWrap").innerHTML = `<audio controls src="${previewAudioUrl}"></audio>`;
        setPreviewMode("Fallback preview");
        setPreviewStatus("Preview listo (calidad estándar — /preview no disponible)");
      }
    } catch (hqErr) {
      if (hqErr.name === "AbortError") return;
      // Fallback silencioso
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
      previewAudioUrl = URL.createObjectURL(blob16);
      document.getElementById("previewAudioWrap").innerHTML = `<audio controls src="${previewAudioUrl}"></audio>`;
      setPreviewMode("Fallback preview");
      setPreviewStatus("Preview listo ✓");
    }
    setPreviewUpdating(false);
  } catch (e) {
    if (e.name === "AbortError") return;
    setPreviewUpdating(false);
    setPreviewStatus("Error: " + e.message);
  } finally {
    previewWS = null;
  }
}

// ── Array de IDs que disparan preview (se usa en 10) ────────
const previewTriggerIds = [
  "s-ingain",
  "s-peak",
  "s-uselufs",
  "s-lufstarget",
  "s-thresh",
  "s-ratio",
  "s-cattack",
  "s-crelease",
  "s-cmakeup",
  "s-comp-link",
  "s-oversample",
  "s-glue-bypass",
  "s-glue-thresh",
  "s-glue-ratio",
  "s-glue-attack",
  "s-glue-release",
  "s-glue-makeup",
  "s-glue-pdr",
  "s-glue-pdr-hold",
  "s-hp",
  "s-air",
  "s-shelf-freq",
  "s-lowshelf",
  "s-lowshelf-freq",
  "s-comp-pdr",
  "s-comp-pdr-hold",
  "s-mb-pdr",
  "s-mb-pdr-hold",
  "s-mscomp-pdr",
  "s-mscomp-pdr-hold",
  "s-mb-sw-lowx",
  "s-mb-sw-highx",
  "s-mb-sw-low",
  "s-mb-sw-mid",
  "s-mb-sw-high",
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
  "s-tatt",
  "s-tsus",
  "s-satdrive",
  "s-satmode",
  "s-satmix",
  "s-mgain",
  "s-sgain",
  "s-width",
  "s-enhancer",
  "s-haas",
  "s-bassmono",
  "s-rsize",
  "s-rwet",
  "s-ceiling",
  "s-lrelease",
  "s-format",
  "s-mb-lowx",
  "s-mb-highx",
  "s-mb-low-th",
  "s-mb-low-ratio",
  "s-mb-low-att",
  "s-mb-low-rel",
  "s-mb-low-mu",
  "s-mb-mid-th",
  "s-mb-mid-ratio",
  "s-mb-mid-att",
  "s-mb-mid-rel",
  "s-mb-mid-mu",
  "s-mb-high-th",
  "s-mb-high-ratio",
  "s-mb-high-att",
  "s-mb-high-rel",
  "s-mb-high-mu",
  "mb-bypass",
  "s-dyneq-bypass",
  "s-dyneq-freq",
  "s-dyneq-q",
  "s-dyneq-thresh",
  "s-dyneq-ratio",
  "s-dyneq-attack",
  "s-dyneq-release",
  "s-dyneq-maxred",
  "s-reso-bypass",
  "s-reso-freq",
  "s-reso-q",
  "s-reso-thresh",
  "s-reso-ratio",
  "s-reso-attack",
  "s-reso-release",
  "s-reso-maxred",
  "s-mono-freq",
  "s-mono-amount",
  "s-eq-mode",
  "s-lp-taps",
  "s-tonalbal-bypass",
  "s-tonalbal-amount",
  "s-tonalbal-boost",
  "s-tonalbal-cut",
  "s-tonalbal-bands",
  "parallelBypass",
  "parallelMix",
  "parallelThresh",
  "parallelRatio",
  "parallelAttack",
  "parallelRelease",
  "mb-stereo-bypass",
  "s-clip-bypass",
  "s-clip-mode",
  "s-clip-ceiling",
  "s-clip-drive",
  "s-lp-bypass",
  "s-lp-cutoff",
  "s-mseq-bypass",
  "s-mseq-mid-freq",
  "s-mseq-side-freq",
  "s-mscomp-bypass",
  "s-nr-bypass",
  "s-nr-strength",
  "s-nr-noise-sample-sec",
];