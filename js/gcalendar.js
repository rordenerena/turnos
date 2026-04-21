/* gcalendar.js — Google Calendar auth + source-of-truth helpers */

const GOOGLE_CLIENT_ID = '743453800087-molu80v03v3ms24ovp194vscc53nr6aj.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const TURNOS_CALENDAR_SUMMARY = 'Turnos';
const TURNOS_CALENDAR_MARKER = 'turnosApp=1';

let googleToken = null;
let googleTokenExpiry = 0;
let googleTokenClient = null;
let googleProfile = null;
let googleReady = false;
let googleOwnerCalendar = null;
let _googleLoginResolver = null;
let _googleLoginRejecter = null;

function googleCalendarOwnerId(calendarId) {
  return `owner:${calendarId}`;
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

async function googleCalendarResolveAppCalendar() {
  const cached = storeGetOwnerMeta();
  if (cached?.calendarId) {
    try {
      await googleApiFetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(cached.calendarId)}`);
      await googleCalendarEnsurePublicAcl(cached.calendarId);
      return {
        ...cached,
        id: googleCalendarOwnerId(cached.calendarId),
        readonly: false,
        sourceType: 'google',
      };
    } catch {}
  }

  const calendars = await googleCalendarListAll('https://www.googleapis.com/calendar/v3/users/me/calendarList', { minAccessRole: 'owner' });
  let appCalendar = calendars.find(item => (item.description || '').includes(TURNOS_CALENDAR_MARKER) && item.accessRole === 'owner');

  if (!appCalendar) {
    appCalendar = await googleApiFetch('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({
        summary: TURNOS_CALENDAR_SUMMARY,
        description: `Calendario administrado por la app Turnos\n${TURNOS_CALENDAR_MARKER}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }),
    });
  }

  await googleCalendarEnsurePublicAcl(appCalendar.id);

  const meta = {
    calendarId: appCalendar.id,
    publicIcalUrl: googleCalendarBuildIcalUrl(appCalendar.id),
    summary: appCalendar.summary || TURNOS_CALENDAR_SUMMARY,
    updatedAt: new Date().toISOString(),
  };
  storeSaveOwnerMeta(meta);
  return {
    ...meta,
    id: googleCalendarOwnerId(appCalendar.id),
    readonly: false,
    sourceType: 'google',
  };
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
        sequenceLength: Number(priv.turnosSequenceLength || 0),
        sources: [],
      };
    }
    groups[patternId].sources.push(event);
  });

  return Object.values(groups).map(group => {
    const sequenceLength = group.sequenceLength || group.sources.length;
    const sequence = new Array(sequenceLength).fill('');
    let startDate = null;
    let endDate = null;
    group.sources.forEach(event => {
      const priv = googleCalendarEventPrivate(event);
      const index = Number(priv.turnosSequenceIndex || 0);
      const shiftType = priv.turnosShiftType || event.summary || '';
      const eventStart = event.start?.date || null;
      const candidateStart = eventStart ? addDays(eventStart, -index) : null;
      sequence[index] = shiftType;
      if (!startDate || (candidateStart && candidateStart < startDate)) startDate = candidateStart || startDate;
      const until = googleCalendarParseRRuleUntil(event.recurrence);
      if (!endDate || (until && until > endDate)) endDate = until || endDate;
    });
    return {
      patternId: group.patternId,
      startDate,
      endDate,
      sequence,
      sources: group.sources.map(source => ({
        eventId: source.id,
        sequenceIndex: Number(googleCalendarEventPrivate(source).turnosSequenceIndex || 0),
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
        sequenceIndex: Number(priv.turnosSequenceIndex || 0),
        sequenceLength: Number(priv.turnosSequenceLength || 0),
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
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function googleCalendarDeleteEvent(eventId) {
  const meta = storeGetOwnerMeta();
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

async function googleCalendarPatchEvent(eventId, payload) {
  const meta = storeGetOwnerMeta();
  return googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

async function googleCalendarReplaceDayContent(ds, nextShifts, nextEvents) {
  const dayShifts = ((currentCal && currentCal.rawShifts && currentCal.rawShifts[ds]) || (currentCal && currentCal.shifts && currentCal.shifts[ds]) || []).slice();
  const visibleShifts = ((currentCal && currentCal.shifts && currentCal.shifts[ds]) || []).slice();
  const dayEvents = ((currentCal && currentCal.events && currentCal.events[ds]) || []).slice();
  const manualShifts = dayShifts.filter(item => item.source?.kind === 'manual');
  const patternShifts = dayShifts.filter(item => item.source?.kind === 'pattern-instance');
  const manualEvents = dayEvents.filter(item => item.source?.kind === 'event');
  const nextHasVacation = nextShifts.some(item => item.type === 'V');
  const visibleHasVacationOverride = visibleShifts.some(item => item?.type === 'V');
  const shouldCancelPatternShifts = !nextHasVacation && (!visibleHasVacationOverride || nextShifts.length > 0);
  const patternShiftTypes = new Set(patternShifts.map(item => item.type));
  const shiftsToCreate = nextHasVacation
    ? nextShifts.filter(item => item.type === 'V' || !patternShiftTypes.has(item.type))
    : nextShifts;

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

async function googleCalendarCreatePattern(sequence, startDate, endDate) {
  const patternId = uuid();
  const sequenceLength = sequence.length;
  const creates = sequence.map((shiftType, index) => googleCalendarCreateEvent({
    summary: shiftType,
    start: { date: addDays(startDate, index) },
    end: { date: addDays(startDate, index + 1) },
    recurrence: [`RRULE:FREQ=DAILY;INTERVAL=${sequenceLength};UNTIL=${endDate.replace(/-/g, '')}T235959Z`],
    extendedProperties: {
      private: {
        turnosApp: '1',
        turnosKind: 'pattern',
        turnosPatternId: patternId,
        turnosSequenceIndex: String(index),
        turnosSequenceLength: String(sequenceLength),
        turnosShiftType: shiftType,
      },
    },
  }));
  await Promise.all(creates);
  await googleCalendarRefreshOwner({ silent: true });
}

async function googleCalendarDeletePattern(patternId) {
  const pattern = (googleOwnerCalendar?.patterns || []).find(item => item.patternId === patternId);
  if (!pattern) return;
  for (const source of pattern.sources) {
    try {
      await googleCalendarDeleteEvent(source.eventId);
    } catch (error) {
      if (!String(error.message || '').includes('Resource has been deleted')) throw error;
    }
  }
  await googleCalendarRefreshOwner({ silent: true });
}

async function googleCalendarDeleteEverythingRemote() {
  const meta = storeGetOwnerMeta();
  if (meta?.calendarId) {
    await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.calendarId)}`, { method: 'DELETE' });
  }
  storeClearOwnerMeta();
}

async function googleCalendarBootstrap() {
  if (!googleCalendarHasSession()) throw new Error('Necesitás iniciar sesión');
  await googleCalendarFetchProfile();
  await googleCalendarResolveAppCalendar();
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
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
