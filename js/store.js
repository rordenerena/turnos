/* store.js — preferencias, metadatos y suscripciones auxiliares */

const ACTIVE_KEY = 'turnos_active_source';
const IMPORTS_KEY = 'turnos_imported_feeds';
const OWNER_META_KEY = 'turnos_owner_meta';
const AUTH_TOKEN_KEY = 'turnos_google_token';
const LEGACY_STORE_KEY = 'turnos_calendars';

function storeCleanIdentityValue(value) {
  return String(value || '').trim();
}

function storeNormalizeOwnerIdentity(source) {
  return {
    ownerName: storeCleanIdentityValue(source?.ownerName),
    ownerEmail: storeCleanIdentityValue(source?.ownerEmail),
  };
}

function storeOwnerIdentityText(source) {
  const { ownerName, ownerEmail } = storeNormalizeOwnerIdentity(source);
  if (ownerName && ownerEmail) return `${ownerName} · ${ownerEmail}`;
  return ownerName || ownerEmail || '';
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function storeReadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function storeWriteJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function storeGetActive() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function storeSetActive(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

function storeGetOwnerMeta() {
  return storeReadJSON(OWNER_META_KEY, null);
}

function storeSaveOwnerMeta(meta) {
  storeWriteJSON(OWNER_META_KEY, meta);
}

function storeClearOwnerMeta() {
  localStorage.removeItem(OWNER_META_KEY);
}

function storeGetImportedMap() {
  return storeReadJSON(IMPORTS_KEY, {});
}

function storeSaveImportedMap(imports) {
  storeWriteJSON(IMPORTS_KEY, imports);
}

function storeGetImported() {
  return Object.values(storeGetImportedMap()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

function storeGetImportedById(id) {
  return storeGetImportedMap()[id] || null;
}

function storeSaveImported(source) {
  const imports = storeGetImportedMap();
  const previous = imports[source.id] || {};
  const identity = storeNormalizeOwnerIdentity({
    ownerName: source.ownerName || previous.ownerName,
    ownerEmail: source.ownerEmail || previous.ownerEmail,
  });
  imports[source.id] = {
    ...previous,
    ...source,
    ...identity,
    readonly: true,
    updatedAt: new Date().toISOString(),
  };
  storeSaveImportedMap(imports);
  return imports[source.id];
}

function storeDeleteImported(id) {
  const imports = storeGetImportedMap();
  delete imports[id];
  storeSaveImportedMap(imports);
}

function storeClearImports() {
  localStorage.removeItem(IMPORTS_KEY);
}

function storeBuildImportedSource(meta) {
  const identity = storeNormalizeOwnerIdentity(meta);
  return {
    id: meta.id,
    name: meta.name || 'Calendario importado',
    readonly: true,
    sourceType: meta.sourceType || 'ical',
    icalUrl: meta.icalUrl,
    googleCalendarId: meta.googleCalendarId || null,
    publicIcalUrl: meta.icalUrl,
    shifts: meta.cache?.shifts || {},
    events: meta.cache?.events || {},
    patterns: [],
    lastSyncedAt: meta.lastSyncedAt || null,
    counts: meta.counts || { shifts: 0, events: 0 },
    ...identity,
  };
}

function storeGetCachedSources() {
  return storeGetImported().map(storeBuildImportedSource);
}

function storeReadLegacyCalendars() {
  return storeReadJSON(LEGACY_STORE_KEY, {});
}
