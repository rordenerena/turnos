/* push.js — OneSignal Web Push: init, subscribe, send calendar updates */

// ⚠️ Replace with your OneSignal credentials
const ONESIGNAL_APP_ID = '7fc7003b-33ff-4bff-8739-20cbd7745b55';
const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';
const ONESIGNAL_API_KEY = 'os_v2_app_p7dqaozt75f77bzzedf5o5c3kx2tspwifsceefme37s6y2wfarhg2reabx6hksjf5lzqgfiroye2gawadzsngiaksuzuoggu4sdfvwy';

let myPlayerId = null;

async function pushInit() {
  if (typeof OneSignalDeferred === 'undefined') return;
  OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      serviceWorkerParam: { scope: '/turnos/' },
      serviceWorkerPath: '/turnos/OneSignalSDKWorker.js',
    });
    OneSignal.Notifications.requestPermission();
    // Get player ID
    myPlayerId = OneSignal.User.PushSubscription.id || null;
    OneSignal.User.PushSubscription.addEventListener('change', (e) => {
      myPlayerId = e.current.id || null;
      storeSetPlayerId(myPlayerId);
      pushUpdateStatus();
    });
    if (myPlayerId) storeSetPlayerId(myPlayerId);
    pushUpdateStatus();

    // Re-subscribe to all imported calendars (in case previous subscribe push was missed)
    setTimeout(pushResubscribeAll, 3000);

    // DEBUG: show playerId
    toast(`🆔 ${myPlayerId || 'sin ID'}`);

    // Listen for incoming push data
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      const data = event.notification.additionalData;
      toast(`📩 Push recibido: ${JSON.stringify(data).substring(0, 80)}`);
      if (!data) return;
      if (data.calSync) {
        pushHandleSync(data.calSync);
        event.preventDefault();
        toast(`📅 ${data.calSync.name} actualizado`);
      }
      if (data.subscribe) {
        storeAddSubscriber(data.subscribe.calId, data.subscribe.playerId);
        event.preventDefault();
        toast(`🔔 Suscriptor: ${data.subscribe.playerId.substring(0, 8)}...`);
      }
    });

    // Handle notification click (background notifications)
    OneSignal.Notifications.addEventListener('click', (event) => {
      const data = event.notification.additionalData;
      toast(`👆 Click push: ${JSON.stringify(data).substring(0, 80)}`);
      if (!data) return;
      if (data.calSync) pushHandleSync(data.calSync);
      if (data.subscribe) storeAddSubscriber(data.subscribe.calId, data.subscribe.playerId);
    });
  });
}

function pushHandleSync(calData) {
  if (!calData || !calData.id) return;
  const result = storeImportCalendar(calData);
  if (currentCal && currentCal.id === calData.id) {
    currentCal = result.cal;
    calRender();
  }
  renderCalSelector();
}

/* Re-subscribe to all imported calendars that have ownerPlayerId (runs on app open) */
function pushResubscribeAll() {
  const myId = myPlayerId || storeGetPlayerId();
  if (!myId) return;
  const imported = storeGetImported();
  imported.forEach(c => {
    if (c.ownerPlayerId) {
      pushRegisterWithOwner(c.ownerPlayerId, c.id);
    }
  });
}

/* Send calendar data to all subscribers via OneSignal REST API */
async function pushNotifySubscribers() {
  if (!currentCal || currentCal.readonly) return;
  const subscribers = storeGetSubscribers(currentCal.id);
  toast(`📤 Subs: ${subscribers.length} → ${JSON.stringify(subscribers).substring(0, 60)}`);
  if (!subscribers.length) return;

  const payload = {
    id: currentCal.id,
    name: currentCal.name,
    shifts: currentCal.shifts,
    events: currentCal.events,
    patterns: currentCal.patterns,
    updatedAt: currentCal.updatedAt,
  };

  const body = {
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: subscribers,
    contents: { es: `${currentCal.name} actualizado`, en: `${currentCal.name} updated` },
    headings: { es: '📅 Turnos', en: '📅 Turnos' },
    data: { calSync: payload },
  };

  try {
    await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('Push send failed:', e);
  }
}

async function pushRegisterWithOwner(ownerPlayerId, calId) {
  const myId = myPlayerId || storeGetPlayerId();
  toast(`📨 Registrando con owner: ${ownerPlayerId.substring(0, 8)}... mi ID: ${(myId||'null').substring(0, 8)}`);
  if (!myId || !ownerPlayerId) return;
  const body = {
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: [ownerPlayerId],
    contents: { es: 'Nuevo suscriptor a tu calendario', en: 'New calendar subscriber' },
    headings: { es: '📅 Turnos', en: '📅 Turnos' },
    data: { subscribe: { calId, playerId: myId } },
  };
  try {
    await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {}
}

/* Bell status indicator */
function pushUpdateStatus() {
  const el = document.getElementById('push-status');
  if (!el) return;
  const id = myPlayerId || storeGetPlayerId();
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (id && granted) {
    el.textContent = '🟢🔔';
    el.title = 'Auto-sync activo';
  } else {
    el.textContent = '⚪🔔';
    el.title = 'Toca para activar auto-sync';
  }
}

async function pushFixStatus() {
  const id = myPlayerId || storeGetPlayerId();
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (id && granted) { toast('Auto-sync ya está activo ✓'); return; }
  if (typeof OneSignalDeferred === 'undefined') { toast('OneSignal no disponible'); return; }
  OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.Notifications.requestPermission();
    // Wait a moment for player_id to be assigned
    setTimeout(() => {
      myPlayerId = OneSignal.User.PushSubscription.id || null;
      if (myPlayerId) storeSetPlayerId(myPlayerId);
      pushUpdateStatus();
      if (myPlayerId) toast('Auto-sync activado ✓');
      else toast('No se pudo activar. Permitiste las notificaciones?');
    }, 2000);
  });
}
