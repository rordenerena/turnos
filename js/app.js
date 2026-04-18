/* app.js — Bootstrap, tab switching, calendar selector */

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
  // No auto-hide — persistent until user acts
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
  if (tab === 'shared') {
    renderImportedList();
    document.getElementById('qr-container').classList.add('hidden');
  }
  if (tab === 'patterns') {
    renderPatternsList();
    // Initialize month input to current calendar view month
    const monthInput = document.getElementById('pattern-month');
    monthInput.value = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  }
  if (tab === 'settings') {
    document.getElementById('my-cal-name').value = currentCal && !currentCal.readonly ? currentCal.name : '';
    gdriveUpdateUI(!!gdriveToken);
  }
}

function renderCalSelector() {
  const sel = document.getElementById('cal-selector');
  const all = storeGetAll();
  const activeId = currentCal ? currentCal.id : storeGetActive();
  sel.innerHTML = Object.values(all).map(c =>
    `<option value="${c.id}"${c.id === activeId ? ' selected' : ''}>${c.readonly ? '👁 ' : '✏️ '}${c.name}</option>`
  ).join('');
}

function selectCalendar(id) {
  currentCal = storeGet(id);
  if (!currentCal) return;
  storeSetActive(id);
  if (currentCal.readonly) switchTab('calendar');
  renderCalSelector();
  calRender();
  renderPatternsList();
}

function saveMyName() {
  if (!currentCal || currentCal.readonly) { toast('No podés renombrar un calendario importado'); return; }
  const name = document.getElementById('my-cal-name').value.trim();
  if (!name) { toast('Escribí un nombre'); return; }
  currentCal.name = name;
  storeSave(currentCal);
  renderCalSelector();
  toast('Nombre guardado ✓');
}

async function deleteEverything() {
  if (!confirm('¿Borrar TODOS los calendarios de localStorage y Google Drive?')) return;
  if (!confirm('⚠️ Esta acción es IRREVERSIBLE. ¿Seguro?')) return;
  // Delete all Drive files
  if (gdriveToken) {
    try {
      const resp = await gapi.client.drive.files.list({
        q: "name contains 'turnos-' and mimeType='application/json' and trashed=false",
        fields: 'files(id)',
        spaces: 'drive',
      });
      for (const f of (resp.result.files || [])) {
        await gapi.client.drive.files.delete({ fileId: f.id }).catch(() => {});
      }
    } catch {}
  }
  // Clear localStorage
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem('turnos_gdrive_token');
  localStorage.removeItem('pendingName');
  currentCal = null;
  toast('Todo eliminado');
  location.reload();
}

function deleteCurrentCalendar() {
  if (!currentCal) return;
  if (!confirm(`¿Eliminar "${currentCal.name}"?`)) return;
  if (gdriveToken && currentCal.driveFileId) {
    gapi.client.drive.files.update({ fileId: currentCal.driveFileId, resource: { trashed: true } }).catch(() => {});
  }
  storeDelete(currentCal.id);
  const own = storeEnsureOwn();
  currentCal = own;
  storeSetActive(own.id);
  renderCalSelector();
  calRender();
  toast('Calendario eliminado');
}

/* Init */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize calendar system
  calInit();

  // Check URL hash for shared calendar import first
  shareCheckUrl();

  // Then ensure we have a calendar
  const mine = storeGetMine();
  if (mine.length === 0) {
    // No own calendar — show onboarding
    document.getElementById('onboard').classList.remove('hidden');
    return;
  }

  // Load active or first calendar
  const activeId = storeGetActive();
  currentCal = storeGet(activeId) || mine[0];
  storeSetActive(currentCal.id);

  renderCalSelector();
  calRender();

  // Init Google Drive sync
  gdriveInit();

  // Fetch updates for imported calendars from Drive (delayed to avoid hammering on reloads)
  setTimeout(gdriveFetchImported, 5000);

  // Register SW + detect updates
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      setInterval(() => reg.update(), 5 * 60 * 1000);
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch(() => {});
  }

  // Handle links when PWA is already open (launch_handler: focus-existing)
  if ('launchQueue' in window) {
    launchQueue.setConsumer(launchParams => {
      if (launchParams.targetURL) {
        const url = new URL(launchParams.targetURL);
        if (url.hash.startsWith('#cal=')) {
          location.hash = url.hash;
          shareCheckUrl();
          renderCalSelector();
          calRender();
        }
      }
    });
  }
});

/* QR Scanner */
let _scanner = null;
function scanOpen() {
  document.getElementById('scan-overlay').classList.remove('hidden');
  _scanner = new Html5Qrcode('scan-reader');
  _scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (text) => {
      scanClose();
      // Process the scanned URL
      try {
        const url = new URL(text);
        if (url.hash) {
          location.hash = url.hash;
          shareCheckUrl();
          renderCalSelector();
          calRender();
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
  if (!('serviceWorker' in navigator)) { toast('Service Worker no disponible'); return; }
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) {
      reg.update().then(() => {
        location.reload();
      }).catch(() => {
        location.reload();
      });
    }
  });
}

/* Onboarding */
document.addEventListener('onboard', () => {
  document.getElementById('onboard').classList.remove('hidden');
});

function onboardSubmit() {
  const name = document.getElementById('onboard-name').value.trim();
  if (!name) { toast('Escribí tu nombre'); return; }
  try { localStorage.setItem('pendingName', name); } catch {}
  document.getElementById('onboard').classList.add('hidden');

  // Initialize calendar system
  calInit();

  // Create calendar with name
  const cal = storeCreateCalendar(`Turnos de ${name}`);
  storeSetActive(cal.id);
  currentCal = cal;

  renderCalSelector();
  calRender();

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
