// reference-library-picker.js
// Selector de referencias permanentes desde /reference-library
// Integrar al final de 08-reference-mastering.js o cargarlo como script separado.

(function () {
  // ── Estado ────────────────────────────────────────────────────────────────
  let _entries = [];       // lista de referencias indexadas
  let _filtered = [];      // resultado del filtro de búsqueda
  let _selected = null;    // entry seleccionada actualmente

  // ── Elementos DOM (se crean al llamar init()) ─────────────────────────────
  let _modal, _searchInput, _listEl, _statusEl;

  // ── Cargar índice desde el servidor ──────────────────────────────────────
  async function loadLibrary() {
    try {
      const res = await fetch(`${API()}/reference-library`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _entries = data.entries || [];
      _filtered = [..._entries];
      _renderList();
      _statusEl.textContent = _entries.length
        ? `${_entries.length} referencia${_entries.length !== 1 ? "s" : ""} disponible${_entries.length !== 1 ? "s" : ""}`
        : "La carpeta reference_library/ está vacía. Agregá WAV/MP3/FLAC.";
    } catch (e) {
      _statusEl.textContent = "Error cargando la biblioteca: " + e.message;
    }
  }

  // ── Filtrar por búsqueda ──────────────────────────────────────────────────
  function _applySearch(q) {
    q = q.trim().toLowerCase();
    _filtered = q
      ? _entries.filter((e) => e.filename.toLowerCase().includes(q))
      : [..._entries];
    _renderList();
  }

  // ── Renderizar lista ──────────────────────────────────────────────────────
  function _renderList() {
    _listEl.innerHTML = "";
    if (!_filtered.length) {
      _listEl.innerHTML = `<div style="padding:.8rem;color:var(--muted);font-size:.8rem;text-align:center">Sin resultados</div>`;
      return;
    }
    _filtered.forEach((entry) => {
      const isSelected = _selected && _selected.id === entry.id;
      const dur = entry.duration_sec != null
        ? Math.floor(entry.duration_sec / 60) + ":" + String(Math.floor(entry.duration_sec % 60)).padStart(2, "0")
        : "--";
      const lufs = entry.lufs != null ? entry.lufs.toFixed(1) + " LUFS" : "--";
      const peak = entry.peak_db != null ? entry.peak_db.toFixed(1) + " dBFS" : "--";

      const row = document.createElement("div");
      row.className = "ref-lib-row" + (isSelected ? " ref-lib-row--selected" : "");
      row.innerHTML = `
        <div class="ref-lib-name">${entry.filename}</div>
        <div class="ref-lib-meta">
          <span>${dur}</span>
          <span>${lufs}</span>
          <span>${peak}</span>
          <span>${entry.sr ? (entry.sr / 1000).toFixed(1) + "kHz" : ""}</span>
        </div>
      `;
      row.addEventListener("click", () => _selectEntry(entry));
      _listEl.appendChild(row);
    });
  }

  // ── Seleccionar una referencia ────────────────────────────────────────────
  function _selectEntry(entry) {
    _selected = entry;

    // Actualizar variable global que usa 08-reference-mastering.js
    window.selectedRefLibraryId = entry.id;
    window.selectedRefFile = null;       // anular el File subido a mano

    // Mostrar nombre seleccionado en el label del input de referencia
    const label = document.getElementById("refFileLabel") || document.getElementById("ref-file-label");
    if (label) label.textContent = "📌 " + entry.filename;

    // Invalidar caché de sesión del WS de ref-preview
    if (typeof window._onRefFileSelectedRef === "function") window._onRefFileSelectedRef();

    // Cerrar modal
    _closeModal();

    // Actualizar botón de preview/submit
    if (typeof updateRefPreviewBtn === "function") updateRefPreviewBtn();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function _buildModal() {
    if (_modal) return;
    _modal = document.createElement("div");
    _modal.id = "refLibModal";
    _modal.innerHTML = `
      <div class="ref-lib-backdrop"></div>
      <div class="ref-lib-dialog">
        <div class="ref-lib-header">
          <span>📚 Biblioteca de referencias</span>
          <button class="ref-lib-close" id="refLibClose" title="Cerrar">✕</button>
        </div>
        <div class="ref-lib-toolbar">
          <input type="text" id="refLibSearch" placeholder="Buscar por nombre…" autocomplete="off" />
          <button class="btn btn-secondary btn-sm" id="refLibRescan" title="Re-escanear carpeta">↺ Actualizar</button>
        </div>
        <div class="ref-lib-status" id="refLibStatus">Cargando…</div>
        <div class="ref-lib-list" id="refLibList"></div>
        <div class="ref-lib-footer">
          <span style="font-size:.72rem;color:var(--muted)">
            Poné tus tracks de referencia en <code>reference_library/</code> en el servidor.
            Se indexan automáticamente.
          </span>
        </div>
      </div>
    `;
    document.body.appendChild(_modal);

    _searchInput = _modal.querySelector("#refLibSearch");
    _listEl      = _modal.querySelector("#refLibList");
    _statusEl    = _modal.querySelector("#refLibStatus");

    _modal.querySelector("#refLibClose").addEventListener("click", _closeModal);
    _modal.querySelector(".ref-lib-backdrop").addEventListener("click", _closeModal);
    _searchInput.addEventListener("input", (e) => _applySearch(e.target.value));
    _modal.querySelector("#refLibRescan").addEventListener("click", async () => {
      _statusEl.textContent = "Re-escaneando…";
      try {
        await fetch(`${API()}/reference-library/rescan`, { method: "POST" });
        await loadLibrary();
      } catch (e) {
        _statusEl.textContent = "Error: " + e.message;
      }
    });

    // Estilos inline para no depender de styles.css
    const style = document.createElement("style");
    style.textContent = `
      #refLibModal { position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center }
      .ref-lib-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(3px) }
      .ref-lib-dialog { position:relative;width:min(560px,95vw);max-height:80vh;display:flex;flex-direction:column;
        background:var(--surface,#13131f);border:1px solid var(--border,#2a2a3e);border-radius:10px;
        box-shadow:0 24px 64px #0008;overflow:hidden }
      .ref-lib-header { display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;
        font-size:.85rem;font-weight:600;border-bottom:1px solid var(--border,#2a2a3e) }
      .ref-lib-close { background:none;border:none;cursor:pointer;color:var(--muted);font-size:1rem;padding:.2rem .4rem }
      .ref-lib-toolbar { display:flex;gap:.5rem;padding:.6rem 1rem;border-bottom:1px solid var(--border,#2a2a3e) }
      .ref-lib-toolbar input { flex:1;background:var(--surface2,#1a1a2e);border:1px solid var(--border,#2a2a3e);
        border-radius:6px;padding:.35rem .7rem;color:inherit;font-size:.82rem;outline:none }
      .ref-lib-toolbar input:focus { border-color:var(--accent,#7c3aed) }
      .ref-lib-status { padding:.4rem 1rem;font-size:.75rem;color:var(--muted);border-bottom:1px solid var(--border,#2a2a3e) }
      .ref-lib-list { flex:1;overflow-y:auto;min-height:0 }
      .ref-lib-row { padding:.55rem 1rem;cursor:pointer;border-bottom:1px solid var(--border,#2a2a3e);transition:background .12s }
      .ref-lib-row:hover { background:var(--surface2,#1a1a2e) }
      .ref-lib-row--selected { background:color-mix(in srgb,var(--accent,#7c3aed) 18%,transparent);
        border-left:3px solid var(--accent,#7c3aed) }
      .ref-lib-name { font-size:.8rem;font-weight:500;margin-bottom:.2rem;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
      .ref-lib-meta { display:flex;gap:.8rem;font-size:.7rem;color:var(--muted);font-family:var(--mono) }
      .ref-lib-footer { padding:.55rem 1rem;border-top:1px solid var(--border,#2a2a3e);font-size:.72rem }
      .ref-lib-footer code { background:var(--surface2);padding:.1rem .3rem;border-radius:3px;font-size:.7rem }
    `;
    document.head.appendChild(style);
  }

  function _openModal() {
    _buildModal();
    _modal.style.display = "flex";
    _searchInput.value = "";
    _filtered = [..._entries];
    _renderList();
    loadLibrary();              // refrescar lista al abrir
    setTimeout(() => _searchInput.focus(), 80);
  }

  function _closeModal() {
    if (_modal) _modal.style.display = "none";
  }

  // ── Botón que abre el modal (se inserta junto al input de referencia) ──────
  function _injectButton() {
    // Buscar el label/botón del archivo de referencia
    const refInput = document.getElementById("refFileInput") || document.querySelector("input[id*='ref'][type='file']");
    if (!refInput) return;

    const btn = document.createElement("button");
    btn.className = "btn btn-secondary btn-sm";
    btn.id = "btnOpenRefLib";
    btn.style.cssText = "margin-top:.3rem;width:100%;font-size:.78rem";
    btn.textContent = "📚 Elegir desde biblioteca de referencias";
    btn.addEventListener("click", (e) => { e.preventDefault(); _openModal(); });

    // Insertar después del input de referencia (o su wrapper)
    const wrapper = refInput.closest(".file-drop-zone, .file-input-wrap, .param") || refInput.parentElement;
    wrapper.insertAdjacentElement("afterend", btn);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _injectButton();
    // Pre-cargar la lista en background para que el modal abra instantáneo
    loadLibrary().catch(() => {});
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }

  // API pública (por si se necesita desde afuera)
  window.refLibPicker = { open: _openModal, reload: loadLibrary };
})();
