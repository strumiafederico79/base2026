// ============================================================
// 08-reference-mastering.js — Master con referencia, bandas EQ dinámicas, preview en vivo, análisis
// ============================================================

// ── Spinner reutiliza el mismo CSS que en 07 ────────────────
// (ya inyectado al inicio de 07, así que no hace falta repetir)

// ── MASTER CON REFERENCIA ────────────────────────────────────
function collectReferenceParamsObj() {
  return {
    eq_max_boost_db: document.getElementById("s-ref-eq").checked
      ? document.getElementById("s-ref-boost").value
      : "0",
    eq_max_cut_db: document.getElementById("s-ref-eq").checked ? document.getElementById("s-ref-cut").value : "0",
    eq_fit_method: document.getElementById("s-ref-eqmethod").value,
    match_loudness: document.getElementById("s-ref-loudness").checked,
    match_dynamics: document.getElementById("s-ref-dynamics").checked,
    match_stereo_width: document.getElementById("s-ref-stereo").checked,
    match_transient: document.getElementById("s-ref-transient").checked,
    match_sub_bass: document.getElementById("s-ref-subbass").checked,
    match_desser: document.getElementById("s-ref-desser").checked,
    match_saturation: document.getElementById("s-ref-saturation").checked,
    output_format: document.getElementById("s-format").value,
    output_bit_depth: document.getElementById("s-bitdepth").value,
    dither_mode: document.getElementById("s-dither-mode").value,
    dynamics_margin_db: document.getElementById("s-ref-dynmargin").value,
    stereo_blend: (parseFloat(document.getElementById("s-ref-stereoblend").value) / 100).toFixed(2),
    band_gains_array: window.refBandEQ ? window.refBandEQ.getGainsArray() : [],
    ms_eq_matching: document.getElementById("s-ref-ms-eq") ? document.getElementById("s-ref-ms-eq").checked : true,
    adaptive_loudness_weighting: document.getElementById("s-ref-adaptive-loudness")?.checked ?? true,
    loudness_sensitivity_amount: ((parseFloat(document.getElementById("s-ref-loudness-sensitivity")?.value || "65") / 100)).toFixed(2),
    premium_match_profile: document.getElementById("s-ref-premium-profile")?.value || "balanced",
    premium_vocal_protect: document.getElementById("s-ref-vocal-protect")?.checked ?? true,
    premium_translation_check: document.getElementById("s-ref-translation-check")?.checked ?? true,
    premium_alt_versions: document.getElementById("s-ref-alt-versions")?.checked ?? false,
    iterative_eq_passes: parseInt(document.getElementById("s-ref-eq-passes")?.value || "3"),
    match_crest: document.getElementById("s-ref-match-crest")?.checked ?? true,
    crest_amount: (parseFloat(document.getElementById("s-ref-crest-amount")?.value || "75") / 100).toFixed(2),
    match_spectral_dynamics: document.getElementById("s-ref-spectral-dynamics")?.checked ?? true,
    spectral_dynamics_amount: (parseFloat(document.getElementById("s-ref-spectral-dyn-amount")?.value || "60") / 100).toFixed(2),
    spectral_dynamics_bins: parseInt(document.getElementById("s-ref-spectral-dyn-bins")?.value || "4"),
    ...(document.getElementById("s-ref-fixed-lufs")?.checked
      ? { loudness_target_lufs: parseFloat(document.getElementById("s-ref-fixed-lufs-value")?.value || "-14") }
      : {}),
    use_parallel_compression: document.getElementById("s-ref-parallel-comp")?.checked ?? true,
    parallel_mix: (parseFloat(document.getElementById("s-ref-parallel-mix")?.value || "28") / 100).toFixed(2),
    parallel_threshold_db: parseFloat(document.getElementById("s-ref-parallel-thr")?.value || "-20"),
    parallel_ratio: parseFloat(document.getElementById("s-ref-parallel-ratio")?.value || "4"),
    parallel_makeup_db: parseFloat(document.getElementById("s-ref-parallel-makeup")?.value || "6"),
    use_multiband_saturation: document.getElementById("s-ref-mb-sat")?.checked ?? true,
    mb_sat_mix: (parseFloat(document.getElementById("s-ref-mb-sat-mix")?.value || "45") / 100).toFixed(2),
    mb_sat_low_drive: (parseFloat(document.getElementById("s-ref-mb-sat-low")?.value || "7") / 100).toFixed(3),
    mb_sat_mid_drive: (parseFloat(document.getElementById("s-ref-mb-sat-mid")?.value || "4") / 100).toFixed(3),
    mb_sat_high_drive: (parseFloat(document.getElementById("s-ref-mb-sat-high")?.value || "2") / 100).toFixed(3),
    mb_sat_mode: document.getElementById("s-ref-mb-sat-mode")?.value || "tape",
    use_two_stage_limiter: document.getElementById("s-ref-two-stage-lim")?.checked ?? true,
    gentle_ceiling_db: parseFloat(document.getElementById("s-ref-gentle-ceil")?.value || "-2.5"),
    gentle_release_ms: parseFloat(document.getElementById("s-ref-gentle-rel")?.value || "120"),
    max_target_lufs: parseFloat(document.getElementById("s-ref-max-lufs")?.value || "-12"),
  };
}
const REF_PARAM_LABELS = { /* ... igual que antes ... */ };

async function submitReferenceMasterJob() {
  clearResults();
  showStatus(null, "Enviando archivos…", "queued");
  document.getElementById("btnMasterRef").disabled = true;

  const fd = new FormData();
  if (_previewLibraryId) {
    fd.append("library_id", _previewLibraryId);
  } else {
    fd.append("file", selectedFile);
  }
  if (selectedRefLibraryId) {
    fd.append("reference_library_id", selectedRefLibraryId);
  } else {
    fd.append("reference_file", selectedRefFile);
  }

  const _refParamsObj = collectReferenceParamsObj();
  if (_refParamsObj.band_gains_array) {
    _refParamsObj.band_gains_array = JSON.stringify(_refParamsObj.band_gains_array);
  }
  const params = new URLSearchParams(_refParamsObj);

  try {
    const url = `${API()}/master/reference?${params.toString()}`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    currentJobId = data.job_id;
    showStatus(null, `Job ${currentJobId.slice(0, 8)}… en cola (matching por referencia)`, "queued");
    startReferencePolling(currentJobId);
  } catch (e) {
    console.error("❌ Error al enviar (referencia):", e);
    showStatus(null, "Error: " + e.message, "error");
    document.getElementById("btnMasterRef").disabled = false;
  }
}

// ── refBandEQ (sin cambios) ──────────────────────────────────
window.refBandEQ = (function() {
  const CONTAINER   = document.getElementById("ref-band-controls");
  const COUNT_SLIDER = document.getElementById("s-band-count");
  const COUNT_VAL    = document.getElementById("v-band-count");
  const RESET_BTN    = document.getElementById("btn-band-reset");
  const MIN_HZ = 20, MAX_HZ = 20000;
  let _bands = [];

  function _logFreqs(n) {
    return Array.from({length: n}, (_, i) =>
      MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (n - 1))
    );
  }

  function _interpolate(oldBands, newFreqs) {
    if (!oldBands.length) return newFreqs.map(() => 0);
    return newFreqs.map(f => {
      const logF = Math.log10(f);
      const logFs = oldBands.map(b => Math.log10(b.freq_hz));
      if (logF <= logFs[0])  return oldBands[0].gain_db;
      if (logF >= logFs[logFs.length-1]) return oldBands[logFs.length-1].gain_db;
      for (let i = 0; i < logFs.length - 1; i++) {
        if (logF >= logFs[i] && logF <= logFs[i+1]) {
          const t = (logF - logFs[i]) / (logFs[i+1] - logFs[i]);
          return oldBands[i].gain_db * (1-t) + oldBands[i+1].gain_db * t;
        }
      }
      return 0;
    });
  }

  function _fmtHz(hz) {
    if (hz >= 1000) return (hz/1000).toFixed(hz >= 10000 ? 0 : 1) + " kHz";
    return Math.round(hz) + " Hz";
  }

  function _render(n, interpolatedGains) {
    const freqs = _logFreqs(n);
    CONTAINER.innerHTML = "";
    _bands = [];

    freqs.forEach((freq, i) => {
      const gain = interpolatedGains ? Math.round(interpolatedGains[i] * 2) / 2 : 0;
      _bands.push({ freq_hz: freq, gain_db: gain });

      const div = document.createElement("div");
      div.className = "param";
      div.style.marginBottom = n > 14 ? "0.05rem" : "0.1rem";

      const valId  = "dyn-band-val-"  + i;
      const slId   = "dyn-band-sl-"   + i;
      const gainStr = (gain >= 0 ? "+" : "") + gain.toFixed(1) + " dB";

      div.innerHTML = `
        <label style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">
          ${_fmtHz(freq)}
        </label>
        <span class="val" id="${valId}" style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">${gainStr}</span>
        <input type="range" id="${slId}" min="-12" max="12" step="0.5" value="${gain}"
          style="${n > 14 ? 'height:3px;' : ''}" />
      `;
      CONTAINER.appendChild(div);

      const sl  = div.querySelector("input");
      const val = div.querySelector("span.val");
      sl.addEventListener("input", () => {
        const v = parseFloat(sl.value);
        _bands[i].gain_db = v;
        val.textContent = (v >= 0 ? "+" : "") + v.toFixed(1) + " dB";
        CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
      });
    });
  }

  function setBandCount(n, skipInterp) {
    const newFreqs = _logFreqs(n);
    const gains = skipInterp ? null : _interpolate(_bands, newFreqs);
    _render(n, gains);
    COUNT_VAL.textContent = n;
  }

  setBandCount(7, true);

  COUNT_SLIDER.addEventListener("input", () => {
    const n = parseInt(COUNT_SLIDER.value);
    setBandCount(n, false);
    CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
  });

  RESET_BTN.addEventListener("click", () => {
    const n = parseInt(COUNT_SLIDER.value);
    setBandCount(n, true);
    CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
  });

  return {
    getGainsArray() {
      return _bands.map(b => ({ freq_hz: Math.round(b.freq_hz * 10) / 10, gain_db: b.gain_db }));
    },
    getBandCount() {
      return _bands.length;
    }
  };
})();

// ── Preview en tiempo real con referencia (con spinners en estado) ──
(function() {
  let refWs = null;
  let refAudioCtx = null;
  let refSessionId = null;
  let refRefSessionId = null;
  let refSrcUploaded = false;
  let refRefUploaded = false;
  let debounceTimer = null;

  function updateRefPreviewBtn() {
    const ok = !!(selectedFile && selectedRefFile);
    const btn = document.getElementById("btnRefPreview");
    if (btn) btn.disabled = !ok;
  }

  const _origUpdateRefButtonState = window.updateRefButtonState;
  window.updateRefButtonState = function() {
    if (_origUpdateRefButtonState) _origUpdateRefButtonState();
    updateRefPreviewBtn();
  };

  function drawEqCurve(curve) {
    const wrap = document.getElementById("refEqCurveWrap");
    const canvas = document.getElementById("refEqCurveCanvas");
    if (!wrap || !canvas || !curve || !curve.length) return;
    wrap.style.display = "block";
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const ZERO_Y = H / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath(); ctx.moveTo(0, ZERO_Y); ctx.lineTo(W, ZERO_Y); ctx.stroke();
    const gains = curve.map(p => p.gain_db);
    const MAX_G = Math.max(6, ...gains.map(Math.abs));
    ctx.beginPath();
    ctx.strokeStyle = "var(--accent2, #06b6d4)";
    ctx.lineWidth = 1.5;
    curve.forEach((p, i) => {
      const x = (i / (curve.length - 1)) * W;
      const y = ZERO_Y - (p.gain_db / MAX_G) * (H * 0.42);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function updateMetrics(m) {
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set("rp-lufs", m.lufs_momentary != null ? m.lufs_momentary.toFixed(1) + " LUFS" : "--");
    set("rp-peak", m.peak_db != null ? m.peak_db.toFixed(1) + " dBFS" : "--");
    set("rp-rms",  m.rms_db  != null ? m.rms_db.toFixed(1) + " dB" : "--");
    set("rp-corr", m.stereo_correlation != null ? m.stereo_correlation.toFixed(2) : "--");
  }

  function initAudioCtx() {
    if (!refAudioCtx || refAudioCtx.state === "closed") {
      refAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (refAudioCtx.state === "suspended") refAudioCtx.resume();
    return refAudioCtx;
  }

  let _playTime = 0;
  let _refPreviewActive = false;
  const _INITIAL_BUFFER_SEC = 0.30;
  const _MIN_AHEAD_SEC = 0.15;

  function scheduleChunk(pcmBytes, sr, channels) {
    if (!_refPreviewActive) return;
    const actx = initAudioCtx();
    const i16 = new Int16Array(pcmBytes);
    const samples = i16.length / channels;
    const buf = actx.createBuffer(channels, samples, sr);
    for (let ch = 0; ch < channels; ch++) {
      const chData = buf.getChannelData(ch);
      for (let i = 0; i < samples; i++) chData[i] = i16[i * channels + ch] / 32767;
      const FADE = Math.min(Math.floor(sr * 0.010), Math.floor(samples / 4));
      for (let i = 0; i < FADE; i++) {
        chData[i] *= i / FADE;
        chData[samples - 1 - i] *= i / FADE;
      }
    }
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(actx.destination);
    const now = actx.currentTime;
    if (_playTime < now + _MIN_AHEAD_SEC) _playTime = now + _INITIAL_BUFFER_SEC;
    src.start(_playTime);
    _playTime += buf.duration;
  }

  function stopRefPreview() {
    _refPreviewActive = false;
    if (refWs) {
      try { refWs.close(); } catch(e) {}
      refWs = null;
    }
    if (refAudioCtx && refAudioCtx.state !== "closed") {
      try { refAudioCtx.close(); } catch(e) {}
      refAudioCtx = null;
    }
    _playTime = 0;
    const status = document.getElementById("rp-status");
    if (status) status.textContent = "";
  }

  async function launchRefPreview() {
    stopRefPreview();
    const panel = document.getElementById("refPreviewPanel");
    if (panel) panel.style.display = "block";
    if (!selectedFile || !selectedRefFile) return;
    if (!refSessionId) refSessionId = genUUID();
    if (!refRefSessionId) refRefSessionId = genUUID();

    const status = document.getElementById("rp-status");
    if (status) status.textContent = "Conectando…";

    const params = collectReferenceParamsObj();
    const band_gains_array = window.refBandEQ ? window.refBandEQ.getGainsArray() : [];

    const wsUrl = API().replace(/^http/, "ws") + "/ws/ref-stream";
    refWs = new WebSocket(wsUrl);
    refWs.binaryType = "arraybuffer";

    let wsChannels = 2, wsSr = 44100;
    let pendingMetrics = null;

    refWs.onopen = () => {
      refWs.send(JSON.stringify({
        session_id:       refSessionId,
        ref_session_id:   refRefSessionId,
        chunk_seconds:    1.0,
        eq_bands:         parseInt(params.eq_bands || 28),
        eq_max_boost_db:  parseFloat(params.eq_max_boost_db || 6),
        eq_max_cut_db:    parseFloat(params.eq_max_cut_db || -9),
        eq_q:             parseFloat(params.eq_q || 1.3),
        eq_match_blend:   parseFloat(params.eq_match_blend || 0.75),
        eq_fit_method:    params.eq_fit_method || "heuristic",
        ms_eq_matching:   params.ms_eq_matching !== false,
        iterative_eq_passes: parseInt(params.iterative_eq_passes || 3),
        band_gains_array,
        ...(window.selectedRefLibraryId ? { ref_library_id: window.selectedRefLibraryId } : {}),
      }));
    };

    refWs.onmessage = async (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        scheduleChunk(evt.data, wsSr, wsChannels);
        if (pendingMetrics) { updateMetrics(pendingMetrics); pendingMetrics = null; }
        return;
      }
      const msg = JSON.parse(evt.data);

      if (msg.event === "need_upload") {
        _refPreviewActive = true;
        if (status) status.textContent = "Subiendo track…";
        const buf = await selectedFile.arrayBuffer();
        refWs.send(buf);
        refWs.send(JSON.stringify({ event: "upload_complete" }));

      } else if (msg.event === "use_cache") {
        _refPreviewActive = true;
        refWs.send(JSON.stringify({ event: "params_only" }));

      } else if (msg.event === "need_upload_ref") {
        _refPreviewActive = true;
        if (status) status.textContent = "Subiendo referencia…";
        if (!selectedRefFile || typeof selectedRefFile.arrayBuffer !== "function") {
          if (status) status.textContent = "Error: referencia de biblioteca no disponible para preview.";
          refWs.close();
          return;
        }
        const buf = await selectedRefFile.arrayBuffer();
        refWs.send(buf);
        refWs.send(JSON.stringify({ event: "upload_complete" }));

      } else if (msg.event === "use_cache_ref") {
        _refPreviewActive = true;
        refWs.send(JSON.stringify({ event: "params_only" }));

      } else if (msg.event === "analyzing") {
        if (status) status.textContent = msg.message || "Analizando…";

      } else if (msg.event === "matching_ready") {
        if (status) status.textContent = "▶ Reproduciendo preview…";
        drawEqCurve(msg.eq_curve);

      } else if (msg.event === "chunk") {
        wsChannels = msg.channels || 2;
        wsSr       = msg.sample_rate || 44100;
        pendingMetrics = msg.metrics;

      } else if (msg.event === "done") {
        if (status) status.textContent = "✓ Preview completado";

      } else if (msg.event === "error") {
        if (status) status.textContent = "Error: " + msg.message;
      }
    };

    refWs.onerror = () => {
      if (status) status.textContent = "Error de conexión WebSocket.";
    };
    refWs.onclose = () => {
      if (status && status.textContent === "▶ Reproduciendo preview…")
        status.textContent = "";
    };
  }

  function debouncedPreview() {
    if (!refWs) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => launchRefPreview(), 120);
  }

  document.getElementById("ref-band-controls").addEventListener("bandchange", debouncedPreview);

  document.getElementById("btnRefPreview").addEventListener("click", () => {
    if (!refSrcUploaded)  refSessionId    = genUUID();
    if (!refRefUploaded)  refRefSessionId = genUUID();
    refSrcUploaded = refRefUploaded = true;
    launchRefPreview();
  });

  document.getElementById("btnRefPreviewStop").addEventListener("click", () => {
    stopRefPreview();
    const panel = document.getElementById("refPreviewPanel");
    if (panel) panel.style.display = "none";
  });

  window._onFileSelectedRef = () => {
    refSessionId = null;
    refSrcUploaded = false;
    updateRefPreviewBtn();
  };
  window._onRefFileSelectedRef = () => {
    refRefSessionId = null;
    refRefUploaded = false;
    updateRefPreviewBtn();
  };
})();

// ── Botón master con referencia ──────────────────────────────
document.getElementById("btnMasterRef").addEventListener("click", () => {
  if (!selectedFile || !selectedRefFile) {
    showStatus(null, "Seleccioná tu track y un track de referencia", "error");
    return;
  }
  clearResults();
  const paramsObj = collectReferenceParamsObj();
  const panel = document.createElement("div");
  panel.className = "params-preview";
  let html = `<h3>🔎 Parámetros corregidos — matching por referencia</h3><div class="pp-group"><div class="pp-grid">`;
  Object.entries(paramsObj).forEach(([k, v]) => {
    html += `<div class="pp-item"><span>${REF_PARAM_LABELS[k] || k}</span><span>${formatParamValue(v, k)}</span></div>`;
  });
  html += `</div></div><div class="pp-actions">
  <button class="btn btn-secondary" id="ppRefCancelBtn">✕ Cancelar</button>
  <button class="btn btn-primary" id="ppRefConfirmBtn">✅ Confirmar y masterizar</button>
</div>`;
  panel.innerHTML = html;
  getContent().prepend(panel);
  panel.querySelector("#ppRefConfirmBtn").addEventListener("click", () => {
    panel.remove();
    submitReferenceMasterJob();
  });
  panel.querySelector("#ppRefCancelBtn").addEventListener("click", () => panel.remove());
});

function startReferencePolling(jobId) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API()}/job/${jobId}`);
      const data = await res.json();
      if (data.status === "queued") {
        showStatus(null, "En cola…", "queued", data.progress, data.stage);
      } else if (data.status === "processing") {
        showStatus(null, "Masterizando por referencia…", "processing", data.progress, data.stage);
      } else if (data.status === "done") {
        clearInterval(pollInterval);
        showStatus(null, "Masterizado por referencia ✓", "done");
        document.getElementById("btnMasterRef").disabled = false;
        downloadUrl = `${API()}/download/${jobId}`;
        const btn = document.getElementById("btnDownload");
        btn.style.display = "block";
        const nameInput = document.getElementById("trackNameInput");
        nameInput.style.display = "block";
        prefillTrackNameFromFile();
        btn.onclick = () => window.open(downloadUrl + currentTrackNameParam(), "_blank");

        let _refAbBtn = document.getElementById("btnRefAB");
        if (!_refAbBtn) {
          _refAbBtn = document.createElement("button");
          _refAbBtn.id = "btnRefAB";
          _refAbBtn.className = "btn";
          _refAbBtn.style.cssText = "display:block;margin-top:0.4rem;background:var(--surface2,#1a1a2e);border:1px solid var(--accent2);color:var(--accent2);font-size:0.75rem";
          _refAbBtn.textContent = "⇄ A/B Original vs Master";
          btn.parentElement?.insertBefore(_refAbBtn, btn.nextSibling);
        }
        _refAbBtn.style.display = "block";
        _refAbBtn.onclick = async () => {
          _refAbBtn.disabled = true;
          _refAbBtn.textContent = "Cargando master…";
          try {
            const resp = await fetch(downloadUrl);
            if (!resp.ok) throw new Error("Error descargando master");
            const masterBlob = await resp.blob();
            if (typeof setupABPlayer === "function") {
              setupABPlayer(masterBlob);
              const wrap = document.getElementById("previewAudioWrap");
              if (wrap) {
                wrap.scrollIntoView({ behavior: "smooth", block: "center" });
              }
              _refAbBtn.textContent = "⇄ A/B activo (ver preview arriba)";
            } else {
              window.open(downloadUrl, "_blank");
              _refAbBtn.textContent = "⇄ A/B Original vs Master";
            }
          } catch (e) {
            _refAbBtn.textContent = "⇄ A/B Original vs Master";
            console.error("A/B error:", e);
          } finally {
            _refAbBtn.disabled = false;
          }
        };

        const rBtn = document.getElementById("btnReport");
        rBtn.style.display = "block";
        rBtn.onclick = () => downloadReport(jobId);
        if (data.analysis_before?.lufs != null)
          showLoudnessMeter(data.analysis_after?.lufs ?? data.analysis_before.lufs);
        if (data.reference_match) renderReferenceMatch(data.reference_match, data.analysis_reference, data.analysis_after);
        renderAnalysisComparison(data.analysis_before, data.analysis_after);
        if (data.analysis_reference?.fft_spectrum && data.analysis_after?.fft_spectrum) {
          renderFFT([
            { label: "Referencia", data: data.analysis_reference.fft_spectrum, color: "var(--accent2)" },
            { label: "Resultado", data: data.analysis_after.fft_spectrum, color: "var(--yellow)" },
          ]);
        }
        if (data.mix_advice_after) renderAdvicePanel(data.mix_advice_after, "Evaluación", "— Resultado");
        if (data.analysis_after) setAiContext({ ...data.analysis_after, mix_advice: data.mix_advice_after });
      } else if (data.status === "error") {
        clearInterval(pollInterval);
        showStatus(null, "Error: " + data.error, "error");
        document.getElementById("btnMasterRef").disabled = false;
      }
    } catch (e) {
      console.error("Poll error (referencia):", e);
    }
  }, 1500);
}

// ── Funciones auxiliares (match bar, análisis, etc.) ────────
function _matchBarRow(label, ownVal, refVal, unit, closeThresholdAbs, fmt) {
  fmt = fmt || ((v) => v);
  if (ownVal == null || refVal == null) return "";
  const diff = Math.abs(ownVal - refVal);
  const ok = diff <= closeThresholdAbs;
  const lo = Math.min(ownVal, refVal, 0) - Math.abs(refVal || 1) * 0.15;
  const hi = Math.max(ownVal, refVal, 0) + Math.abs(refVal || 1) * 0.15;
  const range = hi - lo || 1;
  const ownPct = Math.max(0, Math.min(100, ((ownVal - lo) / range) * 100));
  const refPct = Math.max(0, Math.min(100, ((refVal - lo) / range) * 100));
  return `
  <div class="match-bar-row">
    <div class="match-bar-label">${ok ? "✓" : "⚠"} ${label}</div>
    <div class="match-bar-track">
      <div class="match-bar-marker match-bar-ref" style="left:${refPct}%" title="Referencia: ${fmt(refVal)}${unit}"></div>
      <div class="match-bar-fill" style="width:${ownPct}%"></div>
    </div>
    <div class="match-bar-values">${fmt(ownVal)}${unit} <span style="opacity:.55">vs ref ${fmt(refVal)}${unit}</span></div>
  </div>`;
}

function renderReferenceAnalysisPanel(refAnalysis, ownAnalysis, rm) {
  if (!refAnalysis) return '';
  const spec = refAnalysis.spectrum || {};
  const ownSpec = (ownAnalysis || {}).spectrum || {};
  const SPEC_BANDS = [
    { key: 'sub_bass',    label: 'Sub-graves',  range: '20–80 Hz' },
    { key: 'bass',        label: 'Graves',       range: '80–250 Hz' },
    { key: 'low_mid',     label: 'Low-Mid',      range: '250–800 Hz' },
    { key: 'mid',         label: 'Medios',       range: '800–2.5k' },
    { key: 'high_mid',    label: 'High-Mid',     range: '2.5–6 kHz' },
    { key: 'presence',    label: 'Presencia',    range: '6–12 kHz' },
    { key: 'air',         label: 'Aire',         range: '12–20 kHz' },
  ];
  const refVals = SPEC_BANDS.map(b => spec[b.key] ?? -60);
  const maxRef = Math.max(...refVals, -60);
  const minRef = Math.min(...refVals, -80);
  const range = maxRef - minRef || 1;

  const specBarsHtml = SPEC_BANDS.map((b, i) => {
    const rv = spec[b.key] ?? null;
    const sv = ownSpec[b.key] ?? null;
    if (rv === null) return '';
    const refPct = Math.max(4, ((rv - minRef) / range) * 100);
    const srcPct = sv !== null ? Math.max(4, ((sv - minRef) / range) * 100) : null;
    const diff = sv !== null ? (rv - sv) : null;
    const diffStr = diff !== null ? (diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)) + ' dB' : '';
    const diffColor = diff === null ? '' : Math.abs(diff) < 2 ? 'var(--green,#3c6)' : Math.abs(diff) < 5 ? 'var(--amber,#fa0)' : 'var(--red,#e05)';
    return `<div style="margin-bottom:.45rem">
      <div style="display:flex;justify-content:space-between;font-size:.68rem;margin-bottom:.15rem">
        <span><b>${b.label}</b> <span style="color:var(--muted)">${b.range}</span></span>
        <span style="color:${diffColor};font-family:var(--mono)">${diffStr}</span>
      </div>
      <div style="position:relative;height:8px;background:var(--surface2,#1a1a2e);border-radius:4px;overflow:hidden">
        ${srcPct !== null ? `<div style="position:absolute;left:0;top:0;height:100%;width:${srcPct.toFixed(1)}%;background:var(--accent,#7c3aed);opacity:.45;border-radius:4px"></div>` : ''}
        <div style="position:absolute;left:0;top:0;height:100%;width:${refPct.toFixed(1)}%;background:var(--accent2,#06b6d4);opacity:.75;border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');

  const dynMetrics = [
    { label: 'RMS',          ownVal: ownAnalysis?.rms_db,             refVal: refAnalysis.rms_db,             unit: ' dB', fmt: v=>v.toFixed(1) },
    { label: 'Pico',         ownVal: ownAnalysis?.peak_db,            refVal: refAnalysis.peak_db,            unit: ' dBFS', fmt: v=>v.toFixed(1) },
    { label: 'Crest Factor', ownVal: ownAnalysis?.crest_factor_db,    refVal: refAnalysis.crest_factor_db,    unit: ' dB', fmt: v=>v.toFixed(1) },
    { label: 'LRA',          ownVal: ownAnalysis?.lra,                refVal: refAnalysis.lra,                unit: ' LU', fmt: v=>v?.toFixed(1) ?? '--' },
    { label: 'LUFS',         ownVal: ownAnalysis?.lufs,               refVal: refAnalysis.lufs,               unit: ' LUFS', fmt: v=>v.toFixed(1) },
  ];
  const dynRows = dynMetrics.map(m => {
    if (m.refVal == null) return '';
    const diff = m.ownVal != null ? (m.refVal - m.ownVal) : null;
    const dc = diff === null ? '' : Math.abs(diff) < 1 ? 'var(--green,#3c6)' : Math.abs(diff) < 3 ? 'var(--amber,#fa0)' : 'var(--red,#e05)';
    return `<div style="display:flex;justify-content:space-between;font-size:.72rem;padding:.18rem 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--muted)">${m.label}</span>
      <span><span style="color:var(--accent,#7c3aed)">${m.ownVal != null ? m.fmt(m.ownVal) + m.unit : '--'}</span>
      <span style="color:var(--muted);padding:0 .25rem">→</span>
      <span style="color:var(--accent2,#06b6d4)">${m.fmt(m.refVal)}${m.unit}</span>
      ${diff !== null ? `<span style="color:${dc};margin-left:.35rem;font-family:var(--mono)">(${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>` : ''}
      </span>
    </div>`;
  }).join('');

  const ownCorr = ownAnalysis?.stereo_correlation ?? null;
  const refCorr = refAnalysis.stereo_correlation ?? null;
  const stereoRow = (ownCorr !== null && refCorr !== null)
    ? `<div style="display:flex;justify-content:space-between;font-size:.72rem;padding:.18rem 0">
        <span style="color:var(--muted)">Correlación estéreo</span>
        <span><span style="color:var(--accent,#7c3aed)">${ownCorr.toFixed(2)}</span>
        <span style="color:var(--muted);padding:0 .25rem">→</span>
        <span style="color:var(--accent2,#06b6d4)">${refCorr.toFixed(2)}</span></span>
       </div>` : '';

  const bg = rm?.band_gains_applied || {};
  const BAND_LABELS = { sub:'Sub', bass:'Graves', low_mid:'Low-Mid', mid:'Medios', high_mid:'High-Mid', presence:'Presencia', air:'Aire' };
  const bgApplied = Object.entries(bg).filter(([k,v]) => Math.abs(v) >= 0.1);
  const bgHtml = bgApplied.length ? `<div style="margin-top:.5rem;font-size:.68rem;color:var(--muted)">Ajustes manuales aplicados: ${
    bgApplied.map(([k,v]) => `<span style="color:${v>0?'var(--green,#3c6)':'var(--red,#e05)'}"><b>${BAND_LABELS[k]||k}</b> ${v>0?'+':''}${v.toFixed(1)} dB</span>`).join(' · ')
  }</div>` : '';

  const msEqHtml = (rm && rm.eq_curve_mid_db && rm.eq_curve_mid_db.length) ? (() => {
    setTimeout(() => {
      const cv = document.getElementById('refMsEqCanvas');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height, ZERO = H / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(0, ZERO); ctx.lineTo(W, ZERO); ctx.stroke();
      [[rm.eq_curve_mid_db, 'var(--accent2,#06b6d4)'],
       [rm.eq_curve_side_db, 'var(--accent,#7c3aed)']].forEach(([curve, color]) => {
        if (!curve || !curve.length) return;
        const gains = curve.map(p => p.gain_db);
        const maxG = Math.max(6, ...gains.map(Math.abs));
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        curve.forEach((p, i) => {
          const x = (i / (curve.length - 1)) * W;
          const y = ZERO - (p.gain_db / maxG) * (H * 0.42);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }, 80);
    return `<div style="margin-top:.5rem">
      <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.2rem">Curvas EQ M/S</div>
      <div style="display:flex;gap:.6rem;font-size:.65rem;color:var(--muted);margin-bottom:.2rem">
        <span><span style="display:inline-block;width:10px;height:2px;background:var(--accent2,#06b6d4);vertical-align:middle;margin-right:.2rem"></span>Mid</span>
        <span><span style="display:inline-block;width:10px;height:2px;background:var(--accent,#7c3aed);vertical-align:middle;margin-right:.2rem"></span>Side</span>
      </div>
      <canvas id="refMsEqCanvas" width="320" height="55" style="width:100%;height:55px;background:var(--surface2,#0d0d1a);border-radius:5px;display:block"></canvas>
    </div>`;
  })() : '';

  return `<details style="margin-top:.9rem" open>
    <summary style="font-size:.73rem;color:var(--muted);cursor:pointer;user-select:none;letter-spacing:.05em;text-transform:uppercase">
      📊 Análisis detallado de la referencia
    </summary>
    <div style="margin-top:.55rem">
      <div style="font-size:.68rem;color:var(--muted);margin-bottom:.35rem;display:flex;gap:.8rem">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent2,#06b6d4);opacity:.8;margin-right:.3rem"></span>Referencia</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent,#7c3aed);opacity:.5;margin-right:.3rem"></span>Original</span>
      </div>
      <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.3rem">Espectro por banda (energía relativa)</div>
      ${specBarsHtml}
      <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin:.55rem 0 .2rem">Dinámica comparada</div>
      ${dynRows}
      ${stereoRow}
      ${bgHtml}
    </div>
  </details>`;
}

function renderReferenceMatch(rm, refAnalysis, ownAnalysis) {
  const panel = document.createElement("div");
  panel.className = "ref-match-panel";
  const pct = rm.after?.match_percent ?? 0;
  const report = rm.intelligent_report || {};
  const dynBands = rm.dynamics_by_band || {};
  const stereoBands = rm.stereo_width_by_band || {};
  const lra = rm.lra || {};

  const stages = [
    { label: "Antes", v: rm.before?.match_percent },
    { label: "Tras EQ", v: rm.after_eq?.match_percent },
    { label: "Final", v: pct },
  ];
  const stageBars = stages
    .map(
      (s) => `
  <div class="match-stage-col">
    <div class="match-stage-bar-track"><div class="match-stage-bar-fill" style="height:${Math.max(2, s.v ?? 0)}%"></div></div>
    <div class="match-stage-pct">${s.v ?? "--"}%</div>
    <div class="match-stage-label">${s.label}</div>
  </div>`
    )
    .join("");

  const dynRows = ["low", "mid", "high"]
    .map((name) => {
      const b = dynBands[name];
      if (!b) return "";
      const label = name === "low" ? "Graves" : name === "mid" ? "Medios" : "Agudos";
      if (b.own_crest_db == null) {
        const text = b.applied
          ? `comprimida (gap ${b.gap_db} dB, ratio ${b.ratio}:1)`
          : `sin cambios (gap ${b.gap_db} dB)`;
        return `<div class="ref-match-step">${label}: <b>${text}</b></div>`;
      }
      return _matchBarRow(
        `${label} (crest factor)`, b.own_crest_db, b.ref_crest_db, " dB", 1.5,
        (v) => v.toFixed(1)
      );
    })
    .join("");

  const stereoRows = ["low", "mid", "high"]
    .map((name) => {
      const k = stereoBands[name];
      if (k === undefined) return "";
      const label = name === "low" ? "Graves" : name === "mid" ? "Medios" : "Agudos";
      const pctBar = Math.max(0, Math.min(100, ((k - 0.5) / 1.0) * 100));
      const ok = Math.abs(k - 1.0) < 0.35;
      return `
  <div class="match-bar-row">
    <div class="match-bar-label">${ok ? "✓" : "↔"} ${label}</div>
    <div class="match-bar-track">
      <div class="match-bar-marker match-bar-ref" style="left:50%" title="Sin cambio de ancho"></div>
      <div class="match-bar-fill" style="width:${pctBar}%"></div>
    </div>
    <div class="match-bar-values">factor ${k.toFixed(2)}x</div>
  </div>`;
    })
    .join("");

  const lraText = lra.applied
    ? `LRA ${lra.own_lra} → acercado a ${lra.ref_lra} LU (ratio ${lra.ratio}:1)`
    : `LRA propio: ${lra.own_lra ?? "--"} LU · referencia: ${lra.ref_lra ?? "--"} LU`;

  const loudnessBar = _matchBarRow(
    "Loudness (LUFS)", ownAnalysis?.lufs, refAnalysis?.lufs, " LUFS", 0.5, (v) => v.toFixed(1)
  );
  const loudnessMatch = rm.loudness_match || {};
  const adaptiveLoudnessHtml = loudnessMatch.adaptive
    ? `<div class="ref-match-step" style="flex-basis:100%">👂 LUFS perceptual: propio <b>${loudnessMatch.source?.perceived_lufs ?? "--"}</b> · ref <b>${loudnessMatch.reference?.perceived_lufs ?? "--"}</b> · corrección 3–6 kHz <b>${loudnessMatch.source?.presence_correction_db ?? "--"} / ${loudnessMatch.reference?.presence_correction_db ?? "--"} dB</b></div>`
    : "";

  const tipsHtml = (report.tips || []).map((t) => `<li>${t}</li>`).join("");
  const issuesHtml = (report.issues || []).map((t) => `<li style="color:var(--red,#e05)">${t}</li>`).join("");

  panel.innerHTML = `
  <h3>🎯 Match con referencia</h3>
  <div class="ref-match-score-row">
    <div class="ref-match-score-circle"><span class="score-num">${pct}%</span><span class="score-label">MATCH TONAL</span></div>
    <div class="match-stage-cols">${stageBars}</div>
    <div>
      ${report.overall_score !== undefined ? `<div style="font-size:.8rem;margin-top:.3rem">Puntaje inteligente general: <b>${report.overall_score}/100 (${report.grade})</b></div>` : ""}
    </div>
  </div>
  <div style="margin-top:.7rem;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Loudness</div>
  ${loudnessBar}
  <div class="ref-match-steps">
    <div class="ref-match-step">Ganancia aplicada: <b>${rm.loudness_gain_applied_db >= 0 ? "+" : ""}${rm.loudness_gain_applied_db} dB</b></div>
    ${adaptiveLoudnessHtml}
    <div class="ref-match-step">Techo limiter: <b>${(20 * Math.log10(rm.limiter_ceiling)).toFixed(2)} dBFS</b></div>
    <div class="ref-match-step" style="flex-basis:100%">${lraText}</div>
  </div>
  <div style="margin-top:.7rem;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Dinámica por banda (crest factor propio vs. referencia)</div>
  ${dynRows}
  <div style="margin-top:.7rem;font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Ancho estéreo por banda</div>
  ${stereoRows}
  ${issuesHtml ? `<ul style="margin-top:.7rem;font-size:.78rem;padding-left:1.1rem">${issuesHtml}</ul>` : ""}
  ${tipsHtml ? `<ul style="margin-top:.5rem;font-size:.78rem;color:var(--muted);padding-left:1.1rem">${tipsHtml}</ul>` : ""}
  ${msEqHtml}
`;
  const detailHtml = renderReferenceAnalysisPanel(refAnalysis, ownAnalysis, rm);
  if (detailHtml) panel.insertAdjacentHTML('beforeend', detailHtml);

  const sd = rm.spectral_dynamics;
  if (sd && sd.applied && sd.src_tonal_slope && sd.ref_tonal_slope) {
    const slope_src = sd.src_tonal_slope.loud_vs_quiet_db || [];
    const slope_ref = sd.ref_tonal_slope.loud_vs_quiet_db || [];
    const BAND_NAMES = ["Sub", "Graves", "Low-Mid", "Medios", "High-Mid", "Presencia", "Aire"];
    const slopeRows = slope_ref.map((refVal, i) => {
      const srcVal = slope_src[i] ?? 0;
      const label = BAND_NAMES[i] || `Banda ${i+1}`;
      const maxV = Math.max(Math.abs(refVal), Math.abs(srcVal), 1);
      const refPct = 50 + (refVal / maxV) * 45;
      const srcPct = 50 + (srcVal / maxV) * 45;
      const diff = Math.abs(refVal - srcVal);
      const color = diff < 1.5 ? "var(--green,#3c6)" : diff < 3 ? "var(--amber,#fa0)" : "var(--red,#e05)";
      return `<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;font-size:0.68rem">
        <span style="width:4.5rem;color:var(--muted)">${label}</span>
        <div style="flex:1;position:relative;height:6px;background:var(--surface2,#1a1a2e);border-radius:3px">
          <div style="position:absolute;left:50%;top:0;width:1px;height:100%;background:rgba(255,255,255,0.15)"></div>
          <div title="Referencia" style="position:absolute;left:${refPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--accent2,#06b6d4);border-radius:1px"></div>
          <div title="Original" style="position:absolute;left:${srcPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--accent,#7c3aed);opacity:0.7;border-radius:1px"></div>
        </div>
        <span style="width:2.5rem;text-align:right;color:${color};font-family:var(--mono)">${refVal >= 0 ? '+' : ''}${refVal.toFixed(1)}</span>
      </div>`;
    }).join('');
    panel.insertAdjacentHTML('beforeend', `<details style="margin-top:0.9rem">
      <summary style="font-size:0.73rem;color:var(--muted);cursor:pointer;user-select:none;letter-spacing:0.05em;text-transform:uppercase">🎚 Spectral balance por rango dinámico</summary>
      <div style="margin-top:0.5rem">
        <p style="font-size:0.68rem;color:var(--muted);margin:0 0 0.4rem">Diferencia espectral fuerte vs suave. Cyan = referencia · Violeta = original.</p>
        ${slopeRows}
        <p style="font-size:0.65rem;color:var(--muted);margin:0.4rem 0 0">Intensidad: ${Math.round(sd.amount * 100)}% · ${sd.n_bins} rangos</p>
      </div>
    </details>`);
  }

  getContent().appendChild(panel);
}

// ── AB Panel (sin cambios) ──────────────────────────────────
document.getElementById("btnAB").addEventListener("click", () => {
  if (!selectedFile) return;
  showABPanel();
});
function showABPanel() {
  let wrap = document.getElementById("abPanelWrap");
  if (wrap) return;
  clearResults();
  wrap = document.createElement("div");
  wrap.id = "abPanelWrap";
  wrap.className = "ab-wrap";
  wrap.innerHTML = `
  <h3>⚡ Comparación A/B</h3>
  <p style="font-size:.8rem;color:var(--muted);margin-bottom:1rem">Guardá dos versiones (A y B) y comparalas.</p>
  <div class="ab-controls">
    <button class="ab-btn" id="abCaptureA">📸 Capturar A</button>
    <button class="ab-btn" id="abCaptureB">📸 Capturar B</button>
    <button class="ab-btn" id="abPlayA" disabled>▶ A</button>
    <button class="ab-btn" id="abPlayB" disabled>▶ B</button>
  </div>
  <div id="abStatus" style="font-family:var(--mono);font-size:.75rem;color:var(--muted)">Capturá A y B.</div>
  <div id="abAudioWrap" style="margin-top:1rem"></div>
`;
  document.getElementById("content").appendChild(wrap);
  document.getElementById("abCaptureA").onclick = () => captureAB("A");
  document.getElementById("abCaptureB").onclick = () => captureAB("B");
  document.getElementById("abPlayA").onclick = () => playAB("A");
  document.getElementById("abPlayB").onclick = () => playAB("B");
}

async function captureAB(slot) {
  if (!selectedFile) {
    document.getElementById("abStatus").textContent = "Selecciona un archivo primero.";
    return;
  }
  const status = document.getElementById("abStatus");
  status.textContent = `Capturando ${slot}…`;
  const fd = new FormData();
  fd.append("file", selectedFile);
  try {
    const params = buildParams();
    params.set("preview_seconds", "10");
    const url = `${API()}/preview?${params.toString()}`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const blob = await res.blob();
    if (slot === "A") {
      abSnapshotA = { blob, label: "A" };
      document.getElementById("abPlayA").disabled = false;
      document.getElementById("abPlayA").classList.add("active-a");
    } else {
      abSnapshotB = { blob, label: "B" };
      document.getElementById("abPlayB").disabled = false;
      document.getElementById("abPlayB").classList.add("active-b");
    }
    status.textContent = `${slot} capturado ✓. ${abSnapshotA && abSnapshotB ? "Ambos listos." : ""}`;
  } catch (e) {
    console.error("Error capturando:", e);
    status.textContent = "Error: " + e.message;
  }
}

function playAB(slot) {
  const snap = slot === "A" ? abSnapshotA : abSnapshotB;
  if (!snap) return;
  const wrap = document.getElementById("abAudioWrap");
  const url = URL.createObjectURL(snap.blob);
  wrap.innerHTML = `<div style="font-family:var(--mono);font-size:.75rem;color:${slot === "A" ? "var(--accent)" : "var(--yellow)"};margin-bottom:.3rem">▶ ${slot}</div><audio controls autoplay src="${url}" style="width:100%"></audio>`;
}

// ── Advice ────────────────────────────────────────────────────
function renderAdvicePanel(adviceData, title, subtitle) {
  const panel = document.createElement("div");
  panel.className = "advice-panel";
  const score = adviceData.score ?? 0,
    grade = adviceData.grade ?? "";
  const issues = adviceData.issues ?? [],
    tips = adviceData.tips ?? [];
  const gradeClass =
    grade === "Excelente"
      ? "grade-ex"
      : grade === "Buena"
        ? "grade-good"
        : grade === "Aceptable"
          ? "grade-ok"
          : "grade-bad";
  const issuesHtml = issues.length
    ? `<ul class="advice-issues">${issues.map((i) => `<li>${i}</li>`).join("")}</ul>`
    : "";
  const tipsHtml = tips.length ? `<ul class="advice-tips">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
  panel.innerHTML = `<h3>${title}${subtitle ? ` <span style="color:var(--muted);font-weight:400">${subtitle}</span>` : ""}</h3><div class="advice-score-row"><div class="advice-score-circle"><span class="score-num">${score}</span><span class="score-label">/ 100</span></div><div><div class="advice-grade ${gradeClass}">${grade}</div><div style="font-size:.75rem;color:var(--muted);margin-top:.2rem">${issues.length} problema${issues.length !== 1 ? "s" : ""}</div></div></div>${issuesHtml}${tipsHtml}`;
  getContent().appendChild(panel);
}