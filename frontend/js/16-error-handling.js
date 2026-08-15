// ============================================================
// 16-error-handling.js — Error handling, validación y feedback mejorado
// ============================================================

(function () {
  "use strict";

  // ── Toast/Notification System ──
  const TOAST_TYPES = {
    success: { icon: '✓', color: 'var(--vu-green)' },
    error: { icon: '✕', color: 'var(--clip-red)' },
    warning: { icon: '⚠', color: 'var(--vu-yellow)' },
    info: { icon: 'ℹ', color: 'var(--cyan)' },
    loading: { icon: '⏳', color: 'var(--amber)' },
  };

  function createToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-label', 'Notificaciones');
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  window.showToast = function(message, type = 'info', duration = 4000) {
    const container = createToastContainer();
    const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.style.cssText = `
      background: var(--surface2);
      border: 1px solid ${typeConfig.color};
      border-left: 4px solid ${typeConfig.color};
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--text);
      font-family: var(--sans, system-ui);
      font-size: 0.9rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: auto;
      animation: slideInRight 0.3s ease-out;
      max-width: 400px;
      word-wrap: break-word;
    `;

    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = `color: ${typeConfig.color}; font-weight: bold; font-size: 1.1em;`;
    iconSpan.textContent = typeConfig.icon;

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(messageSpan);

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    container.appendChild(toast);

    // Anunciar a screen readers
    window.announceToScreenReader?.(message, type === 'error' ? 'assertive' : 'polite');

    return toast;
  };

  // ── Agregar animaciones ──
  function injectToastStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }

      /* Progress bar styles */
      .progress-bar {
        width: 100%;
        height: 3px;
        background: var(--surface3);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 8px;
      }

      .progress-bar-fill {
        height: 100%;
        background: var(--amber);
        width: 0%;
        transition: width 0.2s linear;
      }

      .progress-bar-indeterminate .progress-bar-fill {
        background: linear-gradient(90deg, var(--amber), var(--clip-red), var(--amber));
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Input Validation ──
  const VALIDATORS = {
    required: (value, label) => {
      if (!value || (typeof value === 'string' && !value.trim())) {
        return `${label} es requerido`;
      }
      return null;
    },
    minValue: (min) => (value, label) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < min) {
        return `${label} debe ser mayor a ${min}`;
      }
      return null;
    },
    maxValue: (max) => (value, label) => {
      const num = parseFloat(value);
      if (isNaN(num) || num > max) {
        return `${label} debe ser menor a ${max}`;
      }
      return null;
    },
    email: (value, label) => {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!re.test(value)) {
        return `${label} debe ser un email válido`;
      }
      return null;
    },
    fileSize: (maxMB) => (file, label) => {
      if (!file) return null;
      const maxBytes = maxMB * 1024 * 1024;
      if (file.size > maxBytes) {
        return `${label} no debe superar ${maxMB} MB (tamaño actual: ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
      }
      return null;
    },
    audioFormat: (file, label) => {
      const allowed = ['.wav', '.mp3', '.flac', '.ogg', '.aiff', '.aif'];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!allowed.includes(ext)) {
        return `${label} debe ser: ${allowed.join(', ')}`;
      }
      return null;
    },
  };

  window.validateInput = function(value, label, validators = []) {
    for (const validator of validators) {
      const error = validator(value, label);
      if (error) {
        return { valid: false, error };
      }
    }
    return { valid: true };
  };

  window.validateInputElement = function(element, validators = []) {
    const label = element.getAttribute('aria-label') || element.id || 'Input';
    const value = element.type === 'file' ? element.files[0] : element.value;
    return window.validateInput(value, label, validators);
  };

  // ── Enhanced fetch con retry y timeout ──
  const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 30000,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  };

  window.fetchWithRetry = async function(url, options = {}) {
    const { maxRetries = RETRY_CONFIG.maxRetries, timeout = RETRY_CONFIG.timeout } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (RETRY_CONFIG.retryableStatuses.includes(response.status) && attempt < maxRetries) {
            const delay = RETRY_CONFIG.retryDelay * Math.pow(2, attempt);
            console.warn(`Intento ${attempt + 1}/${maxRetries + 1} fallido (${response.status}), reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          const errorText = await response.text().catch(() => response.statusText);
          lastError = new Error(`HTTP ${response.status}: ${errorText}`);
        } else {
          return response;
        }
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') {
          lastError = new Error(`Timeout after ${timeout}ms`);
          break;
        }
        if (attempt < maxRetries) {
          const delay = RETRY_CONFIG.retryDelay * Math.pow(2, attempt);
          console.warn(`Intento ${attempt + 1}/${maxRetries + 1} fallido, reintentando...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    clearTimeout(timeoutId);
    throw lastError || new Error('Máximo de reintentos alcanzado');
  };

  // ── Global error handler ──
  window.addEventListener('error', (e) => {
    console.error('Uncaught error:', e.error);
    window.showToast(`Error: ${e.message}`, 'error');
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    const message = e.reason?.message || String(e.reason);
    window.showToast(`Error asincrónico: ${message}`, 'error');
  });

  // ── Wrap existing API calls ──
  const _origFetch = window.fetch;
  window.fetchWithErrorHandling = async function(url, opts = {}) {
    const handleError = opts.handleError !== false;
    delete opts.handleError;

    try {
      const response = await window.fetchWithRetry(url, opts);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      if (handleError) {
        let message = err.message;
        if (err.name === 'AbortError') {
          message = 'La solicitud tomó demasiado tiempo. Por favor, intenta de nuevo.';
        } else if (message.includes('Failed to fetch')) {
          message = 'Error de conexión. Verifica tu conexión a internet.';
        }
        window.showToast(message, 'error');
      }
      throw err;
    }
  };

  // ── Progress indicator ──
  window.showProgress = function(message, total = null) {
    const toast = window.showToast(message, 'loading', 0);
    const progressBar = document.createElement('div');
    progressBar.className = total ? 'progress-bar' : 'progress-bar progress-bar-indeterminate';
    toast.appendChild(progressBar);

    const fill = document.createElement('div');
    fill.className = 'progress-bar-fill';
    progressBar.appendChild(fill);

    return {
      update(current) {
        if (total) {
          const percent = (current / total) * 100;
          fill.style.width = percent + '%';
        }
      },
      complete(successMessage = 'Completado') {
        toast.remove();
        window.showToast(successMessage, 'success', 3000);
      },
      error(errorMessage = 'Error') {
        toast.remove();
        window.showToast(errorMessage, 'error');
      },
      toast,
    };
  };

  // ── Inicializar ──
  injectToastStyles();

})();
