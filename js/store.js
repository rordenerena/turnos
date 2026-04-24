/* store.js — preferencias, metadatos y suscripciones auxiliares */

const ACTIVE_KEY = 'turnos_active_source';
const IMPORTS_KEY = 'turnos_imported_feeds';
const IMPORTS_ACCOUNT_KEY = 'turnos_imported_account';
const OWNER_META_KEY = 'turnos_owner_meta';
const DATA_META_KEY = 'turnos_data_meta';
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

function storeOwnerEmailNickname(source) {
  const { ownerEmail } = storeNormalizeOwnerIdentity(source);
  if (!ownerEmail) return '';
  return ownerEmail.split('@')[0] || ownerEmail;
}

function storeCleanImportedAlias(value) {
  return String(value || '').trim();
}

function storeImportedCalendarAutoName(source) {
  const rawName = storeCleanIdentityValue(source?.name);
  if (rawName && rawName !== 'Calendario importado') return rawName;

  const { ownerName } = storeNormalizeOwnerIdentity(source);
  if (ownerName) return `Calendario de ${ownerName}`;

  const nickname = storeOwnerEmailNickname(source);
  if (nickname) return `Calendario de ${nickname}`;

  return 'Calendario importado';
}

function storeImportedCalendarName(source) {
  const aliasName = storeCleanImportedAlias(source?.aliasName);
  return aliasName || storeImportedCalendarAutoName(source);
}

function storeImportedHasRemoteBackup(source) {
  return !!(storeCleanIdentityValue(source?.remoteConfigEventId) || storeCleanIdentityValue(source?.remoteUpdatedAt));
}

function storeImportedBackupLabel(source) {
  return storeImportedHasRemoteBackup(source) ? 'Backup en Google' : 'Solo local';
}

function storeImportedBackupTone(source) {
  return storeImportedHasRemoteBackup(source) ? 'remote' : 'local';
}

function storeNormalizeImportedAlias(aliasName, source) {
  const cleanAlias = storeCleanImportedAlias(aliasName);
  if (!cleanAlias) return '';
  return cleanAlias === storeImportedCalendarAutoName(source) ? '' : cleanAlias;
}

function storeNormalizeImportedUrl(url) {
  const cleanUrl = storeCleanIdentityValue(url);
  if (!cleanUrl) return '';
  try {
    const parsed = new URL(cleanUrl);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return cleanUrl;
  }
}

function storeImportedCanonicalKey(source) {
  const googleCalendarId = storeCleanIdentityValue(source?.googleCalendarId).toLowerCase();
  if (googleCalendarId) return `gcal:${googleCalendarId}`;
  const normalizedUrl = storeNormalizeImportedUrl(source?.icalUrl);
  return normalizedUrl ? `ical:${normalizedUrl}` : '';
}

function storeImportedStableId(source) {
  const canonicalKey = storeImportedCanonicalKey(source);
  return canonicalKey ? `import:${canonicalKey}` : `import:legacy:${uuid()}`;
}

function storeImportedAccountKey(source) {
  const email = storeCleanIdentityValue(source?.email || source?.ownerEmail).toLowerCase();
  return email || '';
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

function storeGetDataMeta() {
  return storeReadJSON(DATA_META_KEY, null);
}

function storeSaveDataMeta(meta) {
  storeWriteJSON(DATA_META_KEY, meta);
}

function storeClearDataMeta() {
  localStorage.removeItem(DATA_META_KEY);
}

function storeGetImportedMap() {
  return storeReadJSON(IMPORTS_KEY, {});
}

function storeSaveImportedMap(imports) {
  storeWriteJSON(IMPORTS_KEY, imports);
}

function storeGetImportedAccount() {
  return storeReadJSON(IMPORTS_ACCOUNT_KEY, null);
}

function storeSaveImportedAccount(source) {
  storeWriteJSON(IMPORTS_ACCOUNT_KEY, {
    email: storeImportedAccountKey(source),
    ownerName: storeCleanIdentityValue(source?.name || source?.ownerName),
    updatedAt: new Date().toISOString(),
  });
}

function storeClearImportedAccount() {
  localStorage.removeItem(IMPORTS_ACCOUNT_KEY);
}

function storeImportedAccountMatches(source) {
  const currentKey = storeImportedAccountKey(source);
  if (!currentKey) return false;
  const saved = storeGetImportedAccount();
  return !!saved?.email && saved.email === currentKey;
}

function storeFindImportedMatch(source, imports) {
  if (!imports) return null;
  if (source?.id && imports[source.id]) return imports[source.id];
  const canonicalKey = storeImportedCanonicalKey(source);
  if (!canonicalKey) return null;
  return Object.values(imports).find(item => storeImportedCanonicalKey(item) === canonicalKey) || null;
}

function storeGetImported() {
  return Object.values(storeGetImportedMap()).sort((a, b) => storeImportedCalendarName(a).localeCompare(storeImportedCalendarName(b), 'es'));
}

function storeGetImportedById(id) {
  return storeGetImportedMap()[id] || null;
}

function storeSaveImported(source) {
  const imports = storeGetImportedMap();
  const stableId = source.turnosImportId || storeImportedStableId(source) || source.id;
  const previous = storeFindImportedMatch({ ...source, id: stableId }, imports) || {};
  const identity = storeNormalizeOwnerIdentity({
    ownerName: source.ownerName || previous.ownerName,
    ownerEmail: source.ownerEmail || previous.ownerEmail,
  });
  const aliasName = source.aliasName === undefined
    ? storeCleanImportedAlias(previous.aliasName)
    : storeNormalizeImportedAlias(source.aliasName, { ...previous, ...source, ...identity });
  if (previous.id && previous.id !== stableId) delete imports[previous.id];
  imports[stableId] = {
    ...previous,
    ...source,
    id: stableId,
    ...identity,
    canonicalKey: source.canonicalKey || previous.canonicalKey || storeImportedCanonicalKey({ ...previous, ...source }),
    turnosImportId: source.turnosImportId || previous.turnosImportId || stableId,
    aliasName,
    readonly: true,
    updatedAt: new Date().toISOString(),
  };
  storeSaveImportedMap(imports);
  return imports[stableId];
}

function storeSaveImportedAlias(id, aliasName) {
  const existing = storeGetImportedById(id);
  if (!existing) return null;
  return storeSaveImported({
    ...existing,
    aliasName: storeNormalizeImportedAlias(aliasName, existing),
  });
}

function storeDeleteImported(id) {
  const imports = storeGetImportedMap();
  delete imports[id];
  storeSaveImportedMap(imports);
}

function storeClearImports() {
  localStorage.removeItem(IMPORTS_KEY);
}

function storeReplaceImportedMap(nextImports, options = {}) {
  const { preserveCache = true, previousImports = storeGetImportedMap() } = options;
  const normalizedItems = Array.isArray(nextImports) ? nextImports : Object.values(nextImports || {});
  const nextMap = {};

  normalizedItems.forEach(item => {
    const match = preserveCache ? storeFindImportedMatch(item, previousImports) : null;
    const merged = {
      ...(match || {}),
      ...item,
    };
    if (preserveCache && match?.cache && !item.cache) merged.cache = match.cache;
    if (preserveCache && match?.counts && !item.counts) merged.counts = match.counts;
    if (preserveCache && match?.lastSyncedAt && !item.lastSyncedAt) merged.lastSyncedAt = match.lastSyncedAt;
    const saved = storeSaveImported(merged);
    nextMap[saved.id] = saved;
  });

  storeSaveImportedMap(nextMap);
  return nextMap;
}

function storeBuildImportedSource(meta) {
  const identity = storeNormalizeOwnerIdentity(meta);
  const aliasName = storeCleanImportedAlias(meta?.aliasName);
  return {
    id: meta.id,
    name: storeImportedCalendarName({ ...meta, ...identity }),
    aliasName,
    readonly: true,
    sourceType: meta.sourceType || 'ical',
    canonicalKey: meta.canonicalKey || storeImportedCanonicalKey(meta),
    turnosImportId: meta.turnosImportId || meta.id,
    icalUrl: meta.icalUrl,
    googleCalendarId: meta.googleCalendarId || null,
    publicIcalUrl: meta.icalUrl,
    shifts: meta.cache?.shifts || {},
    events: meta.cache?.events || {},
    patterns: [],
    lastSyncedAt: meta.lastSyncedAt || null,
    counts: meta.counts || { shifts: 0, events: 0 },
    remoteConfigEventId: meta.remoteConfigEventId || '',
    remoteUpdatedAt: meta.remoteUpdatedAt || null,
    ...identity,
  };
}

function storeGetCachedSources() {
  return storeGetImported().map(storeBuildImportedSource);
}

function storeReadLegacyCalendars() {
  return storeReadJSON(LEGACY_STORE_KEY, {});
}
