// ============================================================
// 00-accessibility.js — Accesibilidad (a11y) y navegación
// Debe correr ANTES que otros módulos para inyectar atributos
// ============================================================

(function () {
  "use strict";

  // ── Agregar aria-labels a botones y controles sin label ──
  function enhanceAccessibility() {
    // Botones en el sidebar
    document.querySelectorAll('.sidebar-tab').forEach((btn, idx) => {
      const label = btn.textContent.trim();
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
      btn.setAttribute('aria-label', `Tab ${idx + 1}: ${label}`);
    });

    // Botones de acción
    const btnLabels = {
      'btnAnalyze': 'Analizar audio (Ctrl+Shift+A)',
      'btnAdvice': 'Obtener recomendaciones de IA (Ctrl+Shift+R)',
      'btnMasterSync': 'Masterizar sincrónico (Ctrl+Shift+M)',
      'btnMasterAsync': 'Encolar mastering (Ctrl+Shift+Q)',
      'btnPitchCorrection': 'Corregir pitch (Ctrl+Shift+P)',
      'btnNormalizeLufs': 'Normalizar por LUFS',
      'btnLoadPresetJson': 'Cargar preset desde archivo JSON',
      'btnRefreshLibrary': 'Actualizar librería',
      'btnOpenRefLib': 'Abrir biblioteca de referencias',
      'devToggleBtn': 'Alternar panel de desarrollador',
    };

    Object.entries(btnLabels).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el && !el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', label);
      }
    });

    // File inputs
    const fileInputs = [
      { id: 'fileInput', label: 'Seleccionar archivo de audio' },
      { id: 'refFileInput', label: 'Seleccionar archivo de referencia' },
      { id: 'presetJsonInput', label: 'Seleccionar archivo de preset JSON' },
    ];

    fileInputs.forEach(({ id, label }) => {
      const el = document.getElementById(id);
      if (el) {
        el.setAttribute('aria-label', label);
        el.setAttribute('role', 'button');
      }
    });

    // Range sliders con aria-valuetext
    document.querySelectorAll('input[type="range"]').forEach(slider => {
      const label = slider.previousElementSibling?.textContent || slider.id;
      slider.setAttribute('aria-label', label);
      slider.setAttribute('role', 'slider');
      updateSliderAriaValue(slider);
    });

    // Checkboxes y selects
    document.querySelectorAll('input[type="checkbox"], select').forEach(el => {
      if (!el.hasAttribute('aria-label') && el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent ||
                     el.parentElement?.querySelector('.field-group')?.textContent ||
                     el.id;
        if (label) {
          el.setAttribute('aria-label', label.trim());
        }
      }
    });

    // Secciones de contenido
    document.querySelectorAll('.section-label').forEach(section => {
      const parent = section.parentElement;
      if (parent && !parent.hasAttribute('role')) {
        parent.setAttribute('role', 'region');
        parent.setAttribute('aria-labelledby', section.id || 'section-' + Math.random().toString(36).substr(2, 9));
      }
    });

    // Panel blocks como landmarks
    document.querySelectorAll('.panel-block').forEach((panel, idx) => {
      if (!panel.hasAttribute('role')) {
        panel.setAttribute('role', 'complementary');
        const title = panel.querySelector('.section-label, .summary-accent');
        if (title) {
          panel.setAttribute('aria-label', title.textContent.trim());
        }
      }
    });
  }

  // ── Actualizar aria-valuetext en sliders ──
  function updateSliderAriaValue(slider) {
    const value = slider.value;
    const unit = slider.id.includes('lufs') ? ' LUFS' : 
                 slider.id.includes('db') ? ' dB' :
                 slider.id.includes('ms') ? ' ms' :
                 slider.id.includes('hz') ? ' Hz' : '';
    
    slider.setAttribute('aria-valuenow', value);
    slider.setAttribute('aria-valuetext', value + unit);
  }

  // ── Escuchar cambios en sliders ──
  function setupSliderAriaUpdates() {
    document.querySelectorAll('input[type="range"]').forEach(slider => {
      slider.addEventListener('input', () => updateSliderAriaValue(slider));
      slider.addEventListener('change', () => updateSliderAriaValue(slider));
    });
  }

  // ── Tab navigation (Shift+Tab para navegar atrás) ──
  function setupTabNavigation() {
    const tabbableElements = () => Array.from(
      document.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;

      const elements = tabbableElements();
      const current = document.activeElement;
      const idx = elements.indexOf(current);

      if (e.shiftKey) {
        // Shift+Tab = navegar atrás
        e.preventDefault();
        const prev = elements[(idx - 1 + elements.length) % elements.length];
        prev?.focus();
      } else {
        // Tab = navegar adelante
        e.preventDefault();
        const next = elements[(idx + 1) % elements.length];
        next?.focus();
      }
    });
  }

  // ── Skip to main content ──
  function addSkipLink() {
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Ir al contenido principal';
    skipLink.className = 'skip-link';
    skipLink.setAttribute('aria-label', 'Saltar a contenido principal');
    document.body.insertBefore(skipLink, document.body.firstChild);
  }

  // ── Focus indicators visibles ──
  function enhanceFocusIndicators() {
    const style = document.createElement('style');
    style.textContent = `
      *:focus-visible {
        outline: 3px solid var(--accent, #7c3aed);
        outline-offset: 2px;
      }

      .skip-link {
        position: absolute;
        top: -40px;
        left: 0;
        background: var(--accent, #7c3aed);
        color: white;
        padding: 8px;
        z-index: 100;
        border-radius: 0 0 4px 0;
      }

      .skip-link:focus {
        top: 0;
      }

      /* Better contrast for inputs */
      input:focus,
      select:focus,
      textarea:focus {
        box-shadow: inset 0 0 0 2px var(--accent, #7c3aed);
      }

      /* Visible focus para botones */
      button:focus,
      [role="button"]:focus {
        box-shadow: 0 0 0 3px var(--accent-glow, rgba(124, 58, 237, 0.3));
      }
    `;
    document.head.appendChild(style);
  }

  // ── Announcement screen reader ──
  window.announceToScreenReader = function(message, priority = 'polite') {
    let announcement = document.getElementById('a11y-announcements');
    if (!announcement) {
      announcement = document.createElement('div');
      announcement.id = 'a11y-announcements';
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      announcement.style.cssText = `
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      `;
      document.body.appendChild(announcement);
    }
    
    announcement.setAttribute('aria-live', priority);
    announcement.textContent = message;
    
    // Clear después de 3s
    setTimeout(() => {
      announcement.textContent = '';
    }, 3000);
  };

  // ── Color contrast checker (desarrollo) ──
  window.checkContrastIssues = function() {
    const issues = [];
    document.querySelectorAll('[style*="color"]').forEach(el => {
      const bg = window.getComputedStyle(el).backgroundColor;
      const fg = window.getComputedStyle(el).color;
      // Esto es simplificado; en producción usar libcontrastchecker
      console.log(`${el.id || el.className}: bg=${bg}, fg=${fg}`);
    });
    return issues;
  };

  // ── Inicializar al cargar ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      addSkipLink();
      enhanceAccessibility();
      setupSliderAriaUpdates();
      setupTabNavigation();
      enhanceFocusIndicators();
    });
  } else {
    addSkipLink();
    enhanceAccessibility();
    setupSliderAriaUpdates();
    setupTabNavigation();
    enhanceFocusIndicators();
  }

})();
