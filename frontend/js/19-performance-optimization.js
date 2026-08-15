// ============================================================
// 19-performance-optimization.js — Optimización de visualizadores
// ============================================================

(function () {
  "use strict";

  // ── Throttle/Debounce ──
  window.throttle = function(fn, delay) {
    let last = 0;
    return function(...args) {
      const now = Date.now();
      if (now - last >= delay) {
        last = now;
        fn.apply(this, args);
      }
    };
  };

  window.debounce = function(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  };

  // ── RAF Loop para metros (30fps en lugar de 60) ──
  class OptimizedMeterDisplay {
    constructor(canvasId, targetFPS = 30) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas?.getContext('2d');
      this.targetFPS = targetFPS;
      this.frameInterval = 1000 / targetFPS;
      this.lastFrame = 0;
      this.running = false;
      this.animationId = null;
    }

    start(drawFn) {
      if (this.running) return;
      this.running = true;
      
      const loop = (timestamp) => {
        if (timestamp - this.lastFrame >= this.frameInterval) {
          drawFn(this.ctx, this.canvas);
          this.lastFrame = timestamp;
        }
        this.animationId = requestAnimationFrame(loop);
      };
      
      this.animationId = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
    }
  }

  window.OptimizedMeterDisplay = OptimizedMeterDisplay;

  // ── Spectrum con frecuencia reducida ──
  window.optimizeSpectrumUpdate = function(updateFn, fps = 20) {
    let lastTime = 0;
    const interval = 1000 / fps;
    
    return function(data) {
      const now = performance.now();
      if (now - lastTime >= interval) {
        lastTime = now;
        updateFn(data);
      }
    };
  };

  // ── Canvas double buffering ──
  class DoubleBufferedCanvas {
    constructor(canvasId) {
      this.displayCanvas = document.getElementById(canvasId);
      this.displayCtx = this.displayCanvas?.getContext('2d');
      
      if (this.displayCanvas) {
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = this.displayCanvas.width;
        this.bufferCanvas.height = this.displayCanvas.height;
        this.bufferCtx = this.bufferCanvas.getContext('2d');
      }
    }

    getBufferContext() {
      return this.bufferCtx;
    }

    flip() {
      if (this.bufferCtx && this.displayCtx) {
        this.displayCtx.drawImage(this.bufferCanvas, 0, 0);
      }
    }

    clear() {
      if (this.bufferCtx) {
        this.bufferCtx.clearRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
      }
    }
  }

  window.DoubleBufferedCanvas = DoubleBufferedCanvas;

  // ── Lazy load para visualizadores ──
  function setupLazyVisualizers() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.dataset.lazy === 'true') {
          const initFn = window[entry.target.dataset.initFn];
          if (typeof initFn === 'function') {
            initFn(entry.target);
            entry.target.dataset.lazy = 'false';
          }
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '100px' });

    document.querySelectorAll('[data-lazy="true"]').forEach(el => {
      observer.observe(el);
    });
  }

  // ── Reduce repaints con requestAnimationFrame ──
  window.batchDOMUpdates = function(updates) {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        updates.forEach(update => update());
        resolve();
      });
    });
  };

  // ── Optimizar sliders (usar input delegation) ──
  function optimizeSliders() {
    const sliders = document.querySelectorAll('input[type="range"]');
    const throttledUpdates = new Map();

    sliders.forEach(slider => {
      const handler = window.throttle((e) => {
        // Update value display
        const valueEl = slider.parentElement?.querySelector('.val');
        if (valueEl) {
          valueEl.textContent = e.target.value;
        }

        // Emit custom event (other handlers listen)
        slider.dispatchEvent(new CustomEvent('param-changed', {
          detail: { param: slider.id, value: e.target.value }
        }));
      }, 50); // Update máx cada 50ms

      slider.addEventListener('input', handler);
    });
  }

  // ── Stop animations cuando pestaña no visible ──
  function setupPageVisibilityOptimization() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Pausar análisis en tiempo real
        window.pauseAllVisualizers?.();
      } else {
        // Resumir
        window.resumeAllVisualizers?.();
      }
    });
  }

  // ── Memory pool para objects reutilizables ──
  class ObjectPool {
    constructor(Factory, size = 100) {
      this.factory = Factory;
      this.pool = [];
      for (let i = 0; i < size; i++) {
        this.pool.push(new Factory());
      }
    }

    acquire() {
      return this.pool.length > 0 ? this.pool.pop() : new this.factory();
    }

    release(obj) {
      if (obj.reset) obj.reset();
      this.pool.push(obj);
    }
  }

  window.ObjectPool = ObjectPool;

  // ── Inicializar optimizaciones ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      optimizeSliders();
      setupPageVisibilityOptimization();
      setupLazyVisualizers();
    });
  } else {
    optimizeSliders();
    setupPageVisibilityOptimization();
    setupLazyVisualizers();
  }

  // Debug info
  window.getPerformanceMetrics = function() {
    return {
      fps: Math.round(1000 / (performance.now() % 16.67)),
      memory: performance.memory ? {
        used: (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB',
        limit: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(1) + ' MB',
      } : 'N/A',
      timestamp: performance.now().toFixed(2) + 'ms'
    };
  };

})();
