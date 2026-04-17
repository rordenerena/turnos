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
    const cal = storeCreateCalendar('Mi calendario');
    storeSetActive(cal.id);
    return cal;
  }
  return mine[0];
}
