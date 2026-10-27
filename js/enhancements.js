/* ============================================================
   ENHANCEMENTS JS — Dark mode, scroll progress, sticky CTA
   Self-contained, no external deps. Carga al final del body.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. DARK MODE ---------- */
  const THEME_KEY = 'licdia-theme';
  const root = document.documentElement;

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function setStoredTheme(value) {
    try { localStorage.setItem(THEME_KEY, value); } catch (e) { /* ignore */ }
  }
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function applyTheme(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    });
  }

  // Aplica tema lo antes posible (evita FOUC)
  const stored = getStoredTheme();
  const initial = stored || (systemPrefersDark() ? 'dark' : 'light');
  applyTheme(initial);

  // Sigue cambios del SO si el usuario nunca tocó el toggle
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!getStoredTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  function toggleTheme() {
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setStoredTheme(next);
  }
  // Exponer para que botones inyectados u onclick lo usen
  window.licdiaToggleTheme = toggleTheme;

  /* ---------- 2. INJECT THEME TOGGLE BUTTON ---------- */
  // Si no existe ya, lo inyecta en el navbar
  function injectToggle() {
    if (document.querySelector('.theme-toggle')) return;
    const nav = document.querySelector('.navbar-nav, nav .navbar-nav, header nav ul');
    if (!nav) return;
    const li = document.createElement('li');
    li.className = 'nav-item d-flex align-items-center';
    li.innerHTML = `
      <button class="theme-toggle" type="button" onclick="licdiaToggleTheme()" aria-label="Cambiar tema" aria-pressed="false" title="Modo claro / oscuro">
        <i class="fa-solid fa-moon icon-moon" aria-hidden="true"></i>
        <i class="fa-solid fa-sun icon-sun" aria-hidden="true"></i>
      </button>
    `;
    nav.appendChild(li);
    // Re-aplicar aria-pressed según tema actual
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }

  /* ---------- 3. SCROLL PROGRESS BAR ---------- */
  function injectScrollBar() {
    if (document.querySelector('.scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('role', 'presentation');
    document.body.prepend(bar);

    let ticking = false;
    function update() {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const pct = height > 0 ? (scrollTop / height) * 100 : 0;
      bar.style.width = pct + '%';
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
    update();
  }

  /* ---------- 4. STICKY FLOATING CTA ---------- */
  function injectStickyCTA() {
    if (document.querySelector('.sticky-cta')) return;
    // Detecta si estamos en BC o IA por la URL
    const path = window.location.pathname;
    let href, label;
    if (path.includes('/blockchain-dev')) {
      // 2026 inscription is closed: point to the 2027 waiting list
      href = '/blockchain-dev/espera-2027/';
      label = 'Lista de espera 2027';
    } else if (path.includes('/dev-ia')) {
      href = '/dev-ia/inscripcion-dev-ia/';
      label = 'Inscribite a IA Generativa';
    } else {
      return; // No mostrar en páginas que no son de diplomatura
    }

    // No mostrar SI estamos ya en la página de inscripción o gracias
    if (path.includes('/inscripcion-') || path.includes('/gracias-') || path.includes('/espera-')) return;

    const a = document.createElement('a');
    a.className = 'sticky-cta';
    a.href = href;
    a.setAttribute('aria-label', label);
    a.innerHTML = `<i class="fa-solid fa-rocket" aria-hidden="true"></i><span>${label}</span>`;
    document.body.appendChild(a);

    // Aparece después de scrollear 600px
    function toggleVisibility() {
      const scrolled = window.pageYOffset || document.documentElement.scrollTop;
      if (scrolled > 600) {
        a.classList.add('visible');
      } else {
        a.classList.remove('visible');
      }
    }
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => { toggleVisibility(); ticking = false; });
        ticking = true;
      }
    }, { passive: true });
    toggleVisibility();
  }

  /* ---------- 5. AOS SAFETY NET ----------
   Si AOS no termina de inicializar (deeplinks, tabs en background, scroll-restoration),
   despues de 2.5s forzamos opacity:1 en cualquier [data-aos] no animado.
   Esto evita que headers/cards queden invisibles sobre fondo oscuro o claro. */
  function aosSafetyNet() {
    setTimeout(function () {
      document.querySelectorAll('[data-aos]:not(.aos-animate)').forEach(function (el) {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.transition = 'opacity 0.4s ease';
      });
    }, 2500);
  }

  /* ---------- 6. INIT ---------- */
  function init() {
    injectToggle();
    injectScrollBar();
    injectStickyCTA();
    aosSafetyNet();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
