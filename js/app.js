/* app.js — bootstrap, auth obligatoria y navegación */

let _headerTaps = 0;
let _headerTimer = null;
const VIEW_KEY = 'turnos_view';
const HEADER_VIEW_CONFIG = {
  calendar: { title: '📅 Turnos', button: 'menu' },
  patterns: { title: 'Patrones', button: 'back' },
  shared: { title: 'Compartir', button: 'back' },
  settings: { title: 'Configuración', button: 'back' }
};
let fabMenuOpen = false;
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
  if (googleOwnerCalendar) items.push({ id: googleOwnerCalendar.id, name: 'Mi calendario' });
  storeGetImported().forEach(meta => items.push({ id: meta.id, name: storeImportedCalendarName(meta) }));

  tabs.classList.toggle('hidden', items.length <= 1);
  tabs.innerHTML = items.map(item => `
    <button
      type="button"
      class="calendar-tab${currentCal && currentCal.id === item.id ? ' active' : ''}"
      onclick="showCalendar('${item.id}')"
    >${escapeHtml(item.name)}</button>
  `).join('');
}

function syncOwnerActionCopy() {
  const owner = getOwnerCalendar();
  const ownerName = owner?.name || 'Mi calendario';
  const patternCopy = document.getElementById('pattern-owner-context');
  const shareCopy = document.getElementById('share-owner-context');
  if (patternCopy) patternCopy.textContent = `Estas acciones se aplican siempre sobre ${ownerName}.`;
  if (shareCopy) shareCopy.textContent = `Vas a compartir siempre ${ownerName}, aunque estés viendo otro calendario.`;
}

function fabMainIconMarkup(isOpen) {
  return isOpen
    ? '<span class="fab-main-close" aria-hidden="true">×</span>'
    : `<span class="fab-main-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line></svg></span>`;
}

function renderFabMainButton() {
  const fabMain = document.getElementById('fab-main');
  if (!fabMain) return;
  fabMain.innerHTML = fabMainIconMarkup(fabMenuOpen);
  fabMain.setAttribute('aria-expanded', fabMenuOpen ? 'true' : 'false');
  fabMain.setAttribute('aria-label', fabMenuOpen ? 'Cerrar acciones rápidas' : 'Abrir acciones rápidas');
}

function headerButtonIconMarkup(mode) {
  if (mode === 'back') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line></svg>';
}

function goBackToCalendar() {
  closePrimaryDrawer();
  closeFabMenu();
  switchTab('calendar');
}

function syncHeaderState(view = currentVisibleTab()) {
  const config = HEADER_VIEW_CONFIG[view] || HEADER_VIEW_CONFIG.calendar;
  const title = document.getElementById('header-title');
  const button = document.getElementById('header-menu-button');
  if (title) title.textContent = config.title;
  if (config.button === 'back') {
    primaryDrawerOpen = false;
    document.getElementById('drawer-overlay')?.classList.add('hidden');
  }
  if (!button) return;

  button.classList.toggle('header-back-button', config.button === 'back');
  button.innerHTML = `<span class="header-menu-icon" aria-hidden="true">${headerButtonIconMarkup(config.button)}</span>`;

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

function closeFabMenu() {
  fabMenuOpen = false;
  document.getElementById('fab-actions')?.classList.add('hidden');
  renderFabMainButton();
}

function closePrimaryDrawer(event) {
  if (event && event.target && event.target.id !== 'drawer-overlay') return;
  primaryDrawerOpen = false;
  document.getElementById('drawer-overlay')?.classList.add('hidden');
  syncHeaderState();
}

function togglePrimaryDrawer() {
  primaryDrawerOpen = !primaryDrawerOpen;
  if (primaryDrawerOpen) closeFabMenu();
  document.getElementById('drawer-overlay')?.classList.toggle('hidden', !primaryDrawerOpen);
  syncHeaderState();
}

function toggleFabMenu() {
  fabMenuOpen = !fabMenuOpen;
  if (fabMenuOpen) closePrimaryDrawer();
  document.getElementById('fab-actions')?.classList.toggle('hidden', !fabMenuOpen);
  renderFabMainButton();
}

function openPrimaryMenuAction(action) {
  closePrimaryDrawer();
  closeFabMenu();
  if (action === 'scan') {
    scanOpen();
    return;
  }
  switchTab(action);
}

function fabSelectAction(action) {
  openPrimaryMenuAction(action);
}

function switchTab(tab) {
  localStorage.setItem(VIEW_KEY, tab);
  document.querySelectorAll('.tab-content').forEach(item => item.classList.toggle('active', item.id === `tab-${tab}`));

  if (tab === 'shared') {
    renderImportedList();
    document.getElementById('qr-container').classList.add('hidden');
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
    document.getElementById('owner-feed-url').textContent = googleOwnerCalendar?.publicIcalUrl || 'Pendiente';
  }
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
  renderFabMainButton();
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
function scanOpen() {
  closePrimaryDrawer();
  closeFabMenu();
  document.getElementById('scan-overlay').classList.remove('hidden');
  _scanner = new Html5Qrcode('scan-reader');
  _scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    async text => {
      scanClose();
      try {
        const url = new URL(text);
        if (url.hash.startsWith('#ical=')) {
          location.hash = url.hash;
          await shareCheckUrl();
        } else {
          toast('QR no válido');
        }
      } catch {
        toast('QR no válido');
      }
    }
  ).catch(() => toast('No se pudo acceder a la cámara'));
}

function scanClose(e) {
  if (e && e.target && e.target.id !== 'scan-overlay') return;
  document.getElementById('scan-overlay').classList.add('hidden');
  if (_scanner) _scanner.stop().catch(() => {});
  _scanner = null;
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
