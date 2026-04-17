/* app.js — Bootstrap, tab switching, calendar selector */

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3000);
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
  if (tab === 'settings') document.getElementById('my-cal-name').value = currentCal && !currentCal.readonly ? currentCal.name : '';
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

function deleteCurrentCalendar() {
  if (!currentCal) return;
  if (!confirm(`¿Eliminar "${currentCal.name}"?`)) return;
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

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
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
