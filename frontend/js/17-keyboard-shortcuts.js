// ============================================================
// 17-keyboard-shortcuts.js — Atajos de teclado profesionales
// ============================================================

(function () {
  "use strict";

  const SHORTCUTS = {
    // Análisis y masterización
    'ctrl+shift+a': {
      label: 'Analizar',
      description: 'Ejecutar análisis del archivo cargado',
      handler: () => document.getElementById('btnAnalyze')?.click(),
    },
    'ctrl+shift+r': {
      label: 'Recomendaciones',
      description: 'Obtener recomendaciones de IA',
      handler: () => document.getElementById('btnAdvice')?.click(),
    },
    'ctrl+shift+m': {
      label: 'Master (Sync)',
      description: 'Masterizar sincrónico',
      handler: () => document.getElementById('btnMasterSync')?.click(),
    },
    'ctrl+shift+q': {
      label: 'Master (Queue)',
      description: 'Encolar mastering',
      handler: () => document.getElementById('btnMasterAsync')?.click(),
    },
    'ctrl+shift+p': {
      label: 'Pitch Correction',
      description: 'Corregir pitch',
      handler: () => document.getElementById('btnPitchCorrection')?.click(),
    },

    // Normalización
    'ctrl+shift+l': {
      label: 'Normalizar LUFS',
      description: 'Normalizar por LUFS',
      handler: () => document.getElementById('btnNormalizeLufs')?.click(),
    },

    // Edición
    'ctrl+z': {
      label: 'Undo',
      description: 'Deshacer último cambio',
      handler: () => window.undoLastChange?.(),
    },
    'ctrl+shift+z': {
      label: 'Redo',
      description: 'Rehacer cambio',
      handler: () => window.redoLastChange?.(),
    },

    // Reproducción
    ' ': {
      label: 'Play/Pause',
      description: 'Reproducir o pausar audio',
      handler: () => window.togglePlayback?.(),
      preventDefault: true,
    },

    // A/B Comparison
    'ctrl+b': {
      label: 'Toggle A/B',
      description: 'Alternar comparación A/B',
      handler: () => window.toggleABComparison?.(),
    },

    // Presets
    'ctrl+s': {
      label: 'Guardar Preset',
      description: 'Guardar configuración actual como preset',
      handler: () => window.saveCurrentPreset?.(),
    },

    // Temas
    'ctrl+t': {
      label: 'Alternar Tema',
      description: 'Cambiar entre temas claro/oscuro',
      handler: () => window.toggleTheme?.(),
    },

    // Help
    '?': {
      label: 'Mostrar Atajos',
      description: 'Mostrar lista de atajos de teclado',
      handler: () => window.showKeyboardShortcuts(),
      preventDefault: true,
    },

    // Referencia rápida
    'r': {
      label: 'Cargar Referencia',
      description: 'Focus en selector de referencia',
      handler: () => {
        document.getElementById('refFileInput')?.focus();
      },
    },

    // Parámetro Ajustes
    'up': {
      label: 'Incrementar Parámetro',
      description: 'Aumentar el parámetro enfocado',
      handler: (e) => adjustFocusedSlider(1, e),
    },
    'down': {
      label: 'Decrementar Parámetro',
      description: 'Disminuir el parámetro enfocado',
      handler: (e) => adjustFocusedSlider(-1, e),
    },
  };

  // ── Normalizar combinación de teclas ──
  function normalizeShortcut(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    
    let key = e.key.toLowerCase();
    if (key === ' ') key = ' ';
    if (key.length === 1) {
      parts.push(key);
    } else if (e.code) {
      parts.push(e.code.toLowerCase());
    }

    return parts.join('+');
  }

  // ── Registrar event listener global ──
  function setupKeyboardShortcuts() {
    const focusableInputs = new Set(['input', 'textarea', 'select']);
    const excludeAdjustement = new Set(['input', 'textarea']);

    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInput = focusableInputs.has(activeTag) && !e.ctrlKey && !e.metaKey;

      // No ejecutar atajos si estamos escribiendo en un input (a menos que sea Ctrl+algo)
      if (isInput && !['ctrl+z', 'ctrl+shift+z'].includes(normalizeShortcut(e))) {
        return;
      }

      const shortcut = normalizeShortcut(e);
      const action = SHORTCUTS[shortcut];

      if (action) {
        if (action.preventDefault !== false && !isInput) {
          e.preventDefault();
        }

        try {
          action.handler(e);
          window.announceToScreenReader?.(`Atalajo ejecutado: ${action.label}`, 'assertive');
        } catch (err) {
          console.error(`Error executing shortcut "${shortcut}":`, err);
          window.showToast?.(`Error ejecutando atajo: ${err.message}`, 'error');
        }
      }
    });
  }

  // ── Mostrar lista de atajos ──
  window.showKeyboardShortcuts = function() {
    let modal = document.getElementById('keyboard-shortcuts-modal');
    if (modal) {
      modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
      return;
    }

    modal = document.createElement('div');
    modal.id = 'keyboard-shortcuts-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Atajos de teclado');
    modal.setAttribute('aria-modal', 'true');

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9998;
      backdrop-filter: blur(4px);
    `;
    overlay.addEventListener('click', () => modal.remove());

    const content = document.createElement('div');
    content.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 600px;
      max-height: 70vh;
      overflow-y: auto;
      z-index: 9999;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      color: var(--text);
      font-family: var(--sans);
    `;

    const title = document.createElement('h2');
    title.textContent = '⌨️ Atajos de Teclado';
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 1.5em; color: var(--accent);';
    content.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'display: grid; gap: 12px;';

    Object.entries(SHORTCUTS).forEach(([combo, action]) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: grid;
        grid-template-columns: 140px 1fr;
        gap: 16px;
        padding: 8px;
        border-left: 3px solid var(--accent);
        padding-left: 12px;
      `;

      const kbd = document.createElement('kbd');
      kbd.style.cssText = `
        background: var(--surface3);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 8px;
        font-family: monospace;
        font-size: 0.9em;
        white-space: nowrap;
        text-transform: uppercase;
      `;
      kbd.textContent = combo;

      const desc = document.createElement('div');
      desc.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';
      
      const label = document.createElement('strong');
      label.textContent = action.label;
      label.style.color = 'var(--text)';
      
      const explanation = document.createElement('small');
      explanation.textContent = action.description;
      explanation.style.color = 'var(--muted)';

      desc.appendChild(label);
      desc.appendChild(explanation);

      item.appendChild(kbd);
      item.appendChild(desc);
      list.appendChild(item);
    });

    content.appendChild(list);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Cerrar';
    closeBtn.style.cssText = `
      margin-top: 16px;
      padding: 8px 16px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      width: 100%;
    `;
    closeBtn.addEventListener('click', () => modal.remove());
    content.appendChild(closeBtn);

    modal.appendChild(overlay);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Close on Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Anunciar a screen readers
    window.announceToScreenReader?.('Atajos de teclado abiertos. Presiona Escape para cerrar.', 'polite');
  };

  // ── Ajustar slider enfocado ──
  function adjustFocusedSlider(direction, e) {
    const focused = document.activeElement;
    if (focused?.type === 'range') {
      e.preventDefault();
      const step = parseFloat(focused.step) || 1;
      const currentValue = parseFloat(focused.value);
      const newValue = currentValue + (step * direction);
      
      const min = parseFloat(focused.min);
      const max = parseFloat(focused.max);
      
      focused.value = Math.max(min, Math.min(max, newValue));
      focused.dispatchEvent(new Event('input', { bubbles: true }));
      focused.dispatchEvent(new Event('change', { bubbles: true }));

      window.announceToScreenReader?.(`${focused.getAttribute('aria-label')}: ${newValue}`, 'assertive');
    }
  }

  // ── Help indicator ──
  function addHelpIndicator() {
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      padding: 8px 12px;
      background: var(--surface3);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.85em;
      color: var(--muted);
      z-index: 9997;
      cursor: help;
    `;
    indicator.textContent = 'Presiona ? para ver atajos';
    indicator.addEventListener('click', window.showKeyboardShortcuts);
    indicator.addEventListener('mouseenter', () => {
      indicator.style.background = 'var(--surface2)';
      indicator.style.color = 'var(--text)';
    });
    indicator.addEventListener('mouseleave', () => {
      indicator.style.background = 'var(--surface3)';
      indicator.style.color = 'var(--muted)';
    });
    document.body.appendChild(indicator);
  }

  // ── Inicializar ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupKeyboardShortcuts();
      addHelpIndicator();
    });
  } else {
    setupKeyboardShortcuts();
    addHelpIndicator();
  }

  // Exportar para pruebas
  window.KEYBOARD_SHORTCUTS = SHORTCUTS;

})();
