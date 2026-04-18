/* app.js — bootstrap, auth obligatoria y navegación */

let _headerTaps = 0;
let _headerTimer = null;

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

function switchTab(tab) {
  localStorage.setItem('turnos_tab', tab);
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item.dataset.tab === tab));
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
    document.getElementById('google-user-name').textContent = googleProfile ? `👤 ${googleProfile.name || googleProfile.email}` : 'Sin sesión';
    document.getElementById('owner-feed-url').textContent = googleOwnerCalendar?.publicIcalUrl || 'Pendiente';
  }
}

function renderCalSelector() {
  const sel = document.getElementById('cal-selector');
  const items = [];
  if (googleOwnerCalendar) items.push(googleOwnerCalendar);
  items.push(...storeGetCachedSources());
  const activeId = currentCal ? currentCal.id : storeGetActive();
  sel.innerHTML = items.map(item => `
    <option value="${item.id}"${item.id === activeId ? ' selected' : ''}>${item.readonly ? '👁' : '✏️'} ${escapeHtml(item.name)}</option>
  `).join('');
}

async function selectCalendar(id) {
  if (googleOwnerCalendar && id === googleOwnerCalendar.id) {
    currentCal = googleOwnerCalendar;
    storeSetActive(id);
    renderCalSelector();
    calRender();
    renderPatternsList();
    return;
  }

  const importedMeta = storeGetImportedById(id);
  if (!importedMeta) return;
  currentCal = storeBuildImportedSource(importedMeta);
  storeSetActive(id);
  renderCalSelector();
  calRender();
  try {
    currentCal = await shareRefreshImportedCalendar(id, { silent: true });
    renderCalSelector();
    calRender();
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
  currentCal = await googleCalendarBootstrap();
  renderCalSelector();
  calRender();
  renderPatternsList();
  renderImportedList();

  const activeId = storeGetActive();
  if (activeId && activeId !== currentCal.id) {
    await selectCalendar(activeId);
  } else {
    storeSetActive(currentCal.id);
  }

  const savedTab = localStorage.getItem('turnos_tab');
  if (savedTab) switchTab(savedTab);

  try {
    await shareCheckUrl();
  } catch (error) {
    toast(`No se pudo importar el iCal: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  calInit();
  renderImportedList();

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
