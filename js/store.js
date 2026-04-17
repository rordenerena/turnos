/* store.js — localStorage CRUD for multi-calendar support */

const STORE_KEY = 'turnos_calendars';
const ACTIVE_KEY = 'turnos_active';

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function storeGetAll() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
}

function storeSaveAll(cals) {
  localStorage.setItem(STORE_KEY, JSON.stringify(cals));
}

function storeGet(id) {
  return storeGetAll()[id] || null;
}

function storeSave(cal) {
  const cals = storeGetAll();
  cal.updatedAt = new Date().toISOString();
  cals[cal.id] = cal;
  storeSaveAll(cals);
}

function storeDelete(id) {
  const cals = storeGetAll();
  delete cals[id];
  storeSaveAll(cals);
}

function storeGetActive() {
  return localStorage.getItem(ACTIVE_KEY);
}

function storeSetActive(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

function storeGetMine() {
  const cals = storeGetAll();
  return Object.values(cals).filter(c => !c.readonly);
}

function storeGetImported() {
  const cals = storeGetAll();
  return Object.values(cals).filter(c => c.readonly);
}

function storeCreateCalendar(name) {
  const cal = {
    id: uuid(),
    name: name || 'Mi calendario',
    version: 1,
    shifts: {},
    events: {},
    patterns: [],
    readonly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storeSave(cal);
  return cal;
}

function storeImportCalendar(data) {
  const cals = storeGetAll();
  const existing = cals[data.id];
  if (existing) {
    // Update existing imported calendar
    existing.name = data.name;
    existing.shifts = data.shifts;
    existing.events = data.events;
    existing.patterns = data.patterns;
    existing.updatedAt = data.updatedAt || new Date().toISOString();
    existing.readonly = true;
    storeSave(existing);
    return { cal: existing, isNew: false };
  }
  // New import
  const cal = { ...data, readonly: true };
  storeSave(cal);
  return { cal, isNew: true };
}

/* Ensure at least one own calendar exists */
function storeEnsureOwn() {
  const mine = storeGetMine();
  if (mine.length === 0) {
    const name = storeGetPendingName();
    if (name) {
      const cal = storeCreateCalendar(`Turnos de ${name}`);
      storeSetActive(cal.id);
      return cal;
    }
    // No name yet — trigger onboarding
    setTimeout(() => document.dispatchEvent(new CustomEvent('onboard')) );
    return null;
  }
  return mine[0];
}

function storeSavePendingName(name) {
  try { localStorage.setItem('pendingName', name); } catch {}
}

function storeGetPendingName() {
  try { return localStorage.getItem('pendingName'); } catch { return null; }
}

/* OneSignal player ID */
function storeSetPlayerId(id) {
  try { localStorage.setItem('turnos_player_id', id); } catch {}
}
function storeGetPlayerId() {
  try { return localStorage.getItem('turnos_player_id'); } catch { return null; }
}

/* Subscribers: who should receive push when MY calendar changes */
function storeAddSubscriber(calId, playerId) {
  if (!playerId) return;
  const key = `turnos_subs_${calId}`;
  const subs = JSON.parse(localStorage.getItem(key) || '[]');
  if (!subs.includes(playerId)) {
    subs.push(playerId);
    localStorage.setItem(key, JSON.stringify(subs));
  }
}
function storeGetSubscribers(calId) {
  return JSON.parse(localStorage.getItem(`turnos_subs_${calId}`) || '[]');
}

/* Owner player_id stored per imported calendar (to register ourselves) */
function storeSetOwnerPlayerId(calId, playerId) {
  const cal = storeGet(calId);
  if (cal) { cal.ownerPlayerId = playerId; storeSave(cal); }
}
