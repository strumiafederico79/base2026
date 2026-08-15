// ============================================================
// 12-lufs-normalize.js — Normalización pura por LUFS (sin ninguna otra etapa)
// Reusa selectedFile / _previewLibraryId ya seteados por el drop zone (04-file-handling.js).
// Pega directo al endpoint sync (/master/normalize/sync) y dispara la descarga del
// resultado — no hace falta el pipeline de polling porque es una sola ganancia,
// no un job pesado.
// ============================================================
(function () {
  const btn = document.getElementById("btnNormalizeLufs");
  const statusEl = document.getElementById("normalize-status");
  if (!btn) return;

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = kind === "error" ? "var(--danger, #f87171)"
                          : kind === "ok" ? "var(--accent2, #34d399)"
                          : "var(--muted)";
  }

  btn.addEventListener("click", async () => {
    if (!selectedFile && !_previewLibraryId) {
      setStatus("Seleccioná un archivo primero", "error");
      return;
    }

    const targetLufs = parseFloat(document.getElementById("s-normalize-lufs")?.value || "-14");

    const fd = new FormData();
    if (_previewLibraryId) {
      fd.append("library_id", _previewLibraryId);
    } else {
      fd.append("file", selectedFile);
    }

    btn.disabled = true;
    setStatus("Normalizando…", "queued");

    try {
      const params = new URLSearchParams({ target_lufs: targetLufs });
      const url = `${API()}/master/normalize/sync?${params.toString()}`;
      const res = await fetch(url, { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const outputLufs = res.headers.get("X-Output-LUFS");
      const blob = await res.blob();

      // Nombre de archivo desde Content-Disposition si viene, si no un default
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      const filename = match ? match[1] : "normalized.wav";

      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);

      setStatus(`✅ Listo — quedó en ${outputLufs ?? "?"} LUFS. Descarga iniciada.`, "ok");
    } catch (e) {
      console.error("❌ Error al normalizar:", e);
      setStatus("Error: " + e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
})();
