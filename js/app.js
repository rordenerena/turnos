/* app.js — bootstrap, auth obligatoria y navegación */

let _headerTaps = 0;
let _headerTimer = null;
const VIEW_KEY = 'turnos_view';
const HEADER_VIEW_CONFIG = {
  calendar: { title: '📅 Turnos', button: 'menu' },
  patterns: { title: 'Patrones', button: 'menu' },
  shared: { title: 'Compartir', button: 'menu' },
  settings: { title: 'Configuración', button: 'menu' },
  scan: { title: 'Escanear QR', button: 'menu' }
};
let primaryDrawerOpen = false;

function headerTap() {
  _headerTaps++;
  clearTimeout(_headerTimer);
  _headerTimer = setTimeout(() => { _headerTaps = 0; }, 2000);
  if (_headerTaps >= 5) {
    _headerTaps = 0;
    const el = document.getElementById('danger-section');
    if (el) {
      el.classList.toggle('hidden');
      toast(el.classList.contains('hidden') ? 'Modo desarrollador desactivado' : '⚠️ Modo desarrollador activado');
    }
  }
}

function setTheme(mode) {
  localStorage.setItem('turnos_theme', mode);
  applyTheme(mode);
}

function applyTheme(mode) {
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

applyTheme(localStorage.getItem('turnos_theme') || 'auto');

function toast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

function showUpdateToast() {
  const el = document.getElementById('toast');
  el.innerHTML = '🆕 Nueva versión disponible <button class="btn btn-sm btn-primary" style="margin-left:8px" onclick="location.reload()">Actualizar</button>';
  el.classList.remove('hidden');
  clearTimeout(el._t);
}

function getOwnerCalendar() {
  if (googleOwnerCalendar) return googleOwnerCalendar;
  if (currentCal && !currentCal.readonly) return currentCal;
  return null;
}

function currentVisibleTab() {
  return localStorage.getItem(VIEW_KEY) || 'calendar';
}

function showCalendar(id) {
  const targetId = id || currentCal?.id || getOwnerCalendar()?.id;
  if (targetId) selectCalendar(targetId);
  switchTab('calendar');
}

function renderCalendarTabs() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;

  const items = [];
  if (googleOwnerCalendar) items.push({ id: googleOwnerCalendar.id, name: 'Mi calendario', readonly: false });
  storeGetImported().forEach(meta => items.push({ id: meta.id, name: storeImportedCalendarName(meta), readonly: true }));

  tabs.innerHTML = items.map(item => `
    <div class="calendar-tab-item${currentCal && currentCal.id === item.id ? ' active' : ''}">
      <button
        type="button"
        class="calendar-tab${currentCal && currentCal.id === item.id ? ' active' : ''}"
        onclick="showCalendar('${item.id}')"
      >${escapeHtml(item.name)}</button>
      ${item.readonly ? `
        <button
          type="button"
          class="calendar-tab-info btn btn-sm btn-ghost icon-button"
          onclick="toggleReadonlyBannerForCalendar('${item.id}', event)"
          aria-label="Alternar información del calendario importado ${escapeHtml(item.name)}"
          title="Alternar información del calendario importado"
        >${appIconSpan('info')}</button>
      ` : ''}
    </div>
  `).join('');

  syncCalendarTabsVisibility();
}

function syncCalendarTabsVisibility(view = currentVisibleTab()) {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  const hasMultipleCalendars = tabs.children.length > 1;
  tabs.classList.toggle('hidden', view !== 'calendar' || !hasMultipleCalendars);
}

function syncOwnerActionCopy() {
  const owner = getOwnerCalendar();
  const ownerName = owner?.name || 'Mi calendario';
  const patternCopy = document.getElementById('pattern-owner-context');
  const shareCopy = document.getElementById('share-owner-context');
  if (patternCopy) patternCopy.textContent = `Estas acciones se aplican siempre sobre ${ownerName}.`;
  if (shareCopy) shareCopy.textContent = '';
}

function appIcon(name) {
  const icons = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>'
  };
  return icons[name] || '';
}

function appIconSpan(name) {
  return `<span class="icon-inline" aria-hidden="true">${appIcon(name)}</span>`;
}

function headerButtonIconMarkup(mode) {
  if (mode === 'close') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>';
  }
  if (mode === 'back') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line></svg>';
}

function goBackToCalendar() {
  closePrimaryDrawer();
  switchTab('calendar');
}

function syncPrimaryDrawerState(view = currentVisibleTab()) {
  document.querySelectorAll('.drawer-action[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

function syncHeaderState(view = currentVisibleTab()) {
  const config = HEADER_VIEW_CONFIG[view] || HEADER_VIEW_CONFIG.calendar;
  const title = document.getElementById('header-title');
  const button = document.getElementById('header-menu-button');
  const effectiveMode = config.button === 'menu' && primaryDrawerOpen ? 'close' : config.button;
  if (title) title.textContent = config.title;
  syncPrimaryDrawerState(view);
  if (config.button === 'back') {
    primaryDrawerOpen = false;
    document.getElementById('drawer-overlay')?.classList.add('hidden');
  }
  if (!button) return;

  button.classList.toggle('header-back-button', config.button === 'back');
  button.innerHTML = `<span class="header-menu-icon" aria-hidden="true">${headerButtonIconMarkup(effectiveMode)}</span>`;

  if (config.button === 'back') {
    button.onclick = goBackToCalendar;
    button.setAttribute('aria-label', 'Volver al calendario');
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
    return;
  }

  button.onclick = togglePrimaryDrawer;
  button.setAttribute('aria-controls', 'primary-drawer');
  button.setAttribute('aria-expanded', primaryDrawerOpen ? 'true' : 'false');
  button.setAttribute('aria-label', primaryDrawerOpen ? 'Cerrar menú principal' : 'Abrir menú principal');
}

function closePrimaryDrawer(event) {
  if (event && event.target && event.target.id !== 'drawer-overlay') return;
  primaryDrawerOpen = false;
  document.getElementById('drawer-overlay')?.classList.add('hidden');
  syncHeaderState();
}

function togglePrimaryDrawer() {
  primaryDrawerOpen = !primaryDrawerOpen;
  document.getElementById('drawer-overlay')?.classList.toggle('hidden', !primaryDrawerOpen);
  syncHeaderState();
}

function openPrimaryMenuAction(action) {
  closePrimaryDrawer();
  switchTab(action);
}

function switchTab(tab) {
  localStorage.setItem(VIEW_KEY, tab);
  document.querySelectorAll('.tab-content').forEach(item => item.classList.toggle('active', item.id === `tab-${tab}`));
  syncCalendarTabsVisibility(tab);

  if (tab === 'shared') {
    renderImportedList();
    shareGenerate({ toastSuccess: false, toastError: false }).catch(error => console.warn('No se pudo preparar el QR de compartir', error));
  }
  if (tab === 'patterns') {
    renderPatternsList();
    const today = new Date();
    document.getElementById('pattern-start').value = isoDate(today);
    document.getElementById('pattern-end').value = isoDate(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));
    document.getElementById('pattern-month').value = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  }
  if (tab === 'settings') {
    document.getElementById('theme-select').value = localStorage.getItem('turnos_theme') || 'auto';
    const sessionIdentity = googleProfile ? storeOwnerIdentityText({ ownerName: googleProfile.name, ownerEmail: googleProfile.email }) : '';
    document.getElementById('google-user-name').textContent = sessionIdentity ? `👤 ${sessionIdentity}` : 'Sin sesión';
  }
  if (tab === 'scan') startQrScanner();
  else stopQrScanner();
  syncOwnerActionCopy();
  syncHeaderState(tab);
}

function ensureWritableTabVisibility() {
  return currentVisibleTab();
}

async function restoreActiveSource(savedActiveId) {
  if (!savedActiveId || !googleOwnerCalendar || savedActiveId === googleOwnerCalendar.id) return false;
  if (!storeGetImportedById(savedActiveId)) return false;
  try {
    await selectCalendar(savedActiveId);
    return currentCal && currentCal.id === savedActiveId;
  } catch (error) {
    console.warn('No se pudo restaurar el calendario activo', error);
    return false;
  }
}

async function selectCalendar(id) {
  if (googleOwnerCalendar && id === googleOwnerCalendar.id) {
    currentCal = googleOwnerCalendar;
    storeSetActive(id);
    renderCalendarTabs();
    calRender();
    renderPatternsList();
    syncOwnerActionCopy();
    return;
  }

  const importedMeta = storeGetImportedById(id);
  if (!importedMeta) return;
  currentCal = storeBuildImportedSource(importedMeta);
  storeSetActive(id);
  renderCalendarTabs();
  calRender();
  try {
    currentCal = await shareRefreshImportedCalendar(id, { silent: true });
    renderCalendarTabs();
    calRender();
    syncOwnerActionCopy();
  } catch (error) {
    toast(`No se pudo refrescar el iCal: ${error.message}`);
  }
}

async function refreshVisibleSource() {
  if (!currentCal) return;
  try {
    if (currentCal.readonly) {
      currentCal = await shareRefreshImportedCalendar(currentCal.id, { silent: true });
    } else {
      currentCal = await googleCalendarRefreshOwner({ silent: true });
    }
  } catch (error) {
    console.warn(error);
  }
}

async function deleteEverything() {
  if (!confirm('¿Eliminar el calendario de Turnos y todas las suscripciones locales?')) return;
  if (!confirm('⚠️ Esta acción es irreversible. ¿Seguro?')) return;
  try {
    await googleCalendarDeleteEverythingRemote();
  } catch (error) {
    toast(`No se pudo borrar el calendario remoto: ${error.message}`);
    return;
  }
  storeClearImports();
  localStorage.removeItem(ACTIVE_KEY);
  googleCalendarLogout();
  toast('Todo eliminado ✓');
  setTimeout(() => location.reload(), 800);
}

function logoutGoogle() {
  googleCalendarLogout();
  toast('Sesión cerrada');
  setTimeout(() => location.reload(), 400);
}

async function appLogin() {
  try {
    await googleCalendarLogin();
    await bootstrapAuthorizedApp();
  } catch (error) {
    toast(`No se pudo iniciar sesión: ${error.message}`);
  }
}

async function bootstrapAuthorizedApp() {
  googleCalendarShowAuth(false);
  const savedActiveId = storeGetActive();
  const hasUrlImport = (location.hash || '').startsWith('#ical=');
  currentCal = await googleCalendarBootstrap();
  storeSetActive(currentCal.id);
  renderCalendarTabs();
  calRender();
  renderPatternsList();
  renderImportedList();
  syncOwnerActionCopy();

  if (!hasUrlImport) {
    const restored = await restoreActiveSource(savedActiveId);
    if (!restored) storeSetActive(currentCal.id);
  }

  const savedTab = localStorage.getItem(VIEW_KEY);
  if (savedTab) switchTab(savedTab);
  else switchTab('calendar');

  if (hasUrlImport) {
    try {
      await shareCheckUrl();
    } catch (error) {
      toast(`No se pudo importar el iCal: ${error.message}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  calInit();
  renderImportedList();
  syncHeaderState();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      setInterval(() => reg.update(), 5 * 60 * 1000);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
        });
      });
    }).catch(() => {});
  }

  if ('launchQueue' in window) {
    launchQueue.setConsumer(async launchParams => {
      if (!launchParams.targetURL) return;
      const url = new URL(launchParams.targetURL);
      if (url.hash.startsWith('#ical=')) {
        location.hash = url.hash;
        if (googleCalendarHasSession()) await shareCheckUrl();
      }
    });
  }

  await googleCalendarInit();
  if (googleCalendarHasSession()) {
    try {
      await bootstrapAuthorizedApp();
      return;
    } catch (error) {
      console.warn(error);
    }
  }
  googleCalendarShowAuth(true);
});

let _scanner = null;
let _scannerState = 'idle';
let _scannerSession = 0;

async function stopQrScanner() {
  _scannerSession += 1;
  const scanner = _scanner;
  _scanner = null;
  if (!scanner) {
    _scannerState = 'idle';
    return;
  }
  _scannerState = 'stopping';
  try {
    await scanner.stop();
  } catch {}
  try {
    await scanner.clear();
  } catch {}
  _scannerState = 'idle';
}

async function handleScanResult(text) {
  await stopQrScanner();
  try {
    const url = new URL(text);
    if (!url.hash.startsWith('#ical=')) {
      toast('QR no válido');
      if (currentVisibleTab() === 'scan') startQrScanner();
      return;
    }
    location.hash = url.hash;
    await shareCheckUrl();
  } catch (error) {
    const message = error?.message && error instanceof Error ? `No se pudo importar el iCal: ${error.message}` : 'QR no válido';
    toast(message);
    if (currentVisibleTab() === 'scan') startQrScanner();
  }
}

async function startQrScanner() {
  if (_scannerState === 'starting' || _scannerState === 'running') return;
  if (typeof Html5Qrcode !== 'function') {
    toast('Lector QR no disponible');
    return;
  }

  const session = ++_scannerSession;
  const reader = document.getElementById('scan-reader');
  if (!reader) return;

  reader.innerHTML = '';
  const scanner = new Html5Qrcode('scan-reader');
  _scanner = scanner;
  _scannerState = 'starting';

  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async text => {
        if (session !== _scannerSession) return;
        await handleScanResult(text);
      }
    );
    if (session !== _scannerSession || currentVisibleTab() !== 'scan') {
      await stopQrScanner();
      return;
    }
    _scannerState = 'running';
  } catch {
    if (session !== _scannerSession || currentVisibleTab() !== 'scan') return;
    _scanner = null;
    _scannerState = 'idle';
    try {
      await scanner.clear();
    } catch {}
    toast('No se pudo acceder a la cámara');
  }
}

function updateSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.update().catch(() => {}));
    });
  }
  toast('Actualizando...');
  setTimeout(() => location.reload(), 500);
}
