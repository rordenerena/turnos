/* gcalendar.js — Google Calendar auth + source-of-truth helpers */

const GOOGLE_CLIENT_ID = '743453800087-molu80v03v3ms24ovp194vscc53nr6aj.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const TURNOS_CALENDAR_SUMMARY = 'Turnos';
const TURNOS_CALENDAR_MARKER = 'turnosApp=1';
const TURNOS_DATA_CALENDAR_SUMMARY = 'Turnos · Datos';
const TURNOS_DATA_CALENDAR_MARKER = 'turnosDataApp=1';
const TURNOS_DATA_CONFIG_KIND = 'imported-config';
const TURNOS_DATA_CONFIG_DATE = '2000-01-01';
const TURNOS_DATA_CONFIG_VERSION = 2;

let googleToken = null;
let googleTokenExpiry = 0;
let googleTokenClient = null;
let googleProfile = null;
let googleReady = false;
let googleOwnerCalendar = null;
let googleDataCalendar = null;
let googleTurnosDuplicateSummary = null;
let googleDataCalendarReadyPromise = null;
let _googleLoginResolver = null;
let _googleLoginRejecter = null;

function googleCalendarOwnerId(calendarId) {
  return `owner:${calendarId}`;
}

function googleCalendarDataId(calendarId) {
  return `data:${calendarId}`;
}

function googleCalendarCloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function googleCalendarShortId(value) {
  const text = String(value || '').trim();
  if (!text) return 'sin id';
  if (text.length <= 26) return text;
  return `${text.slice(0, 12)}…${text.slice(-10)}`;
}

function googleCalendarHasSession() {
  return !!googleToken && googleTokenExpiry > Date.now();
}

function googleCalendarBuildIcalUrl(calendarId) {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/full.ics`;
}

function googleCalendarShowAuth(show) {
  const modal = document.getElementById('auth-gate');
  if (!modal) return;
  modal.classList.toggle('hidden', !show);
}

function googleCalendarPersistToken(accessToken, expiresIn) {
  googleToken = accessToken;
  googleTokenExpiry = Date.now() + ((expiresIn || 3600) * 1000);
  storeWriteJSON(AUTH_TOKEN_KEY, {
    access_token: googleToken,
    expires_at: googleTokenExpiry,
  });
}

function googleCalendarRestoreToken() {
  const saved = storeReadJSON(AUTH_TOKEN_KEY, null);
  if (!saved || !saved.access_token || !saved.expires_at || saved.expires_at <= Date.now()) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return false;
  }
  googleToken = saved.access_token;
  googleTokenExpiry = saved.expires_at;
  return true;
}

function googleCalendarInit() {
  return new Promise(resolve => {
    const wait = () => {
      if (typeof google === 'undefined' || !google.accounts?.oauth2) {
        setTimeout(wait, 250);
        return;
      }
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: response => {
          if (response.error) {
            if (_googleLoginRejecter) _googleLoginRejecter(new Error(response.error));
            _googleLoginResolver = null;
            _googleLoginRejecter = null;
            return;
          }
          googleCalendarPersistToken(response.access_token, response.expires_in);
          googleCalendarShowAuth(false);
          if (_googleLoginResolver) _googleLoginResolver(response);
          _googleLoginResolver = null;
          _googleLoginRejecter = null;
        },
      });
      googleReady = true;
      googleCalendarRestoreToken();
      resolve();
    };
    wait();
  });
}

function googleCalendarLogin() {
  return new Promise((resolve, reject) => {
    if (!googleReady || !googleTokenClient) {
      reject(new Error('Google todavía se está cargando'));
      return;
    }
    _googleLoginResolver = resolve;
    _googleLoginRejecter = reject;
    googleTokenClient.requestAccessToken({ prompt: googleCalendarHasSession() ? '' : 'consent' });
  });
}

async function googleApiFetch(url, options = {}) {
  if (!googleCalendarHasSession()) throw new Error('Sesión de Google vencida');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${googleToken}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data?.error?.message || data?.message || '';
    } catch {
      try { detail = await response.text(); } catch {}
    }
    throw new Error(detail || `Google API ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function googleCalendarFetchProfile() {
  googleProfile = await googleApiFetch('https://www.googleapis.com/oauth2/v2/userinfo');
  return googleProfile;
}

async function googleCalendarListAll(baseUrl, params) {
  let pageToken = '';
  const items = [];
  do {
    const url = new URL(baseUrl);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await googleApiFetch(url.toString());
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function googleCalendarEnsurePublicAcl(calendarId) {
  const aclItems = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/acl`, {});
  const existing = aclItems.find(item => item.scope?.type === 'default');
  if (existing && existing.role === 'reader') return existing;
  if (existing) {
    return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'reader' }),
    });
  }
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/acl`, {
    method: 'POST',
    body: JSON.stringify({ role: 'reader', scope: { type: 'default' } }),
  });
}

function googleCalendarIsAppCalendar(item) {
  return !!item && item.accessRole === 'owner' && (item.description || '').includes(TURNOS_CALENDAR_MARKER);
}

function googleCalendarCanonicalSortValue(item) {
  const summary = String(item?.summary || '').trim().toLocaleLowerCase('es');
  return [summary !== TURNOS_CALENDAR_SUMMARY.toLocaleLowerCase('es'), summary, String(item?.id || '')];
}

function googleCalendarCompareCanonicalCandidates(a, b) {
  const left = googleCalendarCanonicalSortValue(a);
  const right = googleCalendarCanonicalSortValue(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function googleCalendarComparePreferredCandidates(preferredSummary) {
  const normalizedPreferred = String(preferredSummary || '').trim().toLocaleLowerCase('es');
  return (a, b) => {
    const leftSummary = String(a?.summary || '').trim().toLocaleLowerCase('es');
    const rightSummary = String(b?.summary || '').trim().toLocaleLowerCase('es');
    const left = [leftSummary !== normalizedPreferred, leftSummary, String(a?.id || '')];
    const right = [rightSummary !== normalizedPreferred, rightSummary, String(b?.id || '')];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  };
}

async function googleCalendarListAppCalendars() {
  const calendars = await googleCalendarListAll('https://www.googleapis.com/calendar/v3/users/me/calendarList', { minAccessRole: 'owner' });
  return calendars.filter(googleCalendarIsAppCalendar).sort(googleCalendarCompareCanonicalCandidates);
}

function googleCalendarBuildAppDuplicateSummary(appCalendars, canonicalCalendar) {
  const canonical = canonicalCalendar || appCalendars[0] || null;
  const duplicates = (appCalendars || []).filter(item => canonical && item.id !== canonical.id);
  return {
    canonical: canonical ? {
      id: canonical.id,
      summary: canonical.summary || TURNOS_CALENDAR_SUMMARY,
      shortId: googleCalendarShortId(canonical.id),
    } : null,
    duplicates: duplicates.map(item => ({
      id: item.id,
      summary: item.summary || TURNOS_CALENDAR_SUMMARY,
      shortId: googleCalendarShortId(item.id),
      hasEvents: null,
      eventCount: null,
    })),
    duplicatesCount: duplicates.length,
    totalCalendars: (appCalendars || []).length,
    updatedAt: new Date().toISOString(),
  };
}

function googleCalendarSetAppDuplicateSummary(summary) {
  googleTurnosDuplicateSummary = summary ? googleCalendarCloneJson(summary) : null;
  return googleCalendarGetAppDuplicateSummary();
}

function googleCalendarGetAppDuplicateSummary() {
  return googleTurnosDuplicateSummary ? googleCalendarCloneJson(googleTurnosDuplicateSummary) : null;
}

async function googleCalendarRefreshAppDuplicateSummary(options = {}) {
  const appCalendars = await googleCalendarListAppCalendars();
  const summary = googleCalendarBuildAppDuplicateSummary(appCalendars, appCalendars[0] || null);
  if (options.includeEventCounts && summary.duplicatesCount) {
    for (const duplicate of summary.duplicates) {
      duplicate.eventCount = await googleCalendarCountCalendarEvents(duplicate.id);
      duplicate.hasEvents = duplicate.eventCount > 0;
    }
  }
  return googleCalendarSetAppDuplicateSummary(summary);
}

function googleCalendarBuildOwnerMeta(calendar) {
  return {
    calendarId: calendar.id,
    publicIcalUrl: googleCalendarBuildIcalUrl(calendar.id),
    summary: calendar.summary || TURNOS_CALENDAR_SUMMARY,
    updatedAt: new Date().toISOString(),
  };
}

function googleCalendarBuildDataMeta(calendar) {
  return {
    calendarId: calendar.id,
    summary: calendar.summary || TURNOS_DATA_CALENDAR_SUMMARY,
    updatedAt: new Date().toISOString(),
  };
}

function googleCalendarIsDataCalendar(item) {
  return !!item && item.accessRole === 'owner' && (item.description || '').includes(TURNOS_DATA_CALENDAR_MARKER);
}

async function googleCalendarListDataCalendars() {
  const calendars = await googleCalendarListAll('https://www.googleapis.com/calendar/v3/users/me/calendarList', { minAccessRole: 'owner', showHidden: 'true' });
  return calendars.filter(googleCalendarIsDataCalendar).sort(googleCalendarComparePreferredCandidates(TURNOS_DATA_CALENDAR_SUMMARY));
}

async function googleCalendarSelectCanonicalDataCalendar(dataCalendars) {
  const candidates = Array.isArray(dataCalendars) ? dataCalendars.slice() : [];
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const scored = await Promise.all(candidates.map(async calendar => {
    try {
      const items = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`, {
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: '2500',
        privateExtendedProperty: `turnosKind=${TURNOS_DATA_CONFIG_KIND}`,
      });
      return { calendar, configCount: (items || []).filter(item => item.status !== 'cancelled').length };
    } catch (error) {
      console.warn('No se pudo puntuar un calendario de datos duplicado', error);
      return { calendar, configCount: -1 };
    }
  }));

  scored.sort((left, right) => {
    if (left.configCount !== right.configCount) return right.configCount - left.configCount;
    return googleCalendarComparePreferredCandidates(TURNOS_DATA_CALENDAR_SUMMARY)(left.calendar, right.calendar);
  });

  return scored[0]?.calendar || candidates[0];
}

async function googleCalendarEnsureDataCalendarHidden(calendarId) {
  try {
    return await googleApiFetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ selected: false, hidden: true }),
    });
  } catch (error) {
    console.warn('No se pudo ocultar el calendario privado de datos', error);
    return null;
  }
}

async function googleCalendarResolveAppCalendar() {
  let appCalendars = await googleCalendarListAppCalendars();
  let appCalendar = appCalendars[0] || null;

  if (!appCalendar) {
    await googleApiFetch('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({
        summary: TURNOS_CALENDAR_SUMMARY,
        description: `Calendario administrado por la app Turnos\n${TURNOS_CALENDAR_MARKER}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }),
    });
    appCalendars = await googleCalendarListAppCalendars();
    appCalendar = appCalendars[0] || null;
  }

  if (!appCalendar) {
    throw new Error('No se pudo resolver el calendario de Turnos');
  }

  await googleCalendarEnsurePublicAcl(appCalendar.id);
  googleCalendarSetAppDuplicateSummary(googleCalendarBuildAppDuplicateSummary(appCalendars, appCalendar));

  const meta = googleCalendarBuildOwnerMeta(appCalendar);
  storeSaveOwnerMeta(meta);
  return {
    ...meta,
    id: googleCalendarOwnerId(appCalendar.id),
    readonly: false,
    sourceType: 'google',
  };
}

async function googleCalendarResolveDataCalendar() {
  let dataCalendars = await googleCalendarListDataCalendars();
  let dataCalendar = await googleCalendarSelectCanonicalDataCalendar(dataCalendars);

  if (!dataCalendar) {
    await googleApiFetch('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({
        summary: TURNOS_DATA_CALENDAR_SUMMARY,
        description: `Calendario privado de metadatos administrado por la app Turnos\n${TURNOS_DATA_CALENDAR_MARKER}`,
        timeZone: 'UTC',
      }),
    });
    dataCalendars = await googleCalendarListDataCalendars();
    dataCalendar = await googleCalendarSelectCanonicalDataCalendar(dataCalendars);
  }

  if (!dataCalendar) {
    throw new Error('No se pudo resolver el calendario privado de datos de Turnos');
  }

  await googleCalendarEnsureDataCalendarHidden(dataCalendar.id);

  const meta = googleCalendarBuildDataMeta(dataCalendar);
  googleDataCalendar = {
    ...meta,
    id: googleCalendarDataId(dataCalendar.id),
  };
  storeSaveDataMeta(meta);
  return googleDataCalendar;
}

async function googleCalendarEnsureDataCalendarReady() {
  if (googleDataCalendar?.calendarId) return googleDataCalendar;
  if (googleDataCalendarReadyPromise) return googleDataCalendarReadyPromise;
  googleDataCalendarReadyPromise = googleCalendarResolveDataCalendar()
    .finally(() => {
      googleDataCalendarReadyPromise = null;
    });
  return googleDataCalendarReadyPromise;
}

function googleCalendarEventPrivate(event) {
  return event.extendedProperties?.private || {};
}

function googleCalendarShiftTypeForEvent(event) {
  const priv = googleCalendarEventPrivate(event);
  return priv.turnosShiftType || (event.summary || '').trim();
}

function googleCalendarEventDate(event) {
  return event.originalStartTime?.date || event.start?.date || null;
}

function googleCalendarNormalizeDateValue(value) {
  if (!value) return null;
  if (value.date) return `date:${value.date}`;
  return `datetime:${value.dateTime || ''}|tz:${value.timeZone || ''}`;
}

function googleCalendarNormalizeEventPrivate(event) {
  const source = googleCalendarEventPrivate(event);
  const normalized = {};
  Object.keys(source).sort().forEach(key => {
    if (key === 'turnosPatternId') return;
    normalized[key] = String(source[key]);
  });
  return normalized;
}

function googleCalendarEventFingerprint(event, context = {}) {
  return JSON.stringify({
    kind: googleCalendarEventPrivate(event).turnosKind || (event.recurrence?.length ? 'pattern' : 'event'),
    status: event.status || 'confirmed',
    summary: String(event.summary || '').trim(),
    description: String(event.description || '').trim(),
    start: googleCalendarNormalizeDateValue(event.start),
    end: googleCalendarNormalizeDateValue(event.end),
    recurrence: (event.recurrence || []).slice(),
    originalStart: googleCalendarNormalizeDateValue(event.originalStartTime),
    recurringFingerprint: context.recurringFingerprint || null,
    private: googleCalendarNormalizeEventPrivate(event),
  });
}

function googleCalendarBuildEventFingerprintIndex(events) {
  const fingerprints = new Set();
  const masterFingerprints = new Map();
  const mastersByFingerprint = new Map();
  const rootsById = new Map();

  (events || []).forEach(event => {
    if (!event.recurringEventId) rootsById.set(event.id, event);
  });

  rootsById.forEach(event => {
    const fingerprint = googleCalendarEventFingerprint(event);
    masterFingerprints.set(event.id, fingerprint);
    if (!mastersByFingerprint.has(fingerprint)) mastersByFingerprint.set(fingerprint, event);
    fingerprints.add(fingerprint);
  });

  (events || []).forEach(event => {
    if (!event.recurringEventId) return;
    const fingerprint = googleCalendarEventFingerprint(event, {
      recurringFingerprint: masterFingerprints.get(event.recurringEventId) || null,
    });
    fingerprints.add(fingerprint);
  });

  return {
    fingerprints,
    masterFingerprints,
    mastersByFingerprint,
    rootsById,
  };
}

async function googleCalendarListCalendarRawEvents(calendarId, options = {}) {
  return googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    singleEvents: 'false',
    showDeleted: options.showDeleted === false ? 'false' : 'true',
    maxResults: String(options.maxResults || 2500),
  });
}

async function googleCalendarCountCalendarEvents(calendarId) {
  const events = await googleCalendarListCalendarRawEvents(calendarId, { showDeleted: false });
  return events.filter(event => event.status !== 'cancelled' || !!event.recurringEventId).length;
}

function googleCalendarBuildTransferredEventPayload(event) {
  const privateProps = googleCalendarCloneJson(googleCalendarEventPrivate(event));
  const payload = {
    summary: event.summary || '',
    description: event.description || '',
    start: googleCalendarCloneJson(event.start),
    end: googleCalendarCloneJson(event.end),
  };
  if (event.recurrence?.length) payload.recurrence = event.recurrence.slice();
  if (Object.keys(privateProps).length) payload.extendedProperties = { private: privateProps };
  if (event.transparency) payload.transparency = event.transparency;
  if (event.visibility) payload.visibility = event.visibility;
  if (event.colorId) payload.colorId = event.colorId;
  if (event.reminders) payload.reminders = googleCalendarCloneJson(event.reminders);
  return payload;
}

function googleCalendarBuildTransferredExceptionPayload(event) {
  const payload = googleCalendarBuildTransferredEventPayload(event);
  delete payload.recurrence;
  return payload;
}

async function googleCalendarCreateCalendarEvent(calendarId, payload) {
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function googleCalendarPatchCalendarEvent(calendarId, eventId, payload) {
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

async function googleCalendarDeleteCalendarById(calendarId) {
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, {
    method: 'DELETE',
  });
}

async function googleCalendarFindRecurringInstance(calendarId, recurringEventId, originalStartDate) {
  if (!originalStartDate) return null;
  const instances = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(recurringEventId)}/instances`, {
    showDeleted: 'true',
    maxResults: '12',
    timeMin: `${originalStartDate}T00:00:00Z`,
    timeMax: `${addDays(originalStartDate, 1)}T00:00:00Z`,
  });
  return instances.find(item => googleCalendarEventDate(item) === originalStartDate) || null;
}

async function googleCalendarMergeSingleDuplicateCalendar(sourceCalendar, canonicalCalendarId) {
  const sourceEvents = (await googleCalendarListCalendarRawEvents(sourceCalendar.id)).filter(event => event.status !== 'cancelled' || event.recurringEventId);
  const targetEvents = await googleCalendarListCalendarRawEvents(canonicalCalendarId);
  const sourceIndex = googleCalendarBuildEventFingerprintIndex(sourceEvents);
  const targetIndex = googleCalendarBuildEventFingerprintIndex(targetEvents);
  const result = {
    calendarId: sourceCalendar.id,
    summary: sourceCalendar.summary || TURNOS_CALENDAR_SUMMARY,
    inserted: 0,
    skipped: 0,
    exceptionsApplied: 0,
    deleted: false,
  };

  for (const event of sourceEvents.filter(item => !item.recurringEventId)) {
    const fingerprint = sourceIndex.masterFingerprints.get(event.id) || googleCalendarEventFingerprint(event);
    if (targetIndex.fingerprints.has(fingerprint)) {
      result.skipped += 1;
      continue;
    }
    const created = await googleCalendarCreateCalendarEvent(canonicalCalendarId, googleCalendarBuildTransferredEventPayload(event));
    targetIndex.fingerprints.add(fingerprint);
    if (created?.id) {
      targetIndex.masterFingerprints.set(created.id, fingerprint);
      if (!targetIndex.mastersByFingerprint.has(fingerprint)) targetIndex.mastersByFingerprint.set(fingerprint, created);
    }
    result.inserted += 1;
  }

  for (const event of sourceEvents.filter(item => item.recurringEventId)) {
    const recurringFingerprint = sourceIndex.masterFingerprints.get(event.recurringEventId) || null;
    const targetMaster = recurringFingerprint ? targetIndex.mastersByFingerprint.get(recurringFingerprint) : null;
    const fingerprint = googleCalendarEventFingerprint(event, { recurringFingerprint });
    if (targetIndex.fingerprints.has(fingerprint)) {
      result.skipped += 1;
      continue;
    }
    if (!targetMaster?.id) {
      throw new Error(`No se pudo localizar la serie destino para la excepción ${googleCalendarShortId(event.id)}`);
    }
    const targetInstance = await googleCalendarFindRecurringInstance(canonicalCalendarId, targetMaster.id, event.originalStartTime?.date || event.start?.date);
    if (!targetInstance?.id) {
      throw new Error(`No se pudo localizar la instancia destino ${event.originalStartTime?.date || event.start?.date || ''}`.trim());
    }
    if (event.status === 'cancelled') {
      await googleCalendarPatchCalendarEvent(canonicalCalendarId, targetInstance.id, { status: 'cancelled' });
    } else {
      await googleCalendarPatchCalendarEvent(canonicalCalendarId, targetInstance.id, googleCalendarBuildTransferredExceptionPayload(event));
    }
    targetIndex.fingerprints.add(fingerprint);
    result.exceptionsApplied += 1;
  }

  await googleCalendarDeleteCalendarById(sourceCalendar.id);
  result.deleted = true;
  return result;
}

async function googleCalendarMergeDuplicateAppCalendars() {
  const summary = await googleCalendarRefreshAppDuplicateSummary({ includeEventCounts: false });
  if (!summary?.duplicatesCount || !summary.canonical?.id) {
    return {
      action: 'merge',
      mergedCalendars: 0,
      deletedCalendars: 0,
      skippedEvents: 0,
      copiedEvents: 0,
      errors: [],
      updatedSummary: summary,
    };
  }

  const results = [];
  const errors = [];

  for (const duplicate of summary.duplicates) {
    try {
      results.push(await googleCalendarMergeSingleDuplicateCalendar(duplicate, summary.canonical.id));
    } catch (error) {
      errors.push(`No se pudo combinar ${duplicate.shortId}: ${error.message}`);
      results.push({
        calendarId: duplicate.id,
        summary: duplicate.summary,
        inserted: 0,
        skipped: 0,
        exceptionsApplied: 0,
        deleted: false,
        error: error.message,
      });
    }
  }

  await googleCalendarRefreshOwner({ silent: true });
  const updatedSummary = await googleCalendarRefreshAppDuplicateSummary({ includeEventCounts: true });
  return {
    action: 'merge',
    mergedCalendars: results.filter(item => !item.error).length,
    deletedCalendars: results.filter(item => item.deleted).length,
    skippedEvents: results.reduce((total, item) => total + (item.skipped || 0), 0),
    copiedEvents: results.reduce((total, item) => total + (item.inserted || 0) + (item.exceptionsApplied || 0), 0),
    calendarResults: results,
    errors,
    updatedSummary,
  };
}

async function googleCalendarDeleteDuplicateAppCalendars() {
  const summary = await googleCalendarRefreshAppDuplicateSummary({ includeEventCounts: true });
  if (!summary?.duplicatesCount) {
    return {
      action: 'delete',
      deletedCalendars: 0,
      errors: [],
      updatedSummary: summary,
    };
  }

  const errors = [];
  let deletedCalendars = 0;
  for (const duplicate of summary.duplicates) {
    try {
      await googleCalendarDeleteCalendarById(duplicate.id);
      deletedCalendars += 1;
    } catch (error) {
      errors.push(`No se pudo borrar ${duplicate.shortId}: ${error.message}`);
    }
  }

  const updatedSummary = await googleCalendarRefreshAppDuplicateSummary({ includeEventCounts: true });
  return {
    action: 'delete',
    deletedCalendars,
    errors,
    updatedSummary,
  };
}

function googleCalendarPush(target, key, item) {
  if (!target[key]) target[key] = [];
  target[key].push(item);
}

function googleCalendarParseRRuleUntil(recurrence) {
  const rrule = (recurrence || []).find(line => line.startsWith('RRULE:')) || '';
  const match = rrule.match(/UNTIL=(\d{8})T/);
  if (!match) return null;
  return `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
}

function googleCalendarPatternDayIndex(priv) {
  return Number(priv.turnosDayIndex ?? priv.turnosSequenceIndex ?? 0);
}

function googleCalendarPatternCycleLength(priv, fallback = 0) {
  return Number(priv.turnosCycleLength ?? priv.turnosSequenceLength ?? fallback);
}

function googleCalendarBuildRecurrenceUntil(recurrence, untilDate) {
  const untilValue = `${String(untilDate || '').replace(/-/g, '')}T235959Z`;
  return (recurrence || []).map(line => (line.startsWith('RRULE:')
    ? line.replace(/;UNTIL=\d{8}T\d{6}Z/, '').concat(`;UNTIL=${untilValue}`)
    : line));
}

function googleCalendarBuildPatterns(patternMasters) {
  const groups = {};
  patternMasters.forEach(event => {
    if (event.status === 'cancelled') return;
    if (event.recurringEventId) return;
    if (!event.recurrence || !event.recurrence.length) return;
    const priv = googleCalendarEventPrivate(event);
    const patternId = priv.turnosPatternId;
    if (!patternId) return;
    if (!groups[patternId]) {
      groups[patternId] = {
        patternId,
        cycleLength: googleCalendarPatternCycleLength(priv),
        sources: [],
      };
    }
    groups[patternId].sources.push(event);
  });

  return Object.values(groups).map(group => {
    const cycleLength = group.cycleLength || group.sources.length;
    const days = Array.from({ length: cycleLength }, () => ({ shifts: [] }));
    let startDate = null;
    let endDate = null;
    group.sources.forEach(event => {
      const priv = googleCalendarEventPrivate(event);
      const dayIndex = googleCalendarPatternDayIndex(priv);
      const shiftType = priv.turnosShiftType || event.summary || '';
      const eventStart = event.start?.date || null;
      const candidateStart = eventStart ? addDays(eventStart, -dayIndex) : null;
      if (!days[dayIndex]) days[dayIndex] = { shifts: [] };
      if (!days[dayIndex].shifts.includes(shiftType)) days[dayIndex].shifts.push(shiftType);
      if (!startDate || (candidateStart && candidateStart < startDate)) startDate = candidateStart || startDate;
      const until = googleCalendarParseRRuleUntil(event.recurrence);
      if (!endDate || (until && until > endDate)) endDate = until || endDate;
    });
    days.forEach(day => {
      day.shifts = day.shifts.sort((a, b) => sortShifts({ type: a }, { type: b }));
    });
    return {
      patternId: group.patternId,
      startDate,
      endDate,
      cycleLength,
      days,
      sources: group.sources.map(source => ({
        eventId: source.id,
        startDate: source.start?.date || null,
        recurrence: (source.recurrence || []).slice(),
        dayIndex: googleCalendarPatternDayIndex(googleCalendarEventPrivate(source)),
        cycleLength: googleCalendarPatternCycleLength(googleCalendarEventPrivate(source), cycleLength),
        shiftType: googleCalendarEventPrivate(source).turnosShiftType || source.summary || '',
      })),
    };
  }).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

function googleCalendarBuildOwnerSource(meta, expandedEvents, patternMasters) {
  const rawShifts = {};
  const events = {};

  expandedEvents.forEach(event => {
    if (event.status === 'cancelled') return;
    const priv = googleCalendarEventPrivate(event);
    const kind = priv.turnosKind || 'event';
    const date = googleCalendarEventDate(event);
    if (!date) return;

    if (kind === 'event') {
      googleCalendarPush(events, date, {
        text: event.summary || '',
        source: { kind: 'event', eventId: event.id },
      });
      return;
    }

    const isPatternInstance = !!event.recurringEventId;
    googleCalendarPush(rawShifts, date, {
      type: googleCalendarShiftTypeForEvent(event),
      note: event.description || '',
      source: {
        kind: isPatternInstance ? 'pattern-instance' : 'manual',
        isPatternInstance,
        eventId: event.id,
        recurringEventId: event.recurringEventId || null,
        originalStartDate: event.originalStartTime?.date || date,
        patternId: priv.turnosPatternId || null,
        dayIndex: googleCalendarPatternDayIndex(priv),
        cycleLength: googleCalendarPatternCycleLength(priv),
        shiftType: googleCalendarShiftTypeForEvent(event),
      },
    });
  });

  return {
    id: googleCalendarOwnerId(meta.calendarId),
    name: 'Mi calendario',
    readonly: false,
    sourceType: 'google',
    googleCalendarId: meta.calendarId,
    publicIcalUrl: meta.publicIcalUrl,
    rawShifts,
    shifts: buildShiftVisibilityMap(rawShifts),
    events,
    patterns: googleCalendarBuildPatterns(patternMasters),
    lastSyncedAt: new Date().toISOString(),
  };
}

async function googleCalendarRefreshOwner(options = {}) {
  const meta = storeGetOwnerMeta();
  if (!meta?.calendarId) throw new Error('No hay calendario propietario configurado');
  const range = getVisibleWindowRange();
  const expandedEvents = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events`, {
    singleEvents: 'true',
    showDeleted: 'true',
    maxResults: '2500',
    timeMin: `${range.start}T00:00:00Z`,
    timeMax: `${range.endExclusive}T00:00:00Z`,
  });
  const patternMasters = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events`, {
    singleEvents: 'false',
    showDeleted: 'false',
    maxResults: '2500',
    privateExtendedProperty: 'turnosKind=pattern',
  });

  googleOwnerCalendar = googleCalendarBuildOwnerSource(meta, expandedEvents, patternMasters);
  if (!currentCal || !currentCal.readonly || currentCal.id === googleOwnerCalendar.id) {
    currentCal = googleOwnerCalendar;
  }
  renderCalendarTabs();
  calRender();
  if (!options.silent) renderImportedList();
  return googleOwnerCalendar;
}

function googleCalendarImportedConfigDescription(payload) {
  return JSON.stringify(payload);
}

function googleCalendarCompactImportedSnapshot(source) {
  const rawShifts = source?.cache?.shifts || source?.shifts || {};
  const rawEvents = source?.cache?.events || source?.events || {};
  const shifts = {};
  const events = {};

  Object.entries(rawShifts).forEach(([date, items]) => {
    const compactItems = (items || [])
      .filter(item => item?.type)
      .map(item => ({
        t: item.type,
        ...(item.note ? { n: String(item.note) } : {}),
        ...(item.source?.isPatternInstance ? { p: 1 } : {}),
      }));
    if (compactItems.length) shifts[date] = compactItems;
  });

  Object.entries(rawEvents).forEach(([date, items]) => {
    const compactItems = (items || [])
      .map(item => ({ x: String(item?.text || '').trim() }))
      .filter(item => item.x);
    if (compactItems.length) events[date] = compactItems;
  });

  const snapshot = {
    ls: source?.lastSyncedAt || null,
    c: {
      shifts: Number(source?.counts?.shifts || 0),
      events: Number(source?.counts?.events || 0),
    },
    cache: {},
  };

  if (Object.keys(shifts).length) snapshot.cache.s = shifts;
  if (Object.keys(events).length) snapshot.cache.e = events;

  if (!snapshot.ls && !snapshot.c.shifts && !snapshot.c.events && !Object.keys(snapshot.cache).length) {
    return null;
  }

  return snapshot;
}

function googleCalendarExpandImportedSnapshot(snapshot) {
  const raw = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const shifts = {};
  const events = {};

  Object.entries(raw.cache?.s || {}).forEach(([date, items]) => {
    const normalized = (items || [])
      .filter(item => item?.t)
      .map(item => ({
        type: item.t,
        note: item.n || '',
        source: {
          kind: 'remote-snapshot',
          ...(item.p ? { isPatternInstance: true } : {}),
        },
      }));
    if (normalized.length) shifts[date] = normalized;
  });

  Object.entries(raw.cache?.e || {}).forEach(([date, items]) => {
    const normalized = (items || [])
      .map(item => ({ text: String(item?.x || '').trim(), source: { kind: 'remote-snapshot' } }))
      .filter(item => item.text);
    if (normalized.length) events[date] = normalized;
  });

  const counts = {
    shifts: Number(raw.c?.shifts || 0),
    events: Number(raw.c?.events || 0),
  };

  return {
    cache: { shifts, events },
    counts,
    lastSyncedAt: raw.ls || null,
  };
}

function googleCalendarMergeImportedConfigConfirmation(source, event) {
  const remoteMeta = googleCalendarHydrateImportedFromConfigEvent(event);
  return {
    ...source,
    ...remoteMeta,
    cache: source.cache || remoteMeta.cache,
    counts: source.counts || remoteMeta.counts,
    lastSyncedAt: source.lastSyncedAt || remoteMeta.lastSyncedAt,
  };
}

async function googleCalendarBuildDeterministicEventId(canonicalKey) {
  if (!crypto?.subtle?.digest) {
    let hash = 2166136261;
    String(canonicalKey || 'turnos-import').split('').forEach(char => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return `turnosimp${Math.abs(hash >>> 0).toString(32)}`;
  }
  const input = new TextEncoder().encode(String(canonicalKey || 'turnos-import'));
  const digest = await crypto.subtle.digest('SHA-256', input);
  const bytes = new Uint8Array(digest);
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let output = 'turnosimp';

  bytes.forEach(byte => {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  });

  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function googleCalendarImportedConfigPayload(source) {
  const canonicalKey = source.canonicalKey || storeImportedCanonicalKey(source);
  const turnosImportId = source.turnosImportId || storeImportedStableId(source);
  const googleCalendarId = storeCleanIdentityValue(source.googleCalendarId) || null;
  const snapshot = googleCalendarCompactImportedSnapshot(source);
  const payload = {
    version: TURNOS_DATA_CONFIG_VERSION,
    turnosImportId,
    canonicalKey,
    sourceType: source.sourceType || (googleCalendarId ? 'google-public' : 'ical'),
    icalUrl: storeNormalizeImportedUrl(source.icalUrl),
    googleCalendarId,
    aliasName: storeCleanImportedAlias(source.aliasName),
    name: storeCleanIdentityValue(source.name),
    ownerName: storeCleanIdentityValue(source.ownerName),
    ownerEmail: storeCleanIdentityValue(source.ownerEmail),
    updatedAt: new Date().toISOString(),
    ...(snapshot ? { snapshot } : {}),
  };
  return {
    summary: `Importado · ${storeImportedCalendarName({ ...source, canonicalKey, turnosImportId })}`,
    description: googleCalendarImportedConfigDescription(payload),
    start: { date: TURNOS_DATA_CONFIG_DATE },
    end: { date: addDays(TURNOS_DATA_CONFIG_DATE, 1) },
    transparency: 'transparent',
    visibility: 'private',
    extendedProperties: {
      private: {
        turnosApp: '1',
        turnosKind: TURNOS_DATA_CONFIG_KIND,
        turnosCanonicalKey: canonicalKey,
        turnosImportId,
        turnosSourceType: payload.sourceType,
        ...(googleCalendarId ? { turnosGoogleCalendarId: googleCalendarId.toLowerCase() } : {}),
      },
    },
  };
}

function googleCalendarImportedConfigParseDescription(event) {
  try {
    return JSON.parse(event.description || '{}');
  } catch {
    return {};
  }
}

function googleCalendarIsNotFoundError(error) {
  return /not found/i.test(String(error?.message || ''));
}

function googleCalendarHydrateImportedFromConfigEvent(event) {
  const priv = googleCalendarEventPrivate(event);
  const payload = googleCalendarImportedConfigParseDescription(event);
  const snapshot = googleCalendarExpandImportedSnapshot(payload.snapshot);
  const meta = {
    id: payload.turnosImportId || priv.turnosImportId || storeImportedStableId({
      googleCalendarId: payload.googleCalendarId || priv.turnosGoogleCalendarId || '',
      icalUrl: payload.icalUrl || '',
    }),
    turnosImportId: payload.turnosImportId || priv.turnosImportId || '',
    canonicalKey: payload.canonicalKey || priv.turnosCanonicalKey || '',
    sourceType: payload.sourceType || priv.turnosSourceType || 'ical',
    icalUrl: payload.icalUrl || '',
    googleCalendarId: payload.googleCalendarId || priv.turnosGoogleCalendarId || null,
    aliasName: payload.aliasName || '',
    name: payload.name || event.summary || '',
    ownerName: payload.ownerName || '',
    ownerEmail: payload.ownerEmail || '',
    remoteConfigEventId: event.id,
    remoteUpdatedAt: event.updated || null,
    cache: snapshot.cache,
    counts: snapshot.counts,
    lastSyncedAt: snapshot.lastSyncedAt,
  };
  if (!meta.turnosImportId) meta.turnosImportId = meta.id;
  if (!meta.canonicalKey) meta.canonicalKey = storeImportedCanonicalKey(meta);
  return meta;
}

async function googleCalendarListImportedConfigEvents() {
  await googleCalendarEnsureDataCalendarReady();
  const meta = storeGetDataMeta();
  if (!meta?.calendarId) throw new Error('No hay calendario privado de datos configurado');
  const events = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events`, {
    singleEvents: 'true',
    showDeleted: 'false',
    maxResults: '2500',
    privateExtendedProperty: `turnosKind=${TURNOS_DATA_CONFIG_KIND}`,
  });
  return events.filter(event => event.status !== 'cancelled');
}

async function googleCalendarListImportedConfigs() {
  const events = await googleCalendarListImportedConfigEvents();
  return events.map(googleCalendarHydrateImportedFromConfigEvent);
}

async function googleCalendarUpsertImportedConfig(source) {
  await googleCalendarEnsureDataCalendarReady();
  const meta = storeGetDataMeta();
  if (!meta?.calendarId) throw new Error('No hay calendario privado de datos configurado');
  const canonicalKey = source.canonicalKey || storeImportedCanonicalKey(source);
  if (!canonicalKey) throw new Error('No se pudo resolver la identidad del calendario importado');
  const eventId = await googleCalendarBuildDeterministicEventId(canonicalKey);
  const payload = googleCalendarImportedConfigPayload({
    ...source,
    id: source.turnosImportId || storeImportedStableId(source),
    turnosImportId: source.turnosImportId || storeImportedStableId(source),
    canonicalKey,
  });
  try {
    return await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!googleCalendarIsNotFoundError(error)) throw error;
    return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        id: eventId,
        ...payload,
      }),
    });
  }
}

async function googleCalendarDeleteImportedConfig(source) {
  await googleCalendarEnsureDataCalendarReady();
  const meta = storeGetDataMeta();
  if (!meta?.calendarId) throw new Error('No hay calendario privado de datos configurado');
  const canonicalKey = typeof source === 'string'
    ? storeImportedCanonicalKey(storeGetImportedById(source) || { id: source })
    : storeImportedCanonicalKey(source);
  if (!canonicalKey) return;
  const eventId = await googleCalendarBuildDeterministicEventId(canonicalKey);
  try {
    await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    if (!googleCalendarIsNotFoundError(error)) throw error;
  }
}

function googleCalendarShiftPayload(ds, shift) {
  return {
    summary: shift.type,
    description: shift.note || '',
    start: { date: ds },
    end: { date: addDays(ds, 1) },
    extendedProperties: {
      private: {
        turnosApp: '1',
        turnosKind: 'shift',
        turnosShiftType: shift.type,
      },
    },
  };
}

function googleCalendarEventPayload(ds, text) {
  return {
    summary: text,
    start: { date: ds },
    end: { date: addDays(ds, 1) },
    extendedProperties: {
      private: {
        turnosApp: '1',
        turnosKind: 'event',
      },
    },
  };
}

async function googleCalendarCreateEvent(payload) {
  const meta = storeGetOwnerMeta();
  return googleCalendarCreateCalendarEvent(meta.calendarId, payload);
}

async function googleCalendarDeleteEvent(eventId) {
  const meta = storeGetOwnerMeta();
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

async function googleCalendarPatchEvent(eventId, payload) {
  const meta = storeGetOwnerMeta();
  return googleCalendarPatchCalendarEvent(meta.calendarId, eventId, payload);
}

async function googleCalendarReplaceDayContent(ds, nextShifts, nextEvents) {
  const dayShifts = ((currentCal && currentCal.rawShifts && currentCal.rawShifts[ds]) || (currentCal && currentCal.shifts && currentCal.shifts[ds]) || []).slice();
  const visibleShifts = ((currentCal && currentCal.shifts && currentCal.shifts[ds]) || []).slice();
  const dayEvents = ((currentCal && currentCal.events && currentCal.events[ds]) || []).slice();
  const manualShifts = dayShifts.filter(item => item.source?.kind === 'manual');
  const patternShifts = dayShifts.filter(item => item.source?.kind === 'pattern-instance');
  const manualEvents = dayEvents.filter(item => item.source?.kind === 'event');
  const normalizedNextShifts = resolveDayShiftPriority(nextShifts || []);
  const nextExclusiveShift = normalizedNextShifts.find(item => isExclusiveShiftType(item.type));
  const visibleExclusiveOverride = visibleShifts.find(item => isExclusiveShiftType(item?.type) && !item.source?.isPatternInstance);
  const shouldCancelPatternShifts = !nextExclusiveShift && (!visibleExclusiveOverride || normalizedNextShifts.length > 0);
  const patternShiftTypes = new Set(patternShifts.map(item => item.type));
  const shiftsToCreate = normalizeDayShiftsByType(nextExclusiveShift
    ? normalizedNextShifts.filter(item => item.type === nextExclusiveShift.type || !patternShiftTypes.has(item.type))
    : normalizedNextShifts).sort(sortShifts);

  for (const item of manualShifts) {
    await googleCalendarDeleteEvent(item.source.eventId);
  }
  if (shouldCancelPatternShifts) {
    for (const item of patternShifts) {
      await googleCalendarPatchEvent(item.source.eventId, { status: 'cancelled' });
    }
  }
  for (const item of manualEvents) {
    await googleCalendarDeleteEvent(item.source.eventId);
  }
  for (const shift of shiftsToCreate) {
    await googleCalendarCreateEvent(googleCalendarShiftPayload(ds, shift));
  }
  for (const event of nextEvents) {
    await googleCalendarCreateEvent(googleCalendarEventPayload(ds, event.text));
  }
  await googleCalendarRefreshOwner({ silent: true });
}

async function googleCalendarReplaceDayShifts(ds, nextShifts) {
  return googleCalendarReplaceDayContent(ds, nextShifts, ((currentCal && currentCal.events && currentCal.events[ds]) || []).slice());
}

async function googleCalendarCreatePattern(days, startDate, endDate) {
  const patternId = uuid();
  const cycleLength = days.length;
  const creates = days.flatMap((day, dayIndex) => (day.shifts || []).map(shiftType => googleCalendarCreateEvent({
    summary: shiftType,
    start: { date: addDays(startDate, dayIndex) },
    end: { date: addDays(startDate, dayIndex + 1) },
    recurrence: [`RRULE:FREQ=DAILY;INTERVAL=${cycleLength};UNTIL=${endDate.replace(/-/g, '')}T235959Z`],
    extendedProperties: {
      private: {
        turnosApp: '1',
        turnosKind: 'pattern',
        turnosPatternId: patternId,
        turnosDayIndex: String(dayIndex),
        turnosCycleLength: String(cycleLength),
        turnosShiftType: shiftType,
      },
    },
  })));
  await Promise.all(creates);
  await googleCalendarRefreshOwner({ silent: true });
}

async function googleCalendarDeletePattern(patternId, mode = 'fromToday') {
  const pattern = (googleOwnerCalendar?.patterns || []).find(item => item.patternId === patternId);
  if (!pattern) return;
  const today = isoDate(new Date());
  const yesterday = addDays(today, -1);
  for (const source of pattern.sources) {
    try {
      if (mode === 'full') {
        await googleCalendarDeleteEvent(source.eventId);
      } else if (!source.startDate || source.startDate >= today) {
        await googleCalendarDeleteEvent(source.eventId);
      } else {
        await googleCalendarPatchEvent(source.eventId, {
          recurrence: googleCalendarBuildRecurrenceUntil(source.recurrence, yesterday),
        });
      }
    } catch (error) {
      if (!String(error.message || '').includes('Resource has been deleted')) throw error;
    }
  }
  await googleCalendarRefreshOwner({ silent: true });
}

async function googleCalendarDeleteEverythingRemote() {
  const ownerMeta = storeGetOwnerMeta();
  const dataMeta = storeGetDataMeta();
  if (ownerMeta?.calendarId) {
    await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ownerMeta.calendarId)}`, { method: 'DELETE' });
  }
  if (dataMeta?.calendarId) {
    await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(dataMeta.calendarId)}`, { method: 'DELETE' });
  }
  storeClearOwnerMeta();
  storeClearDataMeta();
}

async function googleCalendarBootstrap(options = {}) {
  const { deferDataCalendar = false } = options;
  if (!googleCalendarHasSession()) throw new Error('Necesitás iniciar sesión');
  await googleCalendarFetchProfile();
  await googleCalendarResolveAppCalendar();
  if (deferDataCalendar) {
    googleCalendarEnsureDataCalendarReady().catch(error => {
      console.warn('No se pudo preparar el calendario privado de datos en background', error);
    });
  } else {
    await googleCalendarEnsureDataCalendarReady();
  }
  return googleCalendarRefreshOwner();
}

function googleCalendarLogout() {
  if (googleToken) {
    try { google.accounts.oauth2.revoke(googleToken); } catch {}
  }
  googleToken = null;
  googleTokenExpiry = 0;
  googleProfile = null;
  googleOwnerCalendar = null;
  googleDataCalendar = null;
  googleDataCalendarReadyPromise = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
