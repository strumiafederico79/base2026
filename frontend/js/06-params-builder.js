// ============================================================
// 06-params-builder.js — Armado de parámetros y vista previa antes de masterizar
// ============================================================
      function collectMasterParamsObj() {
        const platform = document.getElementById("s-platform").value;
        const obj = {
          input_gain_db: document.getElementById("s-ingain").value,
          target_peak: document.getElementById("s-peak").value,
          use_lufs_normalize: document.getElementById("s-uselufs").checked,
          target_lufs: document.getElementById("s-lufstarget").value,
          comp_threshold_db: document.getElementById("s-thresh").value,
          comp_ratio: document.getElementById("s-ratio").value,
          comp_attack_ms: document.getElementById("s-cattack").value,
          comp_release_ms: document.getElementById("s-crelease").value,
          comp_makeup_db: document.getElementById("s-cmakeup").value,
          comp_pdr: document.getElementById("s-comp-pdr").checked,          // BUGFIX: faltaba — el toggle PDR nunca se enviaba al backend
          comp_pdr_hold_ms: document.getElementById("s-comp-pdr-hold").value, // BUGFIX: idem
          comp_stereo_link: document.getElementById("s-comp-link").checked,
          oversample_mode: document.getElementById("s-oversample").value,
          nr_bypass: document.getElementById("s-nr-bypass").checked,
          nr_strength: document.getElementById("s-nr-strength").value,
          nr_noise_sample_sec: document.getElementById("s-nr-noise-sample-sec").value,
          glue_bypass: document.getElementById("s-glue-bypass").checked,
          glue_threshold_db: document.getElementById("s-glue-thresh").value,
          glue_ratio: document.getElementById("s-glue-ratio").value,
          glue_attack_ms: document.getElementById("s-glue-attack").value,
          glue_release_ms: document.getElementById("s-glue-release").value,
          glue_makeup_db: document.getElementById("s-glue-makeup").value,
          glue_pdr: document.getElementById("s-glue-pdr").checked,          // BUGFIX: idem
          glue_pdr_hold_ms: document.getElementById("s-glue-pdr-hold").value, // BUGFIX: idem
          clipper_bypass: document.getElementById("s-clip-bypass").checked,
          clipper_mode: document.getElementById("s-clip-mode").value,
          clipper_ceiling: document.getElementById("s-clip-ceiling").value,
          clipper_drive_db: document.getElementById("s-clip-drive").value,
          hp_cutoff: document.getElementById("s-hp").value,
          lp_bypass: document.getElementById("s-lp-bypass").checked,
          lp_cutoff: document.getElementById("s-lp-cutoff").value,
          high_shelf_gain_db: document.getElementById("s-air").value,
          high_shelf_freq_hz: document.getElementById("s-shelf-freq").value,
          low_shelf_gain_db: document.getElementById("s-lowshelf").value,    // BUGFIX: faltaba — el low shelf nunca se enviaba al backend
          low_shelf_freq_hz: document.getElementById("s-lowshelf-freq").value, // BUGFIX: idem
          eq1_freq: document.getElementById("s-eq1freq").value,
          eq1_gain: document.getElementById("s-eq1gain").value,
          eq1_q: document.getElementById("s-eq1q").value,
          eq2_freq: document.getElementById("s-eq2freq").value,
          eq2_gain: document.getElementById("s-eq2gain").value,
          eq2_q: document.getElementById("s-eq2q").value,
          eq3_freq: document.getElementById("s-eq3freq").value,
          eq3_gain: document.getElementById("s-eq3gain").value,
          eq3_q: document.getElementById("s-eq3q").value,
          eq4_freq: document.getElementById("s-eq4freq").value,
          eq4_gain: document.getElementById("s-eq4gain").value,
          eq4_q: document.getElementById("s-eq4q").value,
          eq5_freq: document.getElementById("s-eq5freq").value,
          eq5_gain: document.getElementById("s-eq5gain").value,
          eq5_q: document.getElementById("s-eq5q").value,
          eq6_freq: document.getElementById("s-eq6freq").value,
          eq6_gain: document.getElementById("s-eq6gain").value,
          eq6_q: document.getElementById("s-eq6q").value,
          transient_attack: document.getElementById("s-tatt").value,
          transient_sustain: document.getElementById("s-tsus").value,
          saturation_drive: document.getElementById("s-satdrive").value,
          saturation_mode: document.getElementById("s-satmode").value,
          saturation_mix: document.getElementById("s-satmix").value,
          mid_gain_db: document.getElementById("s-mgain").value,
          side_gain_db: document.getElementById("s-sgain").value,
          stereo_width_amount: document.getElementById("s-width").value,
          use_stereo_enhancer: document.getElementById("s-enhancer").checked,
          haas_delay_ms: document.getElementById("s-haas").value,
          enhancer_bass_mono_freq: document.getElementById("s-bassmono").value,
          reverb_size: document.getElementById("s-rsize").value,
          reverb_wet: document.getElementById("s-rwet").value,
          limiter_ceiling: document.getElementById("s-ceiling").value,
          limiter_release_ms: document.getElementById("s-lrelease").value,
          output_format: document.getElementById("s-format").value,
          output_bit_depth: document.getElementById("s-bitdepth").value,
          dither_mode: document.getElementById("s-dither-mode").value,  // BUGFIX: faltaba — el noise shaping nunca se enviaba al backend
          // multiband
          mb_low_crossover: document.getElementById("s-mb-lowx").value,
          mb_high_crossover: document.getElementById("s-mb-highx").value,
          mb_low_threshold_db: document.getElementById("s-mb-low-th").value,
          mb_low_ratio: document.getElementById("s-mb-low-ratio").value,
          mb_low_attack_ms: document.getElementById("s-mb-low-att").value,
          mb_low_release_ms: document.getElementById("s-mb-low-rel").value,
          mb_low_makeup_db: document.getElementById("s-mb-low-mu").value,
          mb_mid_threshold_db: document.getElementById("s-mb-mid-th").value,
          mb_mid_ratio: document.getElementById("s-mb-mid-ratio").value,
          mb_mid_attack_ms: document.getElementById("s-mb-mid-att").value,
          mb_mid_release_ms: document.getElementById("s-mb-mid-rel").value,
          mb_mid_makeup_db: document.getElementById("s-mb-mid-mu").value,
          mb_high_threshold_db: document.getElementById("s-mb-high-th").value,
          mb_high_ratio: document.getElementById("s-mb-high-ratio").value,
          mb_high_attack_ms: document.getElementById("s-mb-high-att").value,
          mb_high_release_ms: document.getElementById("s-mb-high-rel").value,
          mb_high_makeup_db: document.getElementById("s-mb-high-mu").value,
          mb_pdr: document.getElementById("s-mb-pdr").checked,          // BUGFIX: idem
          mb_pdr_hold_ms: document.getElementById("s-mb-pdr-hold").value, // BUGFIX: idem
          mb_bypass: document.getElementById("mb-bypass").checked,
          // Multiband Stereo Width
          mb_stereo_bypass: document.getElementById("mb-stereo-bypass").checked,
          mb_stereo_low_width: document.getElementById("s-mb-sw-low").value,
          mb_stereo_mid_width: document.getElementById("s-mb-sw-mid").value,
          mb_stereo_high_width: document.getElementById("s-mb-sw-high").value,
          mb_stereo_low_crossover: document.getElementById("s-mb-sw-lowx").value,
          mb_stereo_high_crossover: document.getElementById("s-mb-sw-highx").value,
        };
        // Dynamic EQ
        obj.parallel_bypass = document.getElementById("parallelBypass").checked;
        obj.parallel_mix = document.getElementById("parallelMix").value;
        obj.parallel_threshold_db = document.getElementById("parallelThresh").value;
        obj.parallel_ratio = document.getElementById("parallelRatio").value;
        obj.parallel_attack_ms = document.getElementById("parallelAttack").value;
        obj.parallel_release_ms = document.getElementById("parallelRelease").value;
        obj.ms_eq_bypass = document.getElementById("s-mseq-bypass").checked;
        obj.ms_mid_freq = document.getElementById("s-mseq-mid-freq").value;
        obj.ms_mid_gain = document.getElementById("s-mseq-mid-gain").value;
        obj.ms_mid_q = document.getElementById("s-mseq-mid-q").value;
        obj.ms_side_freq = document.getElementById("s-mseq-side-freq").value;
        obj.ms_side_gain = document.getElementById("s-mseq-side-gain").value;
        obj.ms_side_q = document.getElementById("s-mseq-side-q").value;
        obj.ms_comp_bypass = document.getElementById("s-mscomp-bypass").checked;
        obj.ms_comp_mid_threshold_db = document.getElementById("s-mscomp-mid-thresh").value;
        obj.ms_comp_mid_ratio = document.getElementById("s-mscomp-mid-ratio").value;
        obj.ms_comp_mid_attack_ms = document.getElementById("s-mscomp-mid-attack").value;
        obj.ms_comp_mid_release_ms = document.getElementById("s-mscomp-mid-release").value;
        obj.ms_comp_mid_makeup_db = document.getElementById("s-mscomp-mid-makeup").value;
        obj.ms_comp_side_threshold_db = document.getElementById("s-mscomp-side-thresh").value;
        obj.ms_comp_side_ratio = document.getElementById("s-mscomp-side-ratio").value;
        obj.ms_comp_side_attack_ms = document.getElementById("s-mscomp-side-attack").value;
        obj.ms_comp_side_release_ms = document.getElementById("s-mscomp-side-release").value;
        obj.ms_comp_side_makeup_db = document.getElementById("s-mscomp-side-makeup").value;
        obj.ms_comp_pdr = document.getElementById("s-mscomp-pdr").checked;          // BUGFIX: idem
        obj.ms_comp_pdr_hold_ms = document.getElementById("s-mscomp-pdr-hold").value; // BUGFIX: idem
        obj.dyneq_bypass = document.getElementById("s-dyneq-bypass").checked;
        obj.dyneq_freq = document.getElementById("s-dyneq-freq").value;
        obj.dyneq_q = document.getElementById("s-dyneq-q").value;
        obj.dyneq_threshold_db = document.getElementById("s-dyneq-thresh").value;
        obj.dyneq_ratio = document.getElementById("s-dyneq-ratio").value;
        obj.dyneq_attack_ms = document.getElementById("s-dyneq-attack").value;
        obj.dyneq_release_ms = document.getElementById("s-dyneq-release").value;
        obj.dyneq_max_reduction_db = document.getElementById("s-dyneq-maxred").value;
        // Dynamic EQ — banda de resonancias (etapa 3)
        obj.reso_bypass = document.getElementById("s-reso-bypass").checked;
        obj.reso_freq = document.getElementById("s-reso-freq").value;
        obj.reso_q = document.getElementById("s-reso-q").value;
        obj.reso_threshold_db = document.getElementById("s-reso-thresh").value;
        obj.reso_ratio = document.getElementById("s-reso-ratio").value;
        obj.reso_attack_ms = document.getElementById("s-reso-attack").value;
        obj.reso_release_ms = document.getElementById("s-reso-release").value;
        obj.reso_max_reduction_db = document.getElementById("s-reso-maxred").value;
        // Low-End Mono Maker
        obj.low_end_mono_freq = document.getElementById("s-mono-freq").value;
        obj.low_end_mono_amount = document.getElementById("s-mono-amount").value;
        // EQ Mode
        obj.eq_mode = document.getElementById("s-eq-mode").value;
        obj.linear_phase_taps = document.getElementById("s-lp-taps").value;
        obj.tonal_balance_bypass = document.getElementById("s-tonalbal-bypass").checked;
        obj.tonal_balance_amount = document.getElementById("s-tonalbal-amount").value;
        obj.tonal_balance_max_boost_db = document.getElementById("s-tonalbal-boost").value;
        obj.tonal_balance_max_cut_db = document.getElementById("s-tonalbal-cut").value;
        obj.tonal_balance_max_bands = document.getElementById("s-tonalbal-bands").value;
        const platformTargetVal = document.getElementById("s-platform")?.value || "";
        if (platformTargetVal) obj.platform_target = platformTargetVal;
        return obj;
      }
      function buildParams() {
        const obj = collectMasterParamsObj();
        // URLSearchParams convierte null/undefined en el string literal "null"/"undefined",
        // lo cual rompe la validación de FastAPI (pattern regex). Se filtran esos valores
        // para que el backend reciba el parámetro directamente omitido y use su default.
        Object.keys(obj).forEach((k) => {
          if (obj[k] === null || obj[k] === undefined) delete obj[k];
        });
        return new URLSearchParams(obj);
      }

      // ── Vista previa de parámetros corregidos antes de masterizar ───────────────
      const PARAM_PREVIEW_GROUPS = [
        {
          title: "Entrada / Loudness",
          keys: ["input_gain_db", "target_peak", "use_lufs_normalize", "target_lufs", "platform_target"],
        },
        {
          title: "Compresor",
          keys: [
            "comp_threshold_db",
            "comp_ratio",
            "comp_attack_ms",
            "comp_release_ms",
            "comp_makeup_db",
            "comp_pdr",
            "comp_pdr_hold_ms",
            "comp_stereo_link",
            "oversample_mode",
          ],
        },
        {
          title: "EQ",
          keys: [
            "hp_cutoff",
            "high_shelf_gain_db",
            "high_shelf_freq_hz",
            "low_shelf_gain_db",
            "low_shelf_freq_hz",
            "eq1_freq",
            "eq1_gain",
            "eq1_q",
            "eq2_freq",
            "eq2_gain",
            "eq2_q",
            "eq3_freq",
            "eq3_gain",
            "eq3_q",
            "eq4_freq",
            "eq4_gain",
            "eq4_q",
            "eq5_freq",
            "eq5_gain",
            "eq5_q",
            "eq6_freq",
            "eq6_gain",
            "eq6_q",
          ],
        },
        {
          title: "Transient / Saturación",
          keys: ["transient_attack", "transient_sustain", "saturation_drive", "saturation_mode", "saturation_mix"],
        },
        {
          title: "Estéreo",
          keys: [
            "mid_gain_db",
            "side_gain_db",
            "stereo_width_amount",
            "use_stereo_enhancer",
            "haas_delay_ms",
            "enhancer_bass_mono_freq",
          ],
        },
        {
          title: "Glue Compressor",
          keys: [
            "glue_bypass",
            "glue_threshold_db",
            "glue_ratio",
            "glue_attack_ms",
            "glue_release_ms",
            "glue_makeup_db",
            "glue_pdr",
            "glue_pdr_hold_ms",
          ],
        },
        {
          title: "Reverb / Limiter / Salida",
          keys: [
            "reverb_size",
            "reverb_wet",
            "limiter_ceiling",
            "limiter_release_ms",
            "output_format",
            "output_bit_depth",
          ],
        },
        {
          title: "Multibanda — Compresión",
          keys: [
            "mb_bypass",
            "mb_low_crossover",
            "mb_high_crossover",
            "mb_low_threshold_db",
            "mb_low_ratio",
            "mb_low_attack_ms",
            "mb_low_release_ms",
            "mb_low_makeup_db",
            "mb_mid_threshold_db",
            "mb_mid_ratio",
            "mb_mid_attack_ms",
            "mb_mid_release_ms",
            "mb_mid_makeup_db",
            "mb_high_threshold_db",
            "mb_high_ratio",
            "mb_high_attack_ms",
            "mb_high_release_ms",
            "mb_high_makeup_db",
            "mb_pdr",
            "mb_pdr_hold_ms",
          ],
        },
        {
          title: "Multibanda — Ancho estéreo",
          keys: [
            "mb_stereo_bypass",
            "mb_stereo_low_width",
            "mb_stereo_mid_width",
            "mb_stereo_high_width",
            "mb_stereo_low_crossover",
            "mb_stereo_high_crossover",
          ],
        },
        {
          title: "Dynamic EQ / De-esser",
          keys: [
            "dyneq_bypass",
            "dyneq_freq",
            "dyneq_q",
            "dyneq_threshold_db",
            "dyneq_ratio",
            "dyneq_attack_ms",
            "dyneq_release_ms",
            "dyneq_max_reduction_db",
          ],
        },
        {
          title: "Dynamic EQ / Resonancias",
          keys: [
            "reso_bypass",
            "reso_freq",
            "reso_q",
            "reso_threshold_db",
            "reso_ratio",
            "reso_attack_ms",
            "reso_release_ms",
            "reso_max_reduction_db",
          ],
        },
        { title: "Low-End Mono Maker", keys: ["low_end_mono_freq", "low_end_mono_amount"] },
        {
          title: "EQ Mid/Side",
          keys: [
            "ms_eq_bypass", "ms_mid_freq", "ms_mid_gain", "ms_mid_q", "ms_side_freq", "ms_side_gain", "ms_side_q",
            "ms_comp_bypass",
            "ms_comp_mid_threshold_db", "ms_comp_mid_ratio", "ms_comp_mid_attack_ms",
            "ms_comp_mid_release_ms", "ms_comp_mid_makeup_db",
            "ms_comp_side_threshold_db", "ms_comp_side_ratio", "ms_comp_side_attack_ms",
            "ms_comp_side_release_ms", "ms_comp_side_makeup_db",
            "ms_comp_pdr", "ms_comp_pdr_hold_ms",
          ],
        },
        { title: "Modo EQ", keys: ["eq_mode", "linear_phase_taps"] },
      ];
      const PARAM_LABELS = {
        input_gain_db: "Ganancia entrada (dB)",
        target_peak: "Peak objetivo",
        use_lufs_normalize: "Normalizar LUFS",
        target_lufs: "LUFS objetivo",
        platform_target: "Plataforma",
        comp_threshold_db: "Threshold (dB)",
        comp_ratio: "Ratio",
        comp_attack_ms: "Attack",
        comp_release_ms: "Release",
        comp_makeup_db: "Makeup",
        comp_pdr: "PDR (banda ancha)",
        comp_pdr_hold_ms: "PDR Hold (banda ancha)",
        comp_stereo_link: "Stereo link L/R",
        oversample_mode: "Oversampling",
        hp_cutoff: "High-pass (Hz)",
        high_shelf_gain_db: "Shelf ganancia (dB)",
        high_shelf_freq_hz: "Shelf freq (Hz)",
        low_shelf_gain_db: "Low shelf ganancia (dB)",
        low_shelf_freq_hz: "Low shelf freq (Hz)",
        eq1_freq: "EQ1 freq",
        eq1_gain: "EQ1 ganancia",
        eq1_q: "EQ1 Q",
        eq2_freq: "EQ2 freq",
        eq2_gain: "EQ2 ganancia",
        eq2_q: "EQ2 Q",
        eq3_freq: "EQ3 freq",
        eq3_gain: "EQ3 ganancia",
        eq3_q: "EQ3 Q",
        eq4_freq: "EQ4 freq",
        eq4_gain: "EQ4 ganancia",
        eq4_q: "EQ4 Q",
        eq5_freq: "EQ5 freq",
        eq5_gain: "EQ5 ganancia",
        eq5_q: "EQ5 Q",
        eq6_freq: "EQ6 freq",
        eq6_gain: "EQ6 ganancia",
        eq6_q: "EQ6 Q",
        transient_attack: "Transient attack",
        transient_sustain: "Transient sustain",
        saturation_drive: "Saturación drive",
        saturation_mode: "Saturación modo",
        saturation_mix: "Saturación mix",
        mid_gain_db: "Mid gain (dB)",
        side_gain_db: "Side gain (dB)",
        stereo_width_amount: "Ancho estéreo",
        use_stereo_enhancer: "Stereo enhancer",
        haas_delay_ms: "Haas delay (ms)",
        enhancer_bass_mono_freq: "Bass mono freq",
        nr_bypass: "Bypass noise reduction",
        nr_strength: "Intensidad NR",
        nr_noise_sample_sec: "Muestra ruido (s)",
        glue_bypass: "Bypass glue",
        glue_threshold_db: "Threshold (dB)",
        glue_ratio: "Ratio",
        glue_attack_ms: "Attack",
        glue_release_ms: "Release",
        glue_makeup_db: "Makeup",
        glue_pdr: "PDR (glue)",
        glue_pdr_hold_ms: "PDR Hold (glue)",
        reverb_size: "Reverb tamaño",
        reverb_wet: "Reverb wet",
        limiter_ceiling: "Limiter ceiling",
        limiter_release_ms: "Limiter release (ms)",
        output_format: "Formato salida",
        output_bit_depth: "Bit depth",
        dither_mode: "Modo de dither",
        mb_bypass: "Bypass multibanda",
        mb_low_crossover: "Cruce low (Hz)",
        mb_high_crossover: "Cruce high (Hz)",
        mb_low_threshold_db: "Low threshold (dB)",
        mb_low_ratio: "Low ratio",
        mb_low_attack_ms: "Low attack",
        mb_low_release_ms: "Low release",
        mb_low_makeup_db: "Low makeup",
        mb_mid_threshold_db: "Mid threshold (dB)",
        mb_mid_ratio: "Mid ratio",
        mb_mid_attack_ms: "Mid attack",
        mb_mid_release_ms: "Mid release",
        mb_mid_makeup_db: "Mid makeup",
        mb_high_threshold_db: "High threshold (dB)",
        mb_high_ratio: "High ratio",
        mb_high_attack_ms: "High attack",
        mb_high_release_ms: "High release",
        mb_high_makeup_db: "High makeup",
        mb_pdr: "PDR (multibanda)",
        mb_pdr_hold_ms: "PDR Hold (multibanda)",
        mb_stereo_bypass: "Bypass ancho MB",
        mb_stereo_low_width: "Ancho low",
        mb_stereo_mid_width: "Ancho mid",
        mb_stereo_high_width: "Ancho high",
        dyneq_bypass: "Bypass Dynamic EQ",
        dyneq_freq: "Freq (Hz)",
        dyneq_q: "Q",
        dyneq_threshold_db: "Threshold (dB)",
        dyneq_ratio: "Ratio",
        dyneq_attack_ms: "Attack (ms)",
        dyneq_release_ms: "Release (ms)",
        dyneq_max_reduction_db: "Reducción máx. (dB)",
        reso_bypass: "Bypass Resonancias",
        reso_freq: "Freq (Hz)",
        reso_q: "Q",
        reso_threshold_db: "Threshold (dB)",
        reso_ratio: "Ratio",
        reso_attack_ms: "Attack (ms)",
        reso_release_ms: "Release (ms)",
        reso_max_reduction_db: "Reducción máx. (dB)",
        low_end_mono_freq: "Corte mono (Hz)",
        low_end_mono_amount: "Cantidad mono",
        ms_eq_bypass: "Bypass EQ M/S",
        ms_mid_freq: "Mid freq (Hz)",
        ms_mid_gain: "Mid ganancia",
        ms_mid_q: "Mid Q",
        ms_side_freq: "Side freq (Hz)",
        ms_side_gain: "Side ganancia",
        ms_side_q: "Side Q",
        ms_comp_bypass: "Bypass Comp M/S",
        ms_comp_mid_threshold_db: "Mid threshold (dB)",
        ms_comp_mid_ratio: "Mid ratio",
        ms_comp_mid_attack_ms: "Mid attack",
        ms_comp_mid_release_ms: "Mid release",
        ms_comp_mid_makeup_db: "Mid makeup",
        ms_comp_side_threshold_db: "Side threshold (dB)",
        ms_comp_side_ratio: "Side ratio",
        ms_comp_side_attack_ms: "Side attack",
        ms_comp_side_release_ms: "Side release",
        ms_comp_side_makeup_db: "Side makeup",
        ms_comp_pdr: "PDR (M/S)",
        ms_comp_pdr_hold_ms: "PDR Hold (M/S)",
        eq_mode: "Modo EQ",
        linear_phase_taps: "FIR Taps",
        mb_stereo_low_crossover: "Cruce low (Hz)",
        mb_stereo_high_crossover: "Cruce high (Hz)",
      };
      const DITHER_MODE_LABELS = { tpdf: "TPDF plano", high_shelf: "High-shelf", f_weighted: "F-weighted" };
      function formatParamValue(v, key) {
        if (key === "dither_mode") return DITHER_MODE_LABELS[v] || v;
        if (Array.isArray(v)) {
          if (key === "band_gains_array") {
            const activas = v.filter((b) => b && b.gain_db && Math.abs(b.gain_db) > 0).length;
            return `${v.length} bandas (${activas} con ganancia)`;
          }
          return `${v.length} elementos`;
        }
        const n = parseFloat(v);
        if (key && key.includes("ratio") && !Number.isNaN(n)) return `Ratio ${n.toFixed(1)}:1`;
        if (key && key.includes("threshold_db") && !Number.isNaN(n)) return `Threshold ${formatDbValue(n)}`;
        if (key && key.includes("attack_ms") && !Number.isNaN(n)) return `Attack ${n.toFixed(1)} ms`;
        if (key && key.includes("release_ms") && !Number.isNaN(n)) return `Release ${Math.round(n)} ms`;
        if (key && key.includes("makeup_db") && !Number.isNaN(n))
          return `Makeup ${n >= 0 ? "+" : ""}${n.toFixed(1)} dB`;
        if (v === true) return "Sí";
        if (v === false) return "No";
        if (v === "" || v == null) return "—";
        return v;
      }
      // ... (todo el código anterior se mantiene igual) ...

      function renderParamsPreview(
        paramsObj,
        {
          onConfirm,
          onCancel,
          confirmLabel = "✅ Confirmar y masterizar",
          readOnly = false,
          title = "🔎 Parámetros corregidos — revisá antes de masterizar",
        } = {},
      ) {
        // 🔥 FIX 2: Eliminar cualquier panel previo
        const oldPanel = getContent().querySelector(".params-preview");
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement("div");
        panel.className = "params-preview";
        let html = `<h3>${title}</h3>`;
        PARAM_PREVIEW_GROUPS.forEach((group) => {
          const items = group.keys.filter((k) => paramsObj[k] !== undefined);
          if (!items.length) return;
          html += `<div class="pp-group"><div class="pp-group-title">${group.title}</div><div class="pp-grid">`;
          items.forEach((k) => {
            html += `<div class="pp-item"><span>${PARAM_LABELS[k] || k}</span><span>${formatParamValue(paramsObj[k], k)}</span></div>`;
          });
          html += `</div></div>`;
        });
        if (!readOnly) {
          html += `<div class="pp-actions">
      <button class="btn btn-secondary" id="ppCancelBtn">✕ Cancelar</button>
      <button class="btn btn-primary" id="ppConfirmBtn">${confirmLabel}</button>
    </div>`;
        }
        panel.innerHTML = html;
        getContent().prepend(panel);
        if (!readOnly) {
          panel.querySelector("#ppConfirmBtn").addEventListener("click", () => {
            panel.remove();
            onConfirm && onConfirm();
          });
          panel.querySelector("#ppCancelBtn").addEventListener("click", () => {
            panel.remove();
            onCancel && onCancel();
          });
        }
        return panel;
      }
