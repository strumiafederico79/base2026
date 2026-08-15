// ============================================================
// 10-meters-dashboard.js — Dashboard, medidores en vivo, multiband GR/VU, espectrómetro
// ============================================================

// Asegurar que cachedEl esté disponible (puede venir de 09)
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

// ── Enlazar eventos de preview ──────────────────────────────
previewTriggerIds.forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(evt, schedulePreview);
});

// ── Dashboard ─────────────────────────────────────────────────
let dashboardWS = null,
  dashboardPollTimer = null;

function renderDashboard(stats) {
  cachedEl("dashCpu").textContent = stats.cpu_percent.toFixed(1) + "%";
  cachedEl("dashCpuBar").style.width = Math.min(100, stats.cpu_percent) + "%";
  cachedEl("dashRam").textContent = stats.ram_percent.toFixed(1) + "%";
  cachedEl("dashRamBar").style.width = Math.min(100, stats.ram_percent) + "%";
  cachedEl("dashQueueTotal").textContent = stats.queue.total;
  cachedEl("dashQueued").textContent = `en cola: ${stats.queue.queued}`;
  cachedEl("dashProcessing").textContent = `procesando: ${stats.queue.processing}`;
  if (stats.active_job) {
    const eta = stats.active_job.eta_sec;
    cachedEl("dashEta").textContent = eta != null ? `~${eta}s restante` : "Procesando…";
    cachedEl("dashActiveFile").textContent = stats.active_job.filename || "";
  } else {
    cachedEl("dashEta").textContent = "Inactivo";
    cachedEl("dashActiveFile").textContent = "";
  }
}

function startDashboardPolling() {
  stopDashboard();
  dashboardPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API()}/dashboard`);
      if (!res.ok) return;
      renderDashboard(await res.json());
    } catch (e) {}
  }, 5000);
}

function stopDashboard() {
  if (dashboardWS) {
    try {
      dashboardWS.close();
    } catch (e) {}
    dashboardWS = null;
  }
  if (dashboardPollTimer) {
    clearInterval(dashboardPollTimer);
    dashboardPollTimer = null;
  }
}

function startDashboard() {
  stopDashboard();
  let wsUrl;
  try {
    const apiUrl = new URL(API());
    wsUrl = `${apiUrl.protocol === "https:" ? "wss" : "ws"}://${apiUrl.host}/ws/dashboard`;
  } catch (e) {
    startDashboardPolling();
    return;
  }
  try {
    dashboardWS = new WebSocket(wsUrl);
    dashboardWS.onmessage = (ev) => {
      try {
        renderDashboard(JSON.parse(ev.data));
      } catch (e) {}
    };
    dashboardWS.onerror = () => {
      stopDashboard();
      startDashboardPolling();
    };
    dashboardWS.onclose = () => {
      if (!dashboardPollTimer) startDashboardPolling();
    };
  } catch (e) {
    startDashboardPolling();
  }
}

cachedEl("dashToggle").addEventListener("click", () => {
  const body = cachedEl("dashboardBody");
  const hidden = body.style.display === "none";
  body.style.display = hidden ? "block" : "none";
  cachedEl("dashToggle").textContent = hidden ? "ocultar" : "mostrar";
});
startDashboard();
cachedEl("apiUrl").addEventListener("change", startDashboard);

// ── Live Meters ──────────────────────────────────────────────
function dbFromLinear(v) {
  return v > 1e-9 ? 20 * Math.log10(v) : -100;
}

function setupLiveMeters(audioBuffer) {
  teardownLiveMeters();
  cachedEl("metersWrap").style.display = "block";
  metersAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = metersAudioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.loop = true;
  metersSplitter = metersAudioCtx.createChannelSplitter(2);
  metersAnalyserL = metersAudioCtx.createAnalyser();
  metersAnalyserR = metersAudioCtx.createAnalyser();
  metersAnalyserL.fftSize = 2048;
  metersAnalyserR.fftSize = 2048;
  metersAnalyserL.minDecibels = -85;
  metersAnalyserL.maxDecibels = -5;
  metersAnalyserR.minDecibels = -85;
  metersAnalyserR.maxDecibels = -5;
  metersAnalyserL.smoothingTimeConstant = 0.7;
  metersAnalyserR.smoothingTimeConstant = 0.7;
  const gain = metersAudioCtx.createGain();
  gain.gain.value = 0;
  src.connect(metersSplitter);
  metersSplitter.connect(metersAnalyserL, 0);
  if (audioBuffer.numberOfChannels > 1) metersSplitter.connect(metersAnalyserR, 1);
  else metersSplitter.connect(metersAnalyserR, 0);
  metersAnalyserL.connect(gain);
  gain.connect(metersAudioCtx.destination);
  try {
    if (metersAudioCtx.state === "suspended") {
      metersAudioCtx.resume().catch(() => {});
    }
  } catch (e) {}
  try {
    src.start(0);
  } catch (e) {}
  metersSourceNode = src;
  metersLufsRingBuffer = [];
  const bufL = new Float32Array(metersAnalyserL.fftSize);
  const bufR = new Float32Array(metersAnalyserR.fftSize);
  const freqDataL = new Uint8Array(metersAnalyserL.frequencyBinCount);
  const freqDataR = new Uint8Array(metersAnalyserR.frequencyBinCount);
  const spectrumCanvas = document.getElementById("liveSpectrumCanvas");
  function tick() {
    metersAnalyserL.getFloatTimeDomainData(bufL);
    metersAnalyserR.getFloatTimeDomainData(bufR);
    let peak = 0,
      sumSq = 0,
      sumLR = 0,
      sumL2 = 0,
      sumR2 = 0;
    let truePeak = 0;
    for (let i = 0; i < bufL.length; i++) {
      const l = bufL[i],
        r = bufR[i];
      const mono = (l + r) / 2;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      sumSq += mono * mono;
      sumLR += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
      if (i > 0) {
        const lPrev = bufL[i - 1], rPrev = bufR[i - 1];
        const lMid = (lPrev + l) / 2, rMid = (rPrev + r) / 2;
        truePeak = Math.max(truePeak, Math.abs(lMid), Math.abs(rMid));
      }
      truePeak = Math.max(truePeak, Math.abs(l), Math.abs(r));
    }
    const rms = Math.sqrt(sumSq / bufL.length);
    const peakDb = dbFromLinear(peak),
      rmsDb = dbFromLinear(rms);
    const truePeakDb = dbFromLinear(truePeak);
    const rmsL = Math.sqrt(sumL2 / bufL.length);
    const rmsR = Math.sqrt(sumR2 / bufR.length);
    const lufsLin = (rmsL * rmsL + rmsR * rmsR) / 2;
    const pseudoLufs = (lufsLin > 1e-9 ? 10 * Math.log10(lufsLin) : -100) - 0.691;
    metersLufsRingBuffer.push(pseudoLufs);
    if (metersLufsRingBuffer.length > METERS_LUFS_WINDOW) metersLufsRingBuffer.shift();
    const avgLufs = metersLufsRingBuffer.reduce((a, b) => a + b, 0) / metersLufsRingBuffer.length;
    const denom = Math.sqrt(sumL2 * sumR2);
    const corr = denom > 1e-9 ? sumLR / denom : 1.0;
    updateMeterFill("meterPeakFill", "meterPeakReadout", peakDb, (v) => v.toFixed(1) + " dB");
    updateMeterFill("meterRmsFill", "meterRmsReadout", rmsDb, (v) => v.toFixed(1) + " dB");
    updateMeterFill("meterLufsFill", "meterLufsReadout", avgLufs, (v) => v.toFixed(1) + " LUFS", -40);
    updateMeterFill("meterTruePeakFill", "meterTruePeakReadout", truePeakDb, (v) => v.toFixed(1) + " dBTP", -40);
    updateStereoMeter(corr);
    metersAnalyserL.getByteFrequencyData(freqDataL);
    metersAnalyserR.getByteFrequencyData(freqDataR);
    drawLiveSpectrum(
      spectrumCanvas,
      freqDataL,
      freqDataR,
      metersAudioCtx.sampleRate,
      metersAnalyserL.minDecibels,
      metersAnalyserL.maxDecibels,
    );
    updateFreqBands(
      freqDataL,
      freqDataR,
      metersAudioCtx.sampleRate,
      metersAnalyserL.minDecibels,
      metersAnalyserL.maxDecibels,
    );
    setTimeout(() => { metersRafId = requestAnimationFrame(tick); }, 42);
  }
  tick();
}

// (cachedEl ya está definido globalmente por 09-visualizers.js, con fallback
// arriba en este mismo archivo por si ese script no cargó. Antes había una
// SEGUNDA definición acá — `function cachedEl(id) {...}` con su propio
// `const _elCache` — que por hoisting de function-declarations pisaba el
// chequeo `typeof cachedEl === 'undefined'` de arriba (ese chequeo daba
// SIEMPRE false porque cachedEl ya "existía" por el hoisting), y si algo
// llamaba a cachedEl() antes de que la ejecución llegara físicamente a la
// línea del `const _elCache`, reventaba con
// "Cannot access '_elCache' before initialization". Se borra: la del tope
// del archivo alcanza.)

function updateMeterFill(fillId, readoutId, db, fmt, minDb = -60, maxDb = 0) {
  const range = maxDb - minDb;
  const pct = Math.max(0, Math.min(100, ((db - minDb) / range) * 100));
  const fillEl = cachedEl(fillId);
  const readEl = cachedEl(readoutId);
  if (!fillEl) return;
  fillEl.style.height = pct + "%";
  if (readEl) readEl.textContent = db <= -99 ? "-∞" : fmt(db);
  const warn = maxDb - 6, danger = maxDb - 1;
  if (db >= danger) {
    fillEl.style.background = "var(--vu-red, #e05539)";
  } else if (db >= warn) {
    fillEl.style.background = "var(--vu-yellow, #e8d220)";
  } else {
    fillEl.style.background = "var(--vu-green, #39e05a)";
  }
}

function updateMainMetersFromMetrics(metrics) {
  if (!metrics) return;
  cachedEl("metersWrap").style.display = "block";
  if (metrics.peak_db != null)
    updateMeterFill("meterPeakFill", "meterPeakReadout", metrics.peak_db, (v) => v.toFixed(1) + " dB");
  if (metrics.rms_db != null)
    updateMeterFill("meterRmsFill", "meterRmsReadout", metrics.rms_db, (v) => v.toFixed(1) + " dB");
  if (metrics.lufs_momentary != null)
    updateMeterFill("meterLufsFill", "meterLufsReadout", metrics.lufs_momentary, (v) => v.toFixed(1) + " LUFS", -40);
  if (metrics.true_peak_db != null)
    updateMeterFill("meterTruePeakFill", "meterTruePeakReadout", metrics.true_peak_db, (v) => formatDbValue(v), -40);
  if (metrics.stereo_correlation != null) updateStereoMeter(metrics.stereo_correlation);
  if (metrics.mono_compatibility_db != null) {
    const monoEl = cachedEl("monoCompatReadout");
    if (monoEl) monoEl.textContent = `mono: ${metrics.mono_compatibility_db.toFixed(2)} dB`;
  }
  renderChainMeters({
    mb: metrics.mb_meters || {},
    comp: metrics.comp_meters || {},
    glue: metrics.glue_meters || { bypass: true },
    dyneq: metrics.dyneq_meters || { bypass: true },
    reso: metrics.reso_meters || { bypass: true },
    ms_comp: metrics.ms_comp_meters || { bypass: true, mid: {}, side: {} },
    pre_limiter: metrics.pre_limiter || {},
    post_limiter: metrics.post_limiter || {
      rms_db: metrics.rms_db,
      peak_db: metrics.peak_db,
      lufs: metrics.lufs_momentary,
      stereo_correlation: metrics.stereo_correlation,
    },
  });
}

function updateStereoMeter(corr) {
  const c = Math.max(-1, Math.min(1, corr));
  const pct = ((c + 1) / 2) * 100;
  const fill = cachedEl("stereoMeterFill");
  if (!fill) return;
  if (c >= 0) {
    fill.style.left = "50%";
    fill.style.width = pct - 50 + "%";
  } else {
    fill.style.left = pct + "%";
    fill.style.width = 50 - pct + "%";
  }
  const read = cachedEl("stereoMeterReadout");
  if (read)
    read.textContent = `corr: ${c.toFixed(2)} (${c > 0.8 ? "mono-ish" : c < -0.2 ? "fuera de fase" : "estéreo"})`;
}

// ── Multiband GR & VU Meters ─────────────────────────────────
function renderChainMeters(chainMeters) {
  if (!chainMeters) return;
  const mb = chainMeters.mb || {};
  const comp = chainMeters.comp || {};
  const parallel = chainMeters.parallel || {};
  const glue = chainMeters.glue || {};
  const dyneq = chainMeters.dyneq || {};
  const reso = chainMeters.reso || {};
  const ms_comp = chainMeters.ms_comp || {};
  const pre = chainMeters.pre_limiter || {};
  const post = chainMeters.post_limiter || {};

  const sect = document.getElementById("mbGrSection");
  if (sect) sect.style.display = "block";

  function updateGrBar(barId, readId, grDb, bypassText) {
    const el = document.getElementById(barId);
    const rd = document.getElementById(readId);
    if (bypassText != null) {
      if (el) el.style.width = "0%";
      if (rd) rd.textContent = bypassText;
      return;
    }
    const pct = Math.max(0, Math.min(100, (-grDb / 24) * 100));
    if (el) el.style.width = pct + "%";
    if (rd) rd.textContent = (grDb <= 0 ? "" : "+") + grDb.toFixed(1) + " dB";
  }
  updateGrBar("grBarLow", "grReadLow", mb.low_gr_db ?? 0);
  updateGrBar("grBarMid", "grReadMid", mb.mid_gr_db ?? 0);
  updateGrBar("grBarHigh", "grReadHigh", mb.high_gr_db ?? 0);
  updateGrBar("grBarComp", "grReadComp", comp.gr_db ?? 0);

  if (glue.bypass === false) {
    updateGrBar("grBarGlue", "grReadGlue", glue.gr_db ?? 0);
  } else {
    updateGrBar("grBarGlue", "grReadGlue", 0, "bypass");
  }

  if (parallel.bypass === false) {
    updateGrBar("grBarParallel", "grReadParallel", parallel.gr_db ?? 0);
  } else {
    updateGrBar("grBarParallel", "grReadParallel", 0, "bypass");
  }

  const dyneqBypassEl = document.getElementById("s-dyneq-bypass");
  const dyneqBypassed = dyneq.bypass ?? (dyneqBypassEl ? !dyneqBypassEl.checked : false);
  if (dyneqBypassed) {
    updateGrBar("grBarDeess", "grReadDeess", 0, "bypass");
  } else {
    updateGrBar("grBarDeess", "grReadDeess", dyneq.gr_db ?? 0);
  }

  const resoBypassEl = document.getElementById("s-reso-bypass");
  const resoBypassed = reso.bypass ?? (resoBypassEl ? !resoBypassEl.checked : false);
  if (resoBypassed) {
    updateGrBar("grBarReso", "grReadReso", 0, "bypass");
  } else {
    updateGrBar("grBarReso", "grReadReso", reso.gr_db ?? 0);
  }

  if (ms_comp.bypass !== false) {
    updateGrBar("grBarMsCompMid", "grReadMsCompMid", 0, "bypass");
    updateGrBar("grBarMsCompSide", "grReadMsCompSide", 0, "bypass");
  } else {
    updateGrBar("grBarMsCompMid", "grReadMsCompMid", ms_comp.mid?.gr_db ?? 0);
    updateGrBar("grBarMsCompSide", "grReadMsCompSide", ms_comp.side?.gr_db ?? 0);
  }

  function fmt(v) {
    return v != null ? v.toFixed(1) + " dB" : "--";
  }
  function fmtL(v) {
    return v != null ? v.toFixed(1) + " LUFS" : "--";
  }

  const e = (id) => document.getElementById(id);
  if (e("vuPreRms")) e("vuPreRms").textContent = fmt(pre.rms_db);
  if (e("vuPrePeak")) e("vuPrePeak").textContent = fmt(pre.peak_db);
  if (e("vuPostRms")) e("vuPostRms").textContent = fmt(post.rms_db);
  if (e("vuPostPeak")) e("vuPostPeak").textContent = fmt(post.peak_db);
  if (e("vuPostLufs")) e("vuPostLufs").textContent = fmtL(post.lufs);
}

// ── Espectrómetro en tiempo real ─────────────────────────────
let _specXCache = null;
const PREVIEW_SPECTRUM_MODE = 'third-octave';

function computeThirdOctaveBands(dataL, dataR, sampleRate, minDb, maxDb) {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / dataL.length;
  const DB_MIN = minDb, DB_MAX = maxDb;
  const bands = [];
  for (let f = 25; f < nyquist; f *= Math.pow(2, 1 / 3)) {
    bands.push(f);
    if (bands.length > 60) break;
  }
  const vals = new Float32Array(bands.length);
  for (let b = 0; b < bands.length; b++) {
    const fc = bands[b];
    const fl = fc / Math.pow(2, 1 / 6);
    const fh = fc * Math.pow(2, 1 / 6);
    const iStart = Math.max(1, Math.floor(fl / binHz));
    const iEnd = Math.min(dataL.length - 1, Math.ceil(fh / binHz));
    if (iEnd < iStart) {
      vals[b] = DB_MIN;
      continue;
    }
    let sumPow = 0;
    for (let i = iStart; i <= iEnd; i++) {
      const byte = (dataL[i] + dataR[i]) / 2;
      const db = DB_MIN + (byte / 255) * (DB_MAX - DB_MIN);
      sumPow += Math.pow(10, db / 10);
    }
    const avgPow = sumPow / (iEnd - iStart + 1);
    vals[b] = 10 * Math.log10(avgPow + 1e-12);
  }
  return { freqs: bands, values: vals };
}

function drawLiveSpectrum(canvas, dataL, dataR, sampleRate, minDb = -85, maxDb = -5) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 280,
    cssHeight = canvas.clientHeight || 180;
  if (canvas._lastCssW !== cssWidth || canvas._lastDpr !== dpr) {
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas._lastCssW = cssWidth;
    canvas._lastDpr = dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = themeColors();
  ctx.fillStyle = theme.surface2;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const nyquist = sampleRate / 2;
  const binHz = nyquist / dataL.length;
  const fMin = 30,
    fMax = Math.min(20000, nyquist);
  const padL = 32,
    padB = 15,
    padT = 6,
    padR = 6;
  const plotW = cssWidth - padL - padR,
    plotH = cssHeight - padT - padB;

  if (
    !_specXCache ||
    _specXCache.width !== cssWidth ||
    _specXCache.binHz !== binHz ||
    _specXCache.len !== dataL.length
  ) {
    const startBin = Math.max(1, Math.floor(fMin / binHz));
    const xs = new Float32Array(dataL.length);
    const logMin = Math.log10(fMin),
      logRange = Math.log10(fMax) - logMin;
    for (let i = startBin; i < dataL.length; i++) {
      const freq = i * binHz;
      xs[i] = freq > fMax ? -1 : padL + ((Math.log10(freq) - logMin) / logRange) * plotW;
    }
    _specXCache = { width: cssWidth, binHz, len: dataL.length, startBin, xs };
  }
  const { startBin, xs } = _specXCache;

  ctx.strokeStyle = theme.border;
  ctx.fillStyle = theme.muted;
  ctx.font = "9px monospace";
  ctx.lineWidth = 1;
  [100, 1000, 10000].forEach((f) => {
    if (f < fMin || f > fMax) return;
    const x = padL + ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(f >= 1000 ? f / 1000 + "k" : String(f), x - 8, cssHeight - 3);
  });

  if (PREVIEW_SPECTRUM_MODE === 'third-octave') {
    const bands = computeThirdOctaveBands(dataL, dataR, sampleRate, metersAnalyserL?.minDecibels ?? -85, metersAnalyserL?.maxDecibels ?? -5);
    const N = bands.freqs.length;
    const barW = plotW / N;
    for (let i = 0; i < N; i++) {
      const db = bands.values[i];
      const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
      const x = padL + i * barW + 1;
      const y = padT + (1 - t) * plotH;
      const h = plotH - (y - padT);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, theme.get('--accent2'));
      g.addColorStop(1, theme.accent);
      ctx.fillStyle = g;
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 6;
      const rw = Math.max(1, barW - 3);
      const rh = Math.max(1, h);
      const rx = x;
      const ry = y;
      const r = Math.min(6, rw * 0.25, rh * 0.25);
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.lineTo(rx + rw - r, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
      ctx.lineTo(rx + rw, ry + rh - r);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
      ctx.lineTo(rx + r, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
      ctx.lineTo(rx, ry + r);
      ctx.quadraticCurveTo(rx, ry, rx + r, ry);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else {
    ctx.beginPath();
    let started = false,
      lastX = padL;
    for (let i = startBin; i < dataL.length; i++) {
      const x = xs[i];
      if (x < 0) break;
      const mag = (dataL[i] + dataR[i]) / 2 / 255;
      const y = padT + plotH - mag * plotH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
      lastX = x;
    }
    if (started) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineTo(lastX, padT + plotH);
      ctx.lineTo(padL, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = "rgba(124,92,252,0.16)";
      ctx.fill();
    }
  }
}

const FREQ_BANDS = [
  { id: "sub", lo: 20, hi: 60 },
  { id: "bass", lo: 60, hi: 250 },
  { id: "lowmid", lo: 250, hi: 800 },
  { id: "mid", lo: 800, hi: 3000 },
  { id: "highmid", lo: 3000, hi: 8000 },
  { id: "air", lo: 8000, hi: 20000 },
];

function updateFreqBands(dataL, dataR, sampleRate, minDb, maxDb) {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / dataL.length;
  const range = maxDb - minDb;
  FREQ_BANDS.forEach((band) => {
    const iStart = Math.max(1, Math.round(band.lo / binHz));
    const iEnd = Math.min(dataL.length - 1, Math.round(Math.min(band.hi, nyquist) / binHz));
    let avgDb = minDb;
    if (iEnd > iStart) {
      let sumPow = 0;
      for (let i = iStart; i <= iEnd; i++) {
        const bAvg = (dataL[i] + dataR[i]) / 2;
        const db = minDb + (bAvg / 255) * range;
        sumPow += Math.pow(10, db / 10);
      }
      avgDb = 10 * Math.log10(sumPow / (iEnd - iStart + 1) + 1e-12);
    }
    const pct = Math.max(0, Math.min(100, ((avgDb - minDb) / range) * 100));
    cachedEl("fb-" + band.id).style.width = pct + "%";
    cachedEl("fbv-" + band.id).textContent = avgDb <= minDb + 0.5 ? "-∞" : Math.round(avgDb) + "dB";
  });
}

function teardownLiveMeters() {
  if (metersRafId) {
    cancelAnimationFrame(metersRafId);
    metersRafId = null;
  }
  if (metersSourceNode) {
    try {
      metersSourceNode.stop();
    } catch (e) {}
    metersSourceNode = null;
  }
  if (metersAudioCtx) {
    try {
      metersAudioCtx.close();
    } catch (e) {}
    metersAudioCtx = null;
  }
}

// ── Espectro del reproductor de preview (audio element) ─────
let previewAudioCtx = null;
let previewSourceNode = null;
let previewSplitter = null;
let previewAnalyserL = null;
let previewAnalyserR = null;
let previewFreqDataL = null;
let previewFreqDataR = null;
let previewSpectrumRafId = null;

function stopPreviewSpectrum() {
  if (previewSpectrumRafId) {
    cancelAnimationFrame(previewSpectrumRafId);
    previewSpectrumRafId = null;
  }
  try {
    if (previewSourceNode) previewSourceNode.disconnect();
  } catch (e) {}
  try {
    if (previewAnalyserL) previewAnalyserL.disconnect();
  } catch (e) {}
  try {
    if (previewAnalyserR) previewAnalyserR.disconnect();
  } catch (e) {}
  try {
    if (previewSplitter) previewSplitter.disconnect();
  } catch (e) {}
  try {
    if (previewAudioCtx) previewAudioCtx.close();
  } catch (e) {}
  previewAudioCtx = null;
  previewSourceNode = null;
  previewSplitter = null;
  previewAnalyserL = null;
  previewAnalyserR = null;
  previewFreqDataL = null;
  previewFreqDataR = null;
}