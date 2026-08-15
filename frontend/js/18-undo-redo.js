// ============================================================
// 18-undo-redo.js — Historial de cambios (undo/redo)
// ============================================================

(function () {
  "use strict";

  class UndoRedoManager {
    constructor(maxStates = 50) {
      this.maxStates = maxStates;
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = null;
      this.listeners = [];
    }

    // Guardar estado actual
    saveState(state, label = 'Change') {
      const next = JSON.parse(JSON.stringify(state));
      if (this.currentState !== null) {
        this.undoStack.push({
          state: JSON.parse(JSON.stringify(this.currentState)),
          label,
          timestamp: Date.now(),
        });
        if (this.undoStack.length > this.maxStates) this.undoStack.shift();
      }
      this.redoStack = [];
      this.currentState = next;
      this.notifyListeners();
    }

    undo() {
      if (this.undoStack.length === 0) return null;
      this.redoStack.push({
        state: JSON.parse(JSON.stringify(this.currentState)),
        label: 'Redo',
        timestamp: Date.now(),
      });
      const previousState = this.undoStack.pop();
      this.currentState = JSON.parse(JSON.stringify(previousState.state));
      this.notifyListeners();
      return previousState;
    }

    redo() {
      if (this.redoStack.length === 0) return null;
      this.undoStack.push({
        state: JSON.parse(JSON.stringify(this.currentState)),
        label: 'Undo',
        timestamp: Date.now(),
      });
      const nextState = this.redoStack.pop();
      this.currentState = JSON.parse(JSON.stringify(nextState.state));
      this.notifyListeners();
      return nextState;
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    getHistory() {
      return {
        undo: this.undoStack.map(s => ({ label: s.label, timestamp: s.timestamp })),
        redo: this.redoStack.map(s => ({ label: s.label, timestamp: s.timestamp })),
      };
    }

    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = null;
      this.notifyListeners();
    }

    onChange(callback) {
      this.listeners.push(callback);
    }

    notifyListeners() {
      this.listeners.forEach(cb => {
        try {
          cb({
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            history: this.getHistory(),
          });
        } catch (err) {
          console.error('Error in undo/redo listener:', err);
        }
      });
    }
  }

  // ── Crear instancia global ──
  window.undoRedoManager = new UndoRedoManager();

  // ── Funciones auxiliares ──
  window.undoLastChange = function() {
    const result = window.undoRedoManager.undo();
    if (result) {
      window.showToast?.(`Deshacer: ${result.label}`, 'info', 2000);
      window.announceToScreenReader?.(`Deshacer: ${result.label}`, 'assertive');
      window.applyMasteringState?.(result.state);
    }
  };

  window.redoLastChange = function() {
    const result = window.undoRedoManager.redo();
    if (result) {
      window.showToast?.(`Rehacer: ${result.label}`, 'info', 2000);
      window.announceToScreenReader?.(`Rehacer: ${result.label}`, 'assertive');
      window.applyMasteringState?.(result.state);
    }
  };

  // ── Rastrear cambios en parámetros ──
  window.trackParameterChange = function(paramName, newValue) {
    // Obtener estado actual (esto requiere que exista buildMasteringParams)
    if (typeof window.buildMasteringParams === 'function') {
      const currentState = window.buildMasteringParams();
      window.undoRedoManager.saveState(currentState, `Cambiar ${paramName}`);
    }
  };

  // ── UI para historial ──
  function createHistoryPanel() {
    const panel = document.createElement('div');
    panel.id = 'history-panel';
    panel.style.cssText = `
      position: fixed;
      top: 60px;
      right: 0;
      width: 280px;
      max-height: 400px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-left: 2px solid var(--accent);
      border-radius: 8px;
      padding: 12px;
      z-index: 8999;
      box-shadow: -4px 4px 12px rgba(0, 0, 0, 0.3);
      font-family: var(--sans);
      font-size: 0.85em;
      color: var(--text);
      display: none;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <strong>Historial</strong>
        <button id="closeHistoryPanel" style="background: none; border: none; color: var(--muted); cursor: pointer; font-size: 1.1em;">✕</button>
      </div>
      <div id="historyList" style="max-height: 350px; overflow-y: auto;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('closeHistoryPanel')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    // Actualizar lista de historial
    window.undoRedoManager.onChange(({ history }) => {
      const list = document.getElementById('historyList');
      if (!list) return;

      list.innerHTML = '';

      // Undo stack
      if (history.undo.length > 0) {
        const undoTitle = document.createElement('div');
        undoTitle.textContent = '🔙 Deshacer';
        undoTitle.style.cssText = 'font-weight: 600; margin: 8px 0 4px 0; color: var(--amber);';
        list.appendChild(undoTitle);

        history.undo.slice().reverse().forEach(item => {
          const li = document.createElement('div');
          li.style.cssText = `
            padding: 4px 8px;
            background: var(--surface3);
            border-radius: 4px;
            margin-bottom: 4px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.8em;
          `;
          li.textContent = `• ${item.label}`;
          li.addEventListener('click', window.undoLastChange);
          li.addEventListener('mouseenter', () => {
            li.style.background = 'var(--border)';
          });
          li.addEventListener('mouseleave', () => {
            li.style.background = 'var(--surface3)';
          });
          list.appendChild(li);
        });
      }

      // Redo stack
      if (history.redo.length > 0) {
        const redoTitle = document.createElement('div');
        redoTitle.textContent = '🔜 Rehacer';
        redoTitle.style.cssText = 'font-weight: 600; margin: 12px 0 4px 0; color: var(--vu-green);';
        list.appendChild(redoTitle);

        history.redo.slice().reverse().forEach(item => {
          const li = document.createElement('div');
          li.style.cssText = `
            padding: 4px 8px;
            background: var(--surface3);
            border-radius: 4px;
            margin-bottom: 4px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.8em;
          `;
          li.textContent = `• ${item.label}`;
          li.addEventListener('click', window.redoLastChange);
          li.addEventListener('mouseenter', () => {
            li.style.background = 'var(--border)';
          });
          li.addEventListener('mouseleave', () => {
            li.style.background = 'var(--surface3)';
          });
          list.appendChild(li);
        });
      }

      if (history.undo.length === 0 && history.redo.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Sin historial aún';
        empty.style.cssText = 'color: var(--muted); text-align: center; padding: 16px 0;';
        list.appendChild(empty);
      }
    });

    return panel;
  }

  // ── Toggle history panel ──
  window.toggleHistoryPanel = function() {
    const panel = document.getElementById('history-panel') || createHistoryPanel();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    window.announceToScreenReader?.('Panel de historial ' + (panel.style.display === 'none' ? 'cerrado' : 'abierto'), 'polite');
  };

  // ── Agregar botón al header ──
  function addHistoryToggleButton() {
    const header = document.querySelector('header');
    if (!header) return;

    const historyBtn = document.createElement('button');
    historyBtn.id = 'historyToggleBtn';
    historyBtn.textContent = '⏱️ Historial';
    historyBtn.setAttribute('aria-label', 'Mostrar historial de cambios (Ctrl+H)');
    historyBtn.style.cssText = `
      background: none;
      border: none;
      color: var(--text);
      cursor: pointer;
      padding: 8px 12px;
      font-size: 0.9em;
      font-weight: 500;
      transition: color 0.2s;
    `;
    historyBtn.addEventListener('click', window.toggleHistoryPanel);
    historyBtn.addEventListener('mouseenter', () => {
      historyBtn.style.color = 'var(--accent)';
    });
    historyBtn.addEventListener('mouseleave', () => {
      historyBtn.style.color = 'var(--text)';
    });

    header.appendChild(historyBtn);
  }

  // ── Agregar atajo Ctrl+H para mostrar historial ──
  const originalKeydownHandler = document.onkeydown;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      window.toggleHistoryPanel();
    }
  });

  // ── Inicializar ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createHistoryPanel();
      addHistoryToggleButton();
    });
  } else {
    createHistoryPanel();
    addHistoryToggleButton();
  }

})();
