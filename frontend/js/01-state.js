// ============================================================
// 01-state.js — Estado global, cache de colores, tema, IA estado
// ============================================================
      // ── State ─────────────────────────────────────────────────────────────────────
      const API = () => document.getElementById("apiUrl").value.replace(/\/$/, "");
      const MAX_FILE_BYTES = 300 * 1024 * 1024;

      // crypto.randomUUID() sólo existe en contextos seguros (HTTPS o localhost).
      // Serví por HTTP+IP (ej. http://104.128.64.125:5500) rompe esa función, así que
      // acá usamos randomUUID si está disponible y si no generamos un UUID v4 a mano.
      function genUUID() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }

      function formatDbValue(value, digits = 1) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return `${n >= 0 ? "+" : ""}${n.toFixed(digits)} dB`;
      }
      function formatLinearThresholdToDb(value, digits = 1) {
        const db = 20 * Math.log10(Math.max(Number(value), 1e-9));
        return `${db >= 0 ? "+" : ""}${db.toFixed(digits)} dB`;
      }

      let selectedFile = null;
      let cachedFileBuffer = null; // ArrayBuffer cacheado al seleccionar el archivo
      let _previewSessionId = null; // UUID que identifica el archivo actual en el caché del servidor
      let _previewLibraryId = null; // id del archivo en la librería persistente del servidor, si se eligió de ahí
      let currentJobId = null;
      let pollInterval = null;
      let downloadUrl = null;

      // ── Cache de colores del tema ────────────────────────────────────────────────
      // Las variables --bg/--accent/etc. son fijas (no hay theme switcher), así que
      // evitamos forzar un recálculo de estilos (getComputedStyle) en cada redibujo
      // de canvas (EQ curve, waveform, FFT) — se lee una sola vez y se reusa.
      let _themeColorsCache = null;
      function themeColors() {
        if (_themeColorsCache) return _themeColorsCache;
        const styles = getComputedStyle(document.documentElement);
        const read = (name) => styles.getPropertyValue(name).trim();
        _themeColorsCache = {
          bg: read("--bg"),
          surface: read("--surface"),
          surface2: read("--surface2"),
          border: read("--border"),
          accent: read("--accent"),
          accent2: read("--accent2"),
          green: read("--green"),
          yellow: read("--yellow"),
          red: read("--red"),
          text: read("--text"),
          muted: read("--muted"),
          get: (varName) => read(varName), // fallback para nombres arbitrarios tipo '--foo'
        };
        return _themeColorsCache;
      }

      // ── Nombre del tema para la descarga ────────────────────────────────────────
      function currentTrackNameParam() {
        const input = document.getElementById("trackNameInput");
        const val = ((input && input.value) || "").trim();
        return val ? `?name=${encodeURIComponent(val)}` : "";
      }
      function getTrackBaseName() {
        const input = document.getElementById("trackNameInput");
        const val = ((input && input.value) || "").trim();
        if (val) return val;
        if (selectedFile) return selectedFile.name.replace(/\.[^/.]+$/, "");
        return "reporte";
      }
      async function downloadReport(jobId) {
        try {
          const res = await fetch(`${API()}/report/${jobId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${getTrackBaseName()}_reporte.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (e) {
          alert("No se pudo descargar el reporte: " + e.message);
        }
      }
      function prefillTrackNameFromFile() {
        const input = document.getElementById("trackNameInput");
        if (!input || input.value.trim() || !selectedFile) return;
        const base = selectedFile.name.replace(/\.[^/.]+$/, "");
        input.value = base;
      }
      let abSnapshotA = null,
        abSnapshotB = null;
      let previewDebounceTimer = null,
        previewAbortController = null,
        previewAudioUrl = null,
        previewWS = null;
      let originalFFTCache = null;
      let previewBufs = { original: null, processed: null };
      let metersAudioCtx = null,
        metersSourceNode = null,
        metersAnalyserL = null,
        metersAnalyserR = null,
        metersRafId = null,
        metersSplitter = null;
      let metersLufsRingBuffer = [];
      const METERS_LUFS_WINDOW = 60;

      // ── Asistente de IA: estado ─────────────────────────────────────────────────
      let lastAnalysisData = null; // último dict de análisis (lufs, peak_db, spectrum, mix_advice, ...)
      let aiChatHistory = []; // [{role:'user'|'assistant', content:str}, ...]
      let aiAvailable = null; // null=sin chequear, true/false luego de /ai/status

      // ── Sliders ──────────────────────────────────────────────────────────────────
