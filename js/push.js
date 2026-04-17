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
    });
    OneSignal.Notifications.requestPermission();
    // Get player ID
    myPlayerId = OneSignal.User.PushSubscription.id || null;
    OneSignal.User.PushSubscription.addEventListener('change', (e) => {
      myPlayerId = e.current.id || null;
      storeSetPlayerId(myPlayerId);
    });
    if (myPlayerId) storeSetPlayerId(myPlayerId);

    // Listen for incoming push data (calendar sync)
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      const data = event.notification.additionalData;
      if (!data) return;
      if (data.calSync) {
        pushHandleSync(data.calSync);
        event.preventDefault();
        toast(`📅 ${data.calSync.name} actualizado`);
      }
      if (data.subscribe) {
        storeAddSubscriber(data.subscribe.calId, data.subscribe.playerId);
        event.preventDefault();
        toast('Nuevo suscriptor registrado ✓');
      }
    });
  });
}

function pushHandleSync(calData) {
  if (!calData || !calData.id) return;
  const result = storeImportCalendar(calData);
  // If we're currently viewing this calendar, refresh
  if (currentCal && currentCal.id === calData.id) {
    currentCal = result.cal;
    calRender();
  }
  renderCalSelector();
}

/* Send calendar data to all subscribers via OneSignal REST API */
async function pushNotifySubscribers() {
  if (!currentCal || currentCal.readonly) return;
  const subscribers = storeGetSubscribers(currentCal.id);
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

/* Register ourselves as subscriber to a calendar owner */
async function pushRegisterWithOwner(ownerPlayerId, calId) {
  const myId = myPlayerId || storeGetPlayerId();
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
