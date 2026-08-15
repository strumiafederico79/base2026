// ============================================================
// 14-pitch-correction.js — Pitch Correction UI
// Interfaz para aplicar corrección automática de pitch
// ============================================================

(function () {
  const PC_PANEL_ID = 'pitchCorrectionPanel';
  const PC_MODES = ['OFF', 'LIGHT', 'MEDIUM', 'STRONG'];

  function getAPI() {
    return typeof API === 'function' ? API() : (window.API ? window.API() : '');
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function showStatus(msg, type = 'info') {
    const statusEl = document.getElementById('pitchCorrectionStatus');
    if (!statusEl) return;
    
    statusEl.textContent = msg;
    statusEl.style.color = type === 'error' ? 'var(--clip-red)' : 
                           type === 'success' ? 'var(--vu-green)' :
                           type === 'warn' ? 'var(--amber)' : 'var(--text)';
  }

  function createPitchCorrectionPanel() {
    return `
      <div id="${PC_PANEL_ID}" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1.5rem;box-shadow:0 8px 32px rgba(0,0,0,0.3);min-width:400px;font-family:var(--ff-mono)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 style="margin:0">🎵 Pitch Correction</h3>
          <button id="pitchCorrectionClose" style="background:none;border:none;color:var(--text);font-size:1.2rem;cursor:pointer">✕</button>
        </div>

        <div style="margin-bottom:1rem">
          <label style="display:block;margin-bottom:.5rem;font-size:.85rem">📄 Input (File/Library)</label>
          <input type="file" id="pitchCorrectionFile" accept="audio/*" style="width:100%;padding:.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
          <div style="font-size:.7rem;color:var(--muted);margin-top:.3rem">o seleccionar de librería de stems</div>
          <select id="pitchCorrectionLibrary" style="width:100%;margin-top:.3rem;padding:.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
            <option value="">— No seleccionada —</option>
          </select>
        </div>

        <div style="margin-bottom:1rem">
          <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Mode</label>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem">
            ${PC_MODES.map(m => `
              <button class="pc-mode-btn" data-mode="${m}" style="padding:.5rem;background:var(--surface2);border:2px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;font-weight:${m==='MEDIUM'?'bold':'normal'};transition:all 200ms" 
                ${m==='MEDIUM'?' style="border-color:var(--amber);color:var(--amber);font-weight:bold"':''}>
                ${m}
              </button>
            `).join('')}
          </div>
          <div style="font-size:.7rem;color:var(--muted);margin-top:.3rem">
            OFF=desactivado | LIGHT=±20¢ | MEDIUM=±50¢ | STRONG=±100¢
          </div>
        </div>

        <div style="margin-bottom:1rem">
          <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Tonalidad (Scale)</label>
          <select id="pitchCorrectionScale" style="width:100%;padding:.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
            <option value="">— Auto-detect —</option>
            <option value="C_major">C Major</option>
            <option value="G_major">G Major</option>
            <option value="D_major">D Major</option>
            <option value="A_major">A Major</option>
            <option value="E_major">E Major</option>
            <option value="F_major">F Major</option>
            <option value="A_minor">A Minor</option>
            <option value="E_minor">E Minor</option>
            <option value="D_minor">D Minor</option>
          </select>
        </div>

        <div style="margin-bottom:1rem">
          <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Glide Time (ms)</label>
          <input type="range" id="pitchCorrectionGlide" min="0" max="200" value="50" style="width:100%">
          <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted)">
            <span>0ms</span>
            <span id="pitchCorrectionGlideVal">50ms</span>
            <span>200ms</span>
          </div>
        </div>

        <div style="margin-bottom:1rem">
          <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Output Format</label>
          <select id="pitchCorrectionFormat" style="width:100%;padding:.5rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text)">
            <option value="wav">WAV (24-bit)</option>
            <option value="flac">FLAC</option>
            <option value="mp3">MP3 (320kbps)</option>
          </select>
        </div>

        <div style="margin-bottom:1rem">
          <button id="pitchCorrectionApply" style="width:100%;padding:.75rem;background:var(--amber);color:#000;border:none;border-radius:4px;font-weight:bold;cursor:pointer;font-size:.9rem">
            ✓ Aplicar Pitch Correction
          </button>
        </div>

        <div id="pitchCorrectionStatus" style="font-size:.8rem;color:var(--text);min-height:1.5rem;word-wrap:break-word;overflow-wrap:break-word"></div>

        <div id="pitchCorrectionProgress" style="display:none;margin-top:1rem">
          <div style="background:var(--surface2);height:8px;border-radius:4px;overflow:hidden">
            <div id="pitchCorrectionProgressBar" style="height:100%;background:var(--vu-green);width:0%;transition:width 200ms"></div>
          </div>
          <div style="font-size:.7rem;color:var(--muted);margin-top:.3rem">Processing...</div>
        </div>
      </div>
    `;
  }

  function showPitchCorrectionPanel() {
    const panel = document.getElementById(PC_PANEL_ID);
    if (!panel) return;

    panel.style.display = 'block';

    // Cargar librería de stems
    loadPitchCorrectionLibrary();

    // Listeners
    document.getElementById('pitchCorrectionClose')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    document.querySelectorAll('.pc-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pc-mode-btn').forEach(b => {
          b.style.borderColor = 'var(--border)';
          b.style.color = 'var(--text)';
        });
        e.target.style.borderColor = 'var(--amber)';
        e.target.style.color = 'var(--amber)';
      });
    });

    document.getElementById('pitchCorrectionGlide')?.addEventListener('input', (e) => {
      document.getElementById('pitchCorrectionGlideVal').textContent = e.target.value + 'ms';
    });

    document.getElementById('pitchCorrectionApply')?.addEventListener('click', applyPitchCorrection);
  }

  function loadPitchCorrectionLibrary() {
    const select = document.getElementById('pitchCorrectionLibrary');
    if (!select) return;

    const token = getToken();
    const api = getAPI();

    fetch(`${api}/library/list`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.items)) {
          select.innerHTML = '<option value="">— No seleccionada —</option>' +
            data.items.slice(0, 20).map(item => 
              `<option value="${item.id}">${item.original_filename}</option>`
            ).join('');
        }
      })
      .catch(e => console.error('Error loading library:', e));
  }

  async function applyPitchCorrection() {
    showStatus('⏳ Iniciando...', 'info');

    const file = document.getElementById('pitchCorrectionFile')?.files[0];
    const libraryId = document.getElementById('pitchCorrectionLibrary')?.value;
    const mode = document.querySelector('.pc-mode-btn[data-selected="true"]')?.dataset.mode || 'MEDIUM';
    const scale = document.getElementById('pitchCorrectionScale')?.value || null;
    const glideTime = parseFloat(document.getElementById('pitchCorrectionGlide')?.value || 50);
    const format = document.getElementById('pitchCorrectionFormat')?.value || 'wav';

    if (!file && !libraryId) {
      showStatus('❌ Selecciona archivo o biblioteca', 'error');
      return;
    }

    const formData = new FormData();
    if (file) formData.append('file', file);
    if (libraryId) formData.append('library_id', libraryId);
    formData.append('mode', mode);
    if (scale) formData.append('scale', scale);
    formData.append('glide_time_ms', glideTime);
    formData.append('output_format', format);

    const token = getToken();
    const api = getAPI();

    try {
      showStatus('⏳ Procesando pitch correction...', 'info');
      document.getElementById('pitchCorrectionProgress').style.display = 'block';

      const response = await fetch(`${api}/pitch-correct`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Error desconocido');
      }

      // Extraer metadata del header
      const detectedKey = response.headers.get('X-Detected-Key') || 'desconocida';
      const confidence = parseFloat(response.headers.get('X-Confidence') || 0);

      // Descargar resultado
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `corrected.${format}`;
      a.click();

      showStatus(`✓ Completado: tonalidad=${detectedKey} (conf=${(confidence*100).toFixed(0)}%)`, 'success');
      document.getElementById('pitchCorrectionProgress').style.display = 'none';

    } catch (err) {
      showStatus(`❌ Error: ${err.message}`, 'error');
      console.error(err);
      document.getElementById('pitchCorrectionProgress').style.display = 'none';
    }
  }

  // Exportar API global
  window.pitchCorrectionUI = {
    show: showPitchCorrectionPanel,
    createPanel: createPitchCorrectionPanel,
  };

  // Auto-init: Agregar panel al body
  document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const div = document.createElement('div');
    div.innerHTML = createPitchCorrectionPanel();
    body.appendChild(div.firstElementChild);

    const trigger = document.getElementById('btnPitchCorrection');
    if (trigger) {
      trigger.addEventListener('click', () => showPitchCorrectionPanel());
    }
  });

})();
