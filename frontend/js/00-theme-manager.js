/**
 * Theme Manager — Dark Mode + Multiple Themes
 * 
 * Features:
 *  - Detecta preferencia del SO (prefers-color-scheme)
 *  - Cachea en localStorage
 *  - Temas: Auto (SO), Dark, Light, High Contrast, OLED Black
 *  - Atajos de teclado: Cmd+Shift+D (toggle), Cmd+Shift+T (menu)
 *  - Smooth transitions entre temas
 */

const THEME_STORAGE_KEY = 'base10-theme';
const THEMES = {
  AUTO: 'auto',       // Sigue preferencia del SO
  LIGHT: 'light',
  DARK: 'dark',
  HIGH_CONTRAST: 'high-contrast',
  OLED_BLACK: 'oled-black',
};

let currentTheme = THEME_STORAGE_KEY;
let prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

// ── Initializar ────────────────────────────────────────────────────────────

function initThemeManager() {
  // Cargar tema guardado o usar preferencia del SO
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = saved || THEMES.AUTO;
  
  applyTheme(theme);
  setupThemeListeners();
  createThemeSwitcher();
  
  console.log(`🎨 Theme initialized: ${theme}`);
}

// ── Apply Theme ────────────────────────────────────────────────────────────

function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  
  // Remover todos los temas actuales
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove(
    'theme-light',
    'theme-dark',
    'theme-high-contrast',
    'theme-oled-black'
  );
  
  // Aplicar nuevo tema
  if (theme === THEMES.AUTO) {
    const isDark = prefersDark.matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.documentElement.classList.add(isDark ? 'theme-dark' : 'theme-light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.add(`theme-${theme}`);
  }
  
  // Trigger event para componentes que escuchan cambios de tema
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// ── Setup Listeners ────────────────────────────────────────────────────────

function setupThemeListeners() {
  // Escuchar cambios en preferencia del SO (si está en AUTO)
  prefersDark.addEventListener('change', (e) => {
    if (currentTheme === THEMES.AUTO) {
      applyTheme(THEMES.AUTO);
    }
  });
  
  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    // Cmd+Shift+D: toggle dark mode
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      toggleDarkMode();
    }
    
    // Cmd+Shift+T: abrir menu de temas
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      toggleThemeSwitcher();
    }
  });
}

function toggleDarkMode() {
  const isDark = currentTheme === THEMES.DARK || 
                 (currentTheme === THEMES.AUTO && prefersDark.matches);
  applyTheme(isDark ? THEMES.LIGHT : THEMES.DARK);
  showToast(`🌙 ${isDark ? 'Light' : 'Dark'} mode`);
}

// ── Theme Switcher UI ────────────────────────────────────────────────────────

function createThemeSwitcher() {
  // Crear HTML del switcher
  const switcherHTML = `
    <div id="theme-switcher-btn" class="theme-switcher-btn" title="Cmd+Shift+T">
      <span class="icon">🎨</span>
    </div>
    <div id="theme-switcher-menu" class="theme-switcher-menu hidden">
      <div class="theme-switcher-title">Theme</div>
      <button class="theme-option" data-theme="auto">
        <span class="icon">🔄</span> Auto (OS preference)
      </button>
      <button class="theme-option" data-theme="light">
        <span class="icon">☀️</span> Light
      </button>
      <button class="theme-option" data-theme="dark">
        <span class="icon">🌙</span> Dark
      </button>
      <button class="theme-option" data-theme="high-contrast">
        <span class="icon">⚫⚪</span> High Contrast
      </button>
      <button class="theme-option" data-theme="oled-black">
        <span class="icon">⬛</span> OLED Black
      </button>
      <hr class="theme-divider">
      <div class="theme-shortcuts">
        <small>Cmd+Shift+D: Toggle Dark</small><br>
        <small>Cmd+Shift+T: Open Menu</small>
      </div>
    </div>
  `;
  
  // Inyectar en un mount estable del header. Si el DOM ya está listo, hacerlo
  // inmediatamente (evita perder el evento DOMContentLoaded cuando el script
  // se carga al final del documento).
  const mountSwitcher = () => {
    if (document.getElementById('theme-switcher-btn')) return;
    const mount = document.getElementById('themeSwitcherMount');
    const navbar = mount || document.querySelector('.navbar') || document.querySelector('header');
    if (!navbar) return;

    const switcher = document.createElement('div');
    switcher.className = 'theme-switcher-wrap';
    switcher.innerHTML = switcherHTML;
    if (mount) {
      mount.appendChild(switcher);
    } else {
      navbar.appendChild(switcher);
    }
    setupSwitcherHandlers();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSwitcher, { once: true });
  } else {
    mountSwitcher();
  }
}

function setupSwitcherHandlers() {
  const btn = document.getElementById('theme-switcher-btn');
  const menu = document.getElementById('theme-switcher-menu');
  const options = document.querySelectorAll('.theme-option');
  
  if (!btn || !menu) return;
  
  // Toggle menu
  btn.addEventListener('click', toggleThemeSwitcher);
  
  // Click fuera cierra menu
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
  
  // Clickear opción de tema
  options.forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.getAttribute('data-theme');
      applyTheme(theme);
      menu.classList.add('hidden');
      updateSwitcherUI();
    });
  });
  
  updateSwitcherUI();
}

function toggleThemeSwitcher() {
  const menu = document.getElementById('theme-switcher-menu');
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

function updateSwitcherUI() {
  const options = document.querySelectorAll('.theme-option');
  options.forEach(option => {
    const theme = option.getAttribute('data-theme');
    option.classList.toggle('active', theme === currentTheme);
  });
}

// ── Utility: Toast notification ────────────────────────────────────────────

function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'theme-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }, 10);
}

// ── Export ────────────────────────────────────────────────────────────────

window.themeManager = {
  init: initThemeManager,
  applyTheme,
  toggleDarkMode,
  currentTheme: () => currentTheme,
};

// Auto-init cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initThemeManager);
} else {
  initThemeManager();
}
