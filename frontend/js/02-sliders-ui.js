// ============================================================
// 02-sliders-ui.js — Sliders, tabs multiband, workflow rail
// ============================================================
      const sliders = [
        ["s-ingain", "v-ingain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        [
          "s-peak",
          "v-peak",
          (v) => {
            const db = 20 * Math.log10(Math.max(Number(v), 1e-9));
            return (db >= 0 ? "+" : "") + db.toFixed(1) + " dBTP";
          },
        ],
        ["s-lufstarget", "v-lufstarget", (v) => v.toFixed(1) + " LUFS"],
        ["s-thresh", "v-thresh", (v) => formatDbValue(v)],
        ["s-ratio", "v-ratio", (v) => v.toFixed(1) + ":1"],
        ["s-cattack", "v-cattack", (v) => v.toFixed(1) + " ms"],
        ["s-crelease", "v-crelease", (v) => Math.round(v) + " ms"],
        ["s-cmakeup", "v-cmakeup", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-glue-thresh", "v-glue-thresh", (v) => formatDbValue(v)],
        ["s-glue-ratio", "v-glue-ratio", (v) => v.toFixed(1) + ":1"],
        ["s-glue-attack", "v-glue-attack", (v) => v.toFixed(1) + " ms"],
        ["s-glue-release", "v-glue-release", (v) => Math.round(v) + " ms"],
        ["s-glue-makeup", "v-glue-makeup", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-glue-pdr-hold", "v-glue-pdr-hold", (v) => Math.round(v) + " ms"],
        // Compresión paralela
        ["parallelMix", "parallelMixVal", (v) => v.toFixed(2)],
        ["parallelThresh", "parallelThreshVal", (v) => formatDbValue(v)],
        ["parallelRatio", "parallelRatioVal", (v) => v.toFixed(1) + ":1"],
        ["parallelAttack", "parallelAttackVal", (v) => v.toFixed(1) + " ms"],
        ["parallelRelease", "parallelReleaseVal", (v) => Math.round(v) + " ms"],
        ["s-hp", "v-hp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-eq1freq", "v-eq1freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq1gain", "v-eq1gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq1q", "v-eq1q", (v) => v.toFixed(1)],
        ["s-eq2freq", "v-eq2freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq2gain", "v-eq2gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq2q", "v-eq2q", (v) => v.toFixed(1)],
        ["s-eq3freq", "v-eq3freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq3gain", "v-eq3gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq3q", "v-eq3q", (v) => v.toFixed(1)],
        ["s-eq4freq", "v-eq4freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq4gain", "v-eq4gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq4q", "v-eq4q", (v) => v.toFixed(1)],
        ["s-eq5freq", "v-eq5freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq5gain", "v-eq5gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq5q", "v-eq5q", (v) => v.toFixed(1)],
        ["s-eq6freq", "v-eq6freq-disp", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-eq6gain", "v-eq6gain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-eq6q", "v-eq6q", (v) => v.toFixed(1)],
        ["s-tonalbal-amount", "v-tonalbal-amount", (v) => v.toFixed(2)],
        ["s-tonalbal-boost", "v-tonalbal-boost", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-tonalbal-cut", "v-tonalbal-cut", (v) => v.toFixed(1) + " dB"],
        ["s-tonalbal-bands", "v-tonalbal-bands", (v) => Math.round(v).toString()],
        ["s-air", "v-air", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-shelf-freq", "v-shelf-freq", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-lowshelf", "v-lowshelf", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-lowshelf-freq", "v-lowshelf-freq", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-comp-pdr-hold", "v-comp-pdr-hold", (v) => Math.round(v) + " ms"],
        ["s-mb-sw-lowx", "v-mb-sw-lowx", (v) => v + " Hz"],
        ["s-mb-sw-highx", "v-mb-sw-highx", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-mb-sw-low", "v-mb-sw-low", (v) => parseFloat(v).toFixed(2) + "x"],
        ["s-mb-sw-mid", "v-mb-sw-mid", (v) => parseFloat(v).toFixed(2) + "x"],
        ["s-mb-sw-high", "v-mb-sw-high", (v) => parseFloat(v).toFixed(2) + "x"],
        ["s-tatt", "v-tatt", (v) => (v >= 0 ? "+" : "") + v.toFixed(2)],
        ["s-tsus", "v-tsus", (v) => (v >= 0 ? "+" : "") + v.toFixed(2)],
        ["s-satdrive", "v-satdrive", (v) => Math.round(v * 100) + "%"],
        ["s-satmix", "v-satmix", (v) => Math.round(v * 100) + "%"],
        ["s-mgain", "v-mgain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-sgain", "v-sgain", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-width", "v-width", (v) => parseFloat(v).toFixed(2) + "x"],
        ["s-haas", "v-haas", (v) => parseFloat(v).toFixed(1) + " ms"],
        ["s-bassmono", "v-bassmono", (v) => Math.round(v) + " Hz"],
        ["s-rsize", "v-rsize", (v) => parseFloat(v).toFixed(2)],
        ["s-rwet", "v-rwet", (v) => Math.round(v * 100) + "%"],
        [
          "s-ceiling",
          "v-ceiling",
          (v) => {
            const db = 20 * Math.log10(Math.max(Number(v), 1e-9));
            return (db >= 0 ? "+" : "") + db.toFixed(1) + " dBTP";
          },
        ],
        ["s-lrelease", "v-lrelease", (v) => Math.round(v) + " ms"],
        // Multiband
        ["s-mb-lowx", "v-mb-lowx", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-dyneq-freq", "v-dyneq-freq", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-dyneq-q", "v-dyneq-q", (v) => parseFloat(v).toFixed(1)],
        ["s-dyneq-thresh", "v-dyneq-thresh", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-dyneq-ratio", "v-dyneq-ratio", (v) => parseFloat(v).toFixed(1) + ":1"],
        ["s-dyneq-attack", "v-dyneq-attack", (v) => parseFloat(v).toFixed(1) + " ms"],
        ["s-dyneq-release", "v-dyneq-release", (v) => Math.round(v) + " ms"],
        ["s-dyneq-maxred", "v-dyneq-maxred", (v) => parseFloat(v).toFixed(1) + " dB"],
        ["s-mono-freq", "v-mono-freq", (v) => Math.round(v) + " Hz"],
        ["s-mono-amount", "v-mono-amount", (v) => Math.round(v * 100) + "%"],
        ["s-lp-taps", "v-lp-taps", (v) => Math.round(v)],
        ["s-mb-highx", "v-mb-highx", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz")],
        ["s-mb-low-th", "v-mb-low-th", (v) => formatDbValue(v)],
        ["s-mb-low-ratio", "v-mb-low-ratio", (v) => v.toFixed(1) + ":1"],
        ["s-mb-low-att", "v-mb-low-att", (v) => v.toFixed(1) + " ms"],
        ["s-mb-low-rel", "v-mb-low-rel", (v) => Math.round(v) + " ms"],
        ["s-mb-low-mu", "v-mb-low-mu", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-mb-mid-th", "v-mb-mid-th", (v) => formatDbValue(v)],
        ["s-mb-mid-ratio", "v-mb-mid-ratio", (v) => v.toFixed(1) + ":1"],
        ["s-mb-mid-att", "v-mb-mid-att", (v) => v.toFixed(1) + " ms"],
        ["s-mb-mid-rel", "v-mb-mid-rel", (v) => Math.round(v) + " ms"],
        ["s-mb-mid-mu", "v-mb-mid-mu", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-mb-high-th", "v-mb-high-th", (v) => formatDbValue(v)],
        ["s-mb-high-ratio", "v-mb-high-ratio", (v) => v.toFixed(1) + ":1"],
        ["s-mb-high-att", "v-mb-high-att", (v) => v.toFixed(1) + " ms"],
        ["s-mb-high-rel", "v-mb-high-rel", (v) => Math.round(v) + " ms"],
        ["s-mb-high-mu", "v-mb-high-mu", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB"],
        ["s-mb-pdr-hold", "v-mb-pdr-hold", (v) => Math.round(v) + " ms"],
        // Reference matching
        ["s-ref-boost", "v-ref-boost", (v) => "+" + v.toFixed(1) + " dB"],
        ["s-ref-cut", "v-ref-cut", (v) => v.toFixed(1) + " dB"],
        ["s-ref-dynmargin", "v-ref-dynmargin", (v) => v.toFixed(1) + " dB"],
        ["s-ref-stereoblend", "v-ref-stereoblend", (v) => Math.round(v) + "%"],
        // band EQ sliders are dynamic — synced individually in refBandEQ module
        // Low-pass
        ["s-lp-cutoff", "v-lp-cutoff", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        // Noise reduction
        ["s-nr-strength", "v-nr-strength", (v) => parseFloat(v).toFixed(2)],
        ["s-nr-noise-sample-sec", "v-nr-noise-sample-sec", (v) => parseFloat(v).toFixed(1) + " s"],
        // Dynamic EQ resonancias
        ["s-reso-freq", "v-reso-freq", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz")],
        ["s-reso-q", "v-reso-q", (v) => parseFloat(v).toFixed(1)],
        ["s-reso-thresh", "v-reso-thresh", (v) => parseFloat(v).toFixed(1) + " dB"],
        ["s-reso-ratio", "v-reso-ratio", (v) => parseFloat(v).toFixed(1) + ":1"],
        ["s-reso-attack", "v-reso-attack", (v) => parseFloat(v).toFixed(1) + " ms"],
        ["s-reso-release", "v-reso-release", (v) => Math.round(v) + " ms"],
        ["s-reso-maxred", "v-reso-maxred", (v) => parseFloat(v).toFixed(1) + " dB"],
        // M/S EQ
        [
          "s-mseq-mid-freq",
          "v-mseq-mid-freq",
          (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"),
        ],
        ["s-mseq-mid-gain", "v-mseq-mid-gain", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-mseq-mid-q", "v-mseq-mid-q", (v) => parseFloat(v).toFixed(1)],
        [
          "s-mseq-side-freq",
          "v-mseq-side-freq",
          (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"),
        ],
        ["s-mseq-side-gain", "v-mseq-side-gain", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-mseq-side-q", "v-mseq-side-q", (v) => parseFloat(v).toFixed(1)],
        // Compresor M/S
        ["s-mscomp-mid-thresh", "v-mscomp-mid-thresh", (v) => parseFloat(v).toFixed(1) + " dB"],
        ["s-mscomp-mid-ratio", "v-mscomp-mid-ratio", (v) => parseFloat(v).toFixed(1) + ":1"],
        ["s-mscomp-mid-attack", "v-mscomp-mid-attack", (v) => parseFloat(v).toFixed(1) + " ms"],
        ["s-mscomp-mid-release", "v-mscomp-mid-release", (v) => Math.round(v) + " ms"],
        ["s-mscomp-mid-makeup", "v-mscomp-mid-makeup", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-mscomp-side-thresh", "v-mscomp-side-thresh", (v) => parseFloat(v).toFixed(1) + " dB"],
        ["s-mscomp-side-ratio", "v-mscomp-side-ratio", (v) => parseFloat(v).toFixed(1) + ":1"],
        ["s-mscomp-side-attack", "v-mscomp-side-attack", (v) => parseFloat(v).toFixed(1) + " ms"],
        ["s-mscomp-side-release", "v-mscomp-side-release", (v) => Math.round(v) + " ms"],
        ["s-mscomp-side-makeup", "v-mscomp-side-makeup", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
        ["s-mscomp-pdr-hold", "v-mscomp-pdr-hold", (v) => Math.round(v) + " ms"],
        // Clipper
        ["s-clip-ceiling", "v-clip-ceiling", (v) => parseFloat(v).toFixed(2)],
        ["s-clip-drive", "v-clip-drive", (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB"],
      ];
      sliders.forEach(([sid, vid, fmt]) => {
        const s = document.getElementById(sid),
          v = document.getElementById(vid);
        if (!s || !v) return;
        s.addEventListener("input", () => {
          v.textContent = fmt(parseFloat(s.value));
        });
      });

      // ── Multiband tabs ──────────────────────────────────────────────────────────
      document.querySelectorAll(".mb-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".mb-tab").forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          const band = tab.dataset.band;
          document.querySelectorAll(".mb-panel").forEach((p) => p.classList.remove("active"));
          document.getElementById("mb-panel-" + band).classList.add("active");
        });
      });

      // ── Workflow rail / etapas ─────────────────────────────────────────────────
      const workflowCards = Array.from(document.querySelectorAll(".process-card-collapsible"));
      const workflowChips = Array.from(document.querySelectorAll(".workflow-chip"));
      function syncWorkflowState() {
        const openIndex = workflowCards.findIndex((card) => card.open);
        const currentIndex = openIndex >= 0 ? openIndex : 0;
        workflowChips.forEach((chip, index) => {
          chip.classList.toggle("active", index === currentIndex);
          chip.classList.toggle("done", index < currentIndex);
          chip.style.cursor = "pointer";
        });
      }
      workflowCards.forEach((card, index) => {
        card.addEventListener("toggle", syncWorkflowState);
        card.dataset.stageIndex = index;
      });
      workflowChips.forEach((chip, index) => {
        chip.addEventListener("click", () => {
          workflowCards.forEach((card, cardIndex) => {
            card.open = cardIndex === index;
          });
          syncWorkflowState();
        });
      });
      syncWorkflowState();

      // ── Presets ──────────────────────────────────────────────────────────────────
