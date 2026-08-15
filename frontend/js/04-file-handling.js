// ============================================================
// 04-file-handling.js — Carga de archivo, librería persistente, referencia
// ============================================================
      const dropZone = document.getElementById("dropZone");
      const fileInput = document.getElementById("fileInput");
      let uppy = null;
      if (window.Uppy && window.Uppy.Uppy && window.Uppy.FileInput) {
        fileInput.style.pointerEvents = "none";
        uppy = new window.Uppy.Uppy({
          autoProceed: false,
          allowMultipleUploads: false,
          restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ["audio/*"] },
        });
        uppy.use(window.Uppy.FileInput, {
          target: "#uppyPicker",
          pretty: true,
          locale: { filesSelected: { 0: "Elegir archivo", 1: "1 archivo seleccionado" } },
        });
        uppy.on("file-added", (file) => {
          if (file && file.data) setFile(file.data);
        });
        uppy.on("files-added", (files) => {
          const picked = Object.values(files || {}).find((f) => f && f.data);
          if (picked && picked.data) setFile(picked.data);
        });
      }
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) setFile(fileInput.files[0]);
      });

      function setFile(f, libraryId = null) {
        const warn = document.getElementById("fileSizeWarn");
        if (f.size > MAX_FILE_BYTES) {
          warn.textContent = `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo 300 MB`;
          return;
        }
        warn.textContent = "";
        selectedFile = f;
        _previewSessionId = genUUID();
        _previewLibraryId = libraryId;
        document.getElementById("fileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        ["btnMaster", "btnAnalyze", "btnAdvice", "btnAnalyzeGrid", "btnAdviceGrid", "btnSpectrum", "btnStems", "btnAB", "btnAutoMaster", "btnAiSuggest"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.disabled = false;
        });
        updateRefButtonState();
        document.getElementById("btnDownload").style.display = "none";
        document.getElementById("btnReport").style.display = "none";
        const trackNameInputEl = document.getElementById("trackNameInput");
        if (trackNameInputEl) {
          trackNameInputEl.value = "";
          trackNameInputEl.style.display = "none";
        }
        document.getElementById("emptyState")?.remove();
        clearResults();

        originalFFTCache = null;
        cachedFileBuffer = null;
        previewBufs = { original: null, processed: null };
        if (previewAudioUrl) {
          URL.revokeObjectURL(previewAudioUrl);
          previewAudioUrl = null;
        }
        document.getElementById("previewWrap").style.display = "none";
        document.getElementById("previewAudioWrap").innerHTML = "";
        hideLiveSpectrum();
        hideDynEqRecommendation();
        setPreviewStatus("En espera…");

        // 🔥 FIX 1: Detener el loop de meters anterior antes de crear uno nuevo
        teardownLiveMeters();

        loadFileBuffer(f);
        schedulePreview();

        if (!libraryId && document.getElementById("saveToLibraryChk")?.checked) {
          uploadCurrentFileToLibrary(f);
        }
      }

      // ... resto del archivo sin cambios ...
      // ── Librería persistente (archivos guardados en el servidor) ────────────────
      async function refreshLibraryList() {
        const listEl = document.getElementById("libraryList");
        try {
          const res = await fetch(`${API()}/library`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          renderLibraryList(data.files || []);
        } catch (e) {
          console.error("[librería] error al listar:", e);
          listEl.innerHTML = `<div style="opacity:.6;padding:6px 2px;">No se pudo cargar la librería.</div>`;
        }
      }

      function _formatLibraryDuration(sec) {
        if (sec == null) return "";
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
      }

      function renderLibraryList(files) {
        const listEl = document.getElementById("libraryList");
        if (!files.length) {
          listEl.innerHTML = `<div style="opacity:.6;padding:6px 2px;">Todavía no guardaste ningún archivo.</div>`;
          return;
        }
        listEl.innerHTML = "";
        for (const f of files) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:6px;padding:5px 2px;border-bottom:1px solid rgba(255,255,255,.06);";
          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;";
          info.title = f.original_filename;
          info.textContent = `${f.original_filename} — ${_formatLibraryDuration(f.duration_sec)}`;
          info.addEventListener("click", () => useLibraryFile(f.id, f.original_filename));
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.textContent = "🗑";
          delBtn.title = "Borrar de la librería";
          delBtn.style.cssText = "background:none;border:none;color:inherit;opacity:.6;cursor:pointer;flex-shrink:0;";
          delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`¿Borrar "${f.original_filename}" de la librería?`)) return;
            await deleteLibraryFile(f.id);
          });
          row.appendChild(info);
          row.appendChild(delBtn);
          listEl.appendChild(row);
        }
      }

      async function uploadCurrentFileToLibrary(f) {
        try {
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch(`${API()}/library/upload`, { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await refreshLibraryList();
        } catch (e) {
          // No es crítico para el flujo principal (mastering/preview siguen
          // funcionando con el archivo local) — solo se loguea.
          console.error("[librería] error al guardar:", e);
        }
      }

      async function useLibraryFile(fileId, filename) {
        const listEl = document.getElementById("libraryList");
        try {
          setPreviewStatus("Trayendo archivo de la librería…");
          const res = await fetch(`${API()}/library/${fileId}/download`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], filename, { type: blob.type });
          setFile(file, fileId); // libraryId != null → no se vuelve a subir en el preview
        } catch (e) {
          console.error("[librería] error al usar archivo:", e);
          alert("No se pudo traer el archivo de la librería.");
        }
      }

      async function deleteLibraryFile(fileId) {
        try {
          const res = await fetch(`${API()}/library/${fileId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
          await refreshLibraryList();
        } catch (e) {
          console.error("[librería] error al borrar:", e);
        }
      }

      document.getElementById("btnRefreshLibrary")?.addEventListener("click", refreshLibraryList);
      refreshLibraryList();

      async function loadFileBuffer(f) {
        cachedFileBuffer = await f.arrayBuffer(); // cachear para reusar en previews
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        try {
          const buf = await ctx.decodeAudioData(cachedFileBuffer.slice(0));
          previewBufs.original = buf;
          drawWaveform(buf);
          computeAndCacheOriginalFFT(buf);
          setupLiveMeters(buf);
        } finally {
          ctx.close();
        }
      }

      // ── Referencia (track de referencia para matching) ──────────────────────────
      let selectedRefFile = null;
      let selectedRefLibraryId = null;
      const dropZoneRef = document.getElementById("dropZoneRef");
      const refFileInput = document.getElementById("refFileInput");
      dropZoneRef.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZoneRef.classList.add("dragover");
      });
      dropZoneRef.addEventListener("dragleave", () => dropZoneRef.classList.remove("dragover"));
      dropZoneRef.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZoneRef.classList.remove("dragover");
        if (e.dataTransfer.files[0]) setRefFile(e.dataTransfer.files[0]);
      });
      refFileInput.addEventListener("change", () => {
        if (refFileInput.files[0]) setRefFile(refFileInput.files[0]);
      });

      function setRefFile(f, fromLibraryId = null) {
        if (f.size > MAX_FILE_BYTES) {
          document.getElementById("refFileName").textContent =
            `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo 300 MB`;
          return;
        }
        selectedRefFile = f;
        selectedRefLibraryId = fromLibraryId;
        window.selectedRefLibraryId = fromLibraryId || null;
        document.getElementById("refFileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        updateRefButtonState();
        // Si viene de la librería, no hay nada que subir/guardar de nuevo.
        if (!fromLibraryId && document.getElementById("saveRefToLibraryChk")?.checked) {
          uploadRefFileToLibrary(f);
        }
      }
      function updateRefButtonState() {
        document.getElementById("btnMasterRef").disabled = !(selectedFile && selectedRefFile);
      }

      async function uploadRefFileToLibrary(f) {
        try {
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch(`${API()}/library/upload`, { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await refreshLibraryList();
        } catch (e) {
          console.error("[librería] error al guardar referencia:", e);
        }
      }

      document.getElementById("toggleRefLibraryList").addEventListener("click", async (e) => {
        e.preventDefault();
        const el = document.getElementById("libraryListRef");
        const showing = el.style.display !== "none";
        if (showing) {
          el.style.display = "none";
          return;
        }
        el.style.display = "block";
        el.innerHTML = `<div style="opacity:.6;padding:6px 8px;font-size:0.68rem">Cargando…</div>`;
        try {
          const res = await fetch(`${API()}/library`);
          const data = await res.json();
          const files = data.files || [];
          if (!files.length) {
            el.innerHTML = `<div style="opacity:.6;padding:6px 8px;font-size:0.68rem">Todavía no guardaste ningún archivo.</div>`;
            return;
          }
          el.innerHTML = "";
          for (const lf of files) {
            const row = document.createElement("div");
            row.style.cssText =
              "padding:5px 8px;font-size:0.68rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            row.textContent = `${lf.original_filename} — ${_formatLibraryDuration(lf.duration_sec)}`;
            row.title = lf.original_filename;
            row.addEventListener("click", () => {
              document.getElementById("refFileName").textContent = `${lf.original_filename} (de tu librería)`;
              selectedRefFile = { name: lf.original_filename }; // placeholder: no se sube, va por library_id
              selectedRefLibraryId = lf.id;
              window.selectedRefLibraryId = lf.id; // exponer para el WS de preview
              updateRefButtonState();
              el.style.display = "none";
            });
            el.appendChild(row);
          }
        } catch (err) {
          el.innerHTML = `<div style="opacity:.6;padding:6px 8px;font-size:0.68rem">No se pudo cargar la librería.</div>`;
        }
      });

      // ── EQ Curve ─────────────────────────────────────────────────────────────────
