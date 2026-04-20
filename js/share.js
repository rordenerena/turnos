/* share.js — compartir e importar vía iCal público */

function shareBuildImportUrl(icalUrl, ownerMeta = {}) {
  const hash = new URLSearchParams();
  hash.set('ical', icalUrl);
  const identity = storeNormalizeOwnerIdentity(ownerMeta);
  if (identity.ownerName) hash.set('ownerName', identity.ownerName);
  if (identity.ownerEmail) hash.set('ownerEmail', identity.ownerEmail);
  return `${location.origin}${location.pathname}#${hash.toString()}`;
}

function shareOwnerIdentityMarkup(source) {
  const identity = storeOwnerIdentityText(source);
  return identity ? `<div class="imp-owner">Propietario: ${escapeHtml(identity)}</div>` : '';
}

function shareParseImportHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const icalUrl = storeCleanIdentityValue(params.get('ical'));
  if (icalUrl) {
    return {
      icalUrl,
      ...storeNormalizeOwnerIdentity({
        ownerName: params.get('ownerName'),
        ownerEmail: params.get('ownerEmail'),
      }),
    };
  }

  if (!raw.startsWith('ical=')) return null;
  return {
    icalUrl: storeCleanIdentityValue(decodeURIComponent(raw.slice(5))),
    ownerName: '',
    ownerEmail: '',
  };
}

async function shareGenerate() {
  const ownerCal = typeof getOwnerCalendar === 'function' ? getOwnerCalendar() : currentCal;
  if (!ownerCal || ownerCal.readonly) { toast('Mi calendario no está disponible todavía'); return; }
  const icalUrl = ownerCal.publicIcalUrl;
  if (!icalUrl) { toast('Todavía no está listo el enlace público'); return; }
  const url = shareBuildImportUrl(icalUrl, {
    ownerName: googleProfile?.name,
    ownerEmail: googleProfile?.email,
  });
  await QRCode.toCanvas(document.getElementById('qr-canvas'), url, { width: 250, margin: 2, errorCorrectionLevel: 'L' });
  document.getElementById('share-url').textContent = url;
  document.getElementById('qr-container').classList.remove('hidden');
  toast('QR generado ✓');
}

function shareCopyLink() {
  const url = document.getElementById('share-url').textContent;
  navigator.clipboard.writeText(url).then(() => toast('Link copiado ✓')).catch(() => toast('No se pudo copiar'));
}

async function shareNative() {
  const url = document.getElementById('share-url').textContent;
  if (!url) { toast('Generá el link primero'); return; }
  if (!navigator.share) { toast('Compartir no disponible en este dispositivo'); return; }
  try {
    await navigator.share({
      title: 'Calendario de Turnos',
      text: 'Te comparto mi calendario de turnos.',
      url,
    });
  } catch (error) {
    if (error.name !== 'AbortError') toast('Error al compartir');
  }
}

function icalUnfold(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '\n');
}

function icalDecodeText(text) {
  return String(text || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function icalParseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...params] = left.split(';');
  return { name: name.toUpperCase(), params, value };
}

function icalDateValue(value) {
  const clean = (value || '').replace(/Z$/, '');
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  if (/^\d{8}T/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  return value || '';
}

function icalParse(text) {
  const lines = icalUnfold(text).split('\n');
  const calendar = { name: '', events: [] };
  let current = null;

  lines.forEach(rawLine => {
    const line = rawLine.trimEnd();
    if (!line) return;
    if (line === 'BEGIN:VEVENT') {
      current = { exdates: [] };
      return;
    }
    if (line === 'END:VEVENT') {
      if (current) calendar.events.push(current);
      current = null;
      return;
    }
    const parsed = icalParseLine(line);
    if (!parsed) return;
    const value = icalDecodeText(parsed.value);

    if (!current) {
      if (parsed.name === 'X-WR-CALNAME') calendar.name = value;
      return;
    }

    if (parsed.name === 'SUMMARY') current.summary = value;
    else if (parsed.name === 'DESCRIPTION') current.description = value;
    else if (parsed.name === 'UID') current.uid = value;
    else if (parsed.name === 'STATUS') current.status = value;
    else if (parsed.name === 'RRULE') current.rrule = value;
    else if (parsed.name === 'DTSTART') current.dtstart = icalDateValue(value);
    else if (parsed.name === 'DTEND') current.dtend = icalDateValue(value);
    else if (parsed.name === 'RECURRENCE-ID') current.recurrenceId = icalDateValue(value);
    else if (parsed.name === 'EXDATE') value.split(',').forEach(item => current.exdates.push(icalDateValue(item)));
  });
  return calendar;
}

function icalParseRRule(rrule) {
  const result = {};
  String(rrule || '').split(';').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) result[key] = value;
  });
  return result;
}

function icalShiftSummary(summary) {
  return ['M', 'T', 'N', 'L', 'R'].includes(summary) ? summary : null;
}

function googleCalendarIdFromIcalUrl(icalUrl) {
  try {
    const url = new URL(icalUrl);
    if (!/calendar\.google\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const icalIdx = parts.indexOf('ical');
    if (icalIdx < 0 || !parts[icalIdx + 1]) return null;
    return decodeURIComponent(parts[icalIdx + 1]);
  } catch {
    return null;
  }
}

function icalPush(target, date, item) {
  if (!target[date]) target[date] = [];
  target[date].push(item);
}

function icalBuildSource(meta, text) {
  const parsed = icalParse(text);
  const range = getVisibleWindowRange();
  const identity = storeNormalizeOwnerIdentity(meta);
  const aliasName = storeCleanImportedAlias(meta?.aliasName);
  const cancellations = new Set();
  const overrides = [];
  const recurring = [];
  const singles = [];

  parsed.events.forEach(event => {
    if (event.recurrenceId) {
      if ((event.status || '').toUpperCase() === 'CANCELLED') cancellations.add(`${event.uid}|${event.recurrenceId}`);
      else overrides.push(event);
      return;
    }
    if (event.rrule) recurring.push(event);
    else singles.push(event);
  });

  const shifts = {};
  const events = {};

  function addOccurrence(event, date) {
    const shiftType = icalShiftSummary(event.summary || '');
    if (shiftType) {
      icalPush(shifts, date, { type: shiftType, note: event.description || '', source: { kind: 'ical' } });
    } else {
      icalPush(events, date, { text: event.summary || '', source: { kind: 'ical' } });
    }
  }

  singles.forEach(event => {
    if (event.dtstart >= range.start && event.dtstart < range.endExclusive) addOccurrence(event, event.dtstart);
  });

  recurring.forEach(event => {
    const rule = icalParseRRule(event.rrule);
    if (rule.FREQ !== 'DAILY') return;
    const interval = Number(rule.INTERVAL || 1);
    const until = rule.UNTIL ? icalDateValue(rule.UNTIL) : addDays(range.endExclusive, -1);
    const exdates = new Set(event.exdates || []);
    let cursor = event.dtstart;
    while (cursor <= until && cursor < range.endExclusive) {
      if (cursor >= range.start && !exdates.has(cursor) && !cancellations.has(`${event.uid}|${cursor}`)) addOccurrence(event, cursor);
      cursor = addDays(cursor, interval);
    }
  });

  overrides.forEach(event => {
    if (event.recurrenceId >= range.start && event.recurrenceId < range.endExclusive) addOccurrence(event, event.recurrenceId);
  });

  return {
    id: meta.id,
    name: storeImportedCalendarAutoName({ ...meta, ...identity, name: parsed.name || meta.name || '' }),
    aliasName,
    readonly: true,
    sourceType: 'ical',
    googleCalendarId: meta.googleCalendarId || googleCalendarIdFromIcalUrl(meta.icalUrl),
    icalUrl: meta.icalUrl,
    publicIcalUrl: meta.icalUrl,
    ...identity,
    shifts,
    events,
    patterns: [],
    lastSyncedAt: new Date().toISOString(),
    counts: {
      shifts: Object.values(shifts).reduce((sum, items) => sum + items.length, 0),
      events: Object.values(events).reduce((sum, items) => sum + items.length, 0),
    },
  };
}

function shareBuildGoogleSource(meta, items) {
  const identity = storeNormalizeOwnerIdentity(meta);
  const aliasName = storeCleanImportedAlias(meta?.aliasName);
  const shifts = {};
  const events = {};

  items.forEach(event => {
    if (event.status === 'cancelled') return;
    const date = event.start?.date || event.originalStartTime?.date;
    if (!date) return;
    const summary = (event.summary || '').trim();
    const shiftType = icalShiftSummary(summary);
    if (shiftType) {
      icalPush(shifts, date, { type: shiftType, note: event.description || '', source: { kind: 'google-public' } });
      return;
    }
    icalPush(events, date, { text: summary, source: { kind: 'google-public' } });
  });

  return {
    id: meta.id,
    name: storeImportedCalendarAutoName({ ...meta, ...identity }),
    aliasName,
    readonly: true,
    sourceType: 'google-public',
    googleCalendarId: meta.googleCalendarId,
    icalUrl: meta.icalUrl,
    publicIcalUrl: meta.icalUrl,
    ...identity,
    shifts,
    events,
    patterns: [],
    lastSyncedAt: new Date().toISOString(),
    counts: {
      shifts: Object.values(shifts).reduce((sum, dayItems) => sum + dayItems.length, 0),
      events: Object.values(events).reduce((sum, dayItems) => sum + dayItems.length, 0),
    },
  };
}

async function shareRefreshImportedFromGoogle(meta) {
  const range = getVisibleWindowRange();
  const items = await googleCalendarListAll(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(meta.googleCalendarId)}/events`, {
    singleEvents: 'true',
    showDeleted: 'false',
    maxResults: '2500',
    timeMin: `${range.start}T00:00:00Z`,
    timeMax: `${range.endExclusive}T00:00:00Z`,
  });
  return shareBuildGoogleSource(meta, items);
}

async function shareRefreshImportedCalendar(id, options = {}) {
  const meta = storeGetImportedById(id);
  if (!meta?.icalUrl) throw new Error('No existe esa suscripción');
  const googleCalendarId = meta.googleCalendarId || googleCalendarIdFromIcalUrl(meta.icalUrl);
  const hydratedMeta = googleCalendarId ? { ...meta, googleCalendarId } : meta;
  if (googleCalendarId && !googleCalendarHasSession()) {
    throw new Error('Tu sesión de Google venció. Iniciá sesión de nuevo para actualizar este calendario.');
  }
  const source = (googleCalendarId && googleCalendarHasSession())
    ? await shareRefreshImportedFromGoogle(hydratedMeta)
    : await (async () => {
        const response = await fetch(meta.icalUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`No se pudo leer el iCal (${response.status})`);
        const text = await response.text();
        return icalBuildSource(hydratedMeta, text);
      })();
  const savedMeta = storeSaveImported({
    id: source.id,
    name: source.name,
    aliasName: source.aliasName,
    icalUrl: source.icalUrl,
    googleCalendarId: source.googleCalendarId || null,
    sourceType: source.sourceType,
    ownerName: source.ownerName,
    ownerEmail: source.ownerEmail,
    lastSyncedAt: source.lastSyncedAt,
    counts: source.counts,
    cache: {
      shifts: source.shifts,
      events: source.events,
    },
  });
  if (!options.silent) renderImportedList();
  const resolvedSource = {
    ...source,
    name: storeImportedCalendarName(savedMeta),
    aliasName: savedMeta.aliasName || '',
  };
  if (currentCal && currentCal.id === source.id) {
    currentCal = resolvedSource;
    calRender();
  }
  return resolvedSource;
}

async function shareRefreshImportedAction(id, options = {}) {
  const { silent = false, toastSuccess = true, toastError = true, onStateChange = null } = options;
  try {
    if (typeof onStateChange === 'function') onStateChange('refreshing');
    const source = await shareRefreshImportedCalendar(id, { silent });
    if (typeof onStateChange === 'function') onStateChange('success', source);
    if (toastSuccess) toast('Calendario actualizado ✓');
    return source;
  } catch (error) {
    if (typeof onStateChange === 'function') onStateChange('error', error);
    if (toastError) toast(`Error al actualizar: ${error.message}`);
    throw error;
  }
}

async function shareImportByUrl(payload) {
  const meta = typeof payload === 'string' ? { icalUrl: payload } : (payload || {});
  const icalUrl = storeCleanIdentityValue(meta.icalUrl);
  if (!icalUrl) throw new Error('Link iCal inválido');
  const googleCalendarId = googleCalendarIdFromIcalUrl(icalUrl);
  const id = googleCalendarId
    ? `import:gcal:${googleCalendarId}`
    : `import:${btoa(icalUrl).replace(/=+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const identity = storeNormalizeOwnerIdentity(meta);
  storeSaveImported({ id, icalUrl, googleCalendarId, sourceType: googleCalendarId ? 'google-public' : 'ical', name: storeImportedCalendarAutoName(identity), ...identity });
  return shareRefreshImportedCalendar(id, { silent: true });
}

function renameImported(id) {
  const meta = storeGetImportedById(id);
  if (!meta) {
    toast('No existe ese calendario');
    return;
  }

  const currentAlias = storeCleanImportedAlias(meta.aliasName);
  const automaticName = storeImportedCalendarAutoName(meta);
  const nextAlias = prompt(
    `Nombre visible para este calendario.\n\nDejá vacío para volver a \"${automaticName}\".`,
    currentAlias || automaticName,
  );
  if (nextAlias === null) return;

  const updatedMeta = storeSaveImportedAlias(id, nextAlias);
  if (!updatedMeta) {
    toast('No existe ese calendario');
    return;
  }

  if (currentCal && currentCal.id === id) currentCal = storeBuildImportedSource(updatedMeta);
  renderImportedList();
  renderCalendarTabs();
  calRender();

  const hasAlias = !!storeCleanImportedAlias(updatedMeta.aliasName);
  toast(hasAlias ? `Alias guardado: ${updatedMeta.aliasName}` : `Alias eliminado: ${storeImportedCalendarName(updatedMeta)}`);
}

function readonlyBannerRenameCurrent(event) {
  event?.preventDefault();
  if (!currentCal || !currentCal.readonly) return;
  renameImported(currentCal.id);
}

async function shareCheckUrl() {
  const payload = shareParseImportHash(location.hash || '');
  if (!payload?.icalUrl) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const imported = await shareImportByUrl(payload);
  currentCal = imported;
  storeSetActive(imported.id);
  renderCalendarTabs();
  renderImportedList();
  calRender();
  switchTab('calendar');
  toast(`Importado "${imported.name}" ✓`);
  return true;
}

function calItemCount(meta) {
  const counts = meta.counts || { shifts: 0, events: 0 };
  const parts = [];
  if (counts.shifts) parts.push(`${counts.shifts} turnos`);
  if (counts.events) parts.push(`${counts.events} eventos`);
  return parts.length ? ` (${parts.join(', ')})` : ' (sin datos cacheados)';
}

function renderImportedList() {
  const el = document.getElementById('imported-list');
  const imports = storeGetImported();
  let html = '';

  if (googleOwnerCalendar) {
    html += `
      <div class="imported-item">
        <div class="imp-body">
          <div class="imp-name">✏️ Mi calendario</div>
          <div class="imp-date">Feed público:</div>
          <div class="imp-url">${escapeHtml(googleOwnerCalendar.publicIcalUrl)}</div>
        </div>
        <div class="imp-actions">
          <button class="btn btn-sm btn-primary" onclick="selectCalendar('${googleOwnerCalendar.id}');switchTab('calendar')">Ver</button>
        </div>
      </div>
    `;
  }

  if (imports.length) {
    html += '<h3 style="margin:12px 0 4px">Calendarios importados</h3>';
    html += imports.map(meta => `
      <div class="imported-item">
        <div class="imp-body">
          <div class="imp-name">👁 ${escapeHtml(storeImportedCalendarName(meta))}${calItemCount(meta)}</div>
          ${shareOwnerIdentityMarkup(meta)}
          <div class="imp-date">Actualizado: ${meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toLocaleString('es') : 'pendiente'}</div>
        </div>
        <div class="imp-actions">
          <button class="btn btn-sm" onclick="renameImported('${meta.id}')" title="Renombrar calendario importado">✏️</button>
          <button class="btn btn-sm" onclick="refreshImported('${meta.id}')">🔄</button>
          <button class="btn btn-sm btn-primary" onclick="selectCalendar('${meta.id}');switchTab('calendar')">Ver</button>
          <button class="btn btn-sm btn-danger" onclick="removeImported('${meta.id}')">✕</button>
        </div>
      </div>
    `).join('');
  }

  el.innerHTML = html || '<p class="hint">Todavía no importaste calendarios.</p>';
}

async function refreshImported(id) {
  try {
    await shareRefreshImportedAction(id);
  } catch {
    // El feedback ya se muestra dentro de shareRefreshImportedAction.
  }
}

function removeImported(id) {
  storeDeleteImported(id);
  if (currentCal && currentCal.id === id) {
    currentCal = googleOwnerCalendar;
    if (currentCal) storeSetActive(currentCal.id);
  }
  renderImportedList();
  renderCalendarTabs();
  calRender();
  toast('Calendario eliminado');
}
