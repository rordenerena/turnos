/* calendar.js — render mensual, turnos y patrones remotos */

let currentCal = null;
let calYear, calMonth;
let selectedDate = null;
let patternDays = [];
let patternCurrentDay = [];
let readonlyBannerRefreshState = { calendarId: null, status: 'idle', resetTimer: null };
const READONLY_BANNER_VISIBILITY_KEY = 'turnos_readonly_banner_visibility';
const readonlyBannerHiddenByCalendar = loadReadonlyBannerHiddenByCalendar();

function loadReadonlyBannerHiddenByCalendar() {
  try {
    const raw = localStorage.getItem(READONLY_BANNER_VISIBILITY_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return new Set();
    return new Set(Object.entries(parsed)
      .filter(([calendarId, hidden]) => calendarId && hidden === true)
      .map(([calendarId]) => calendarId));
  } catch {
    return new Set();
  }
}

function persistReadonlyBannerHiddenByCalendar() {
  try {
    const visibilityByCalendar = {};
    readonlyBannerHiddenByCalendar.forEach(calendarId => {
      if (calendarId) visibilityByCalendar[calendarId] = true;
    });
    localStorage.setItem(READONLY_BANNER_VISIBILITY_KEY, JSON.stringify(visibilityByCalendar));
  } catch {
    // Si localStorage falla, mantenemos el estado en memoria sin romper la app.
  }
}

function setReadonlyBannerVisibility(calendarId, visible) {
  if (!calendarId) return;
  if (visible) readonlyBannerHiddenByCalendar.delete(calendarId);
  else readonlyBannerHiddenByCalendar.add(calendarId);
  persistReadonlyBannerHiddenByCalendar();
}

function readonlyBannerResetLater(calendarId) {
  clearTimeout(readonlyBannerRefreshState.resetTimer);
  readonlyBannerRefreshState.resetTimer = setTimeout(() => {
    if (readonlyBannerRefreshState.calendarId !== calendarId) return;
    readonlyBannerRefreshState.status = 'idle';
    if (currentCal && currentCal.id === calendarId && currentCal.readonly) calRender();
  }, 1400);
}

function readonlyBannerUpdateRefreshState(calendarId, status) {
  readonlyBannerRefreshState.calendarId = calendarId;
  readonlyBannerRefreshState.status = status;
  if (status === 'success' || status === 'error') readonlyBannerResetLater(calendarId);
  if (currentCal && currentCal.id === calendarId && currentCal.readonly) calRender();
}

function readonlyBannerRefreshMarkup(status) {
  if (status === 'refreshing') return '<span class="readonly-banner-spinner" aria-hidden="true"></span>';
  if (status === 'success') return appIconSpan('success');
  if (status === 'error') return appIconSpan('warning');
  return appIconSpan('refresh');
}

async function readonlyBannerRefreshCurrent(event) {
  event?.preventDefault();
  if (!currentCal || !currentCal.readonly) return;
  const calendarId = currentCal.id;
  if (readonlyBannerRefreshState.calendarId === calendarId && readonlyBannerRefreshState.status === 'refreshing') return;
  try {
    await shareRefreshImportedAction(calendarId, {
      silent: true,
      toastSuccess: false,
      toastError: true,
      onStateChange: status => readonlyBannerUpdateRefreshState(calendarId, status),
    });
  } catch {
    // El error visual y el toast ya se manejan en shareRefreshImportedAction.
  }
}

function isReadonlyBannerVisible(calendarId) {
  return !!calendarId && !readonlyBannerHiddenByCalendar.has(calendarId);
}

function closeReadonlyBanner(event) {
  event?.preventDefault();
  if (!currentCal || !currentCal.readonly) return;
  setReadonlyBannerVisibility(currentCal.id, false);
  calRender();
}

async function toggleReadonlyBannerForCalendar(calendarId, event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!calendarId) return;

  if (!currentCal || currentCal.id !== calendarId) {
    setReadonlyBannerVisibility(calendarId, true);
    await selectCalendar(calendarId);
    return;
  }

  if (!currentCal.readonly) return;

  setReadonlyBannerVisibility(calendarId, !isReadonlyBannerVisible(calendarId));

  calRender();
}

function getModalDraftDay(ds) {
  if (typeof modalGetDraft === 'function') return modalGetDraft(ds);
  return null;
}

function calInit() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calInitSwipe();
}

function getVisibleWindowRange() {
  const start = new Date(calYear, calMonth - 1, 1);
  const endExclusive = new Date(calYear, calMonth + 2, 1);
  return {
    start: isoDate(start),
    endExclusive: isoDate(endExclusive),
  };
}

function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calRender();
  refreshVisibleSource();
}

function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calRender();
  refreshVisibleSource();
}

function calToday() {
  const n = new Date();
  calYear = n.getFullYear();
  calMonth = n.getMonth();
  calRender();
  refreshVisibleSource();
}

function calRender() {
  const label = document.getElementById('cal-month-label');
  const grid = document.getElementById('cal-grid');
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  label.textContent = `${months[calMonth]} ${calYear}`;

  const first = new Date(calYear, calMonth, 1);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
  const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
  const trailingDays = totalCells - startDay - daysInMonth;
  const todayStr = isoDate(new Date());

  let html = '';
  for (let i = 0; i < startDay; i++) {
    const day = prevMonthDays - startDay + i + 1;
    const ds = isoDate(new Date(calYear, calMonth - 1, day));
    html += renderCalendarDay(ds, day, todayStr, false);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(calYear, calMonth, d);
    html += renderCalendarDay(ds, d, todayStr, true);
  }
  for (let d = 1; d <= trailingDays; d++) {
    const ds = isoDate(new Date(calYear, calMonth + 1, d));
    html += renderCalendarDay(ds, d, todayStr, false);
  }
  grid.innerHTML = html;
  grid.style.gridTemplateRows = `repeat(${totalCells / 7}, 1fr)`;

  const banner = document.getElementById('readonly-banner');
  const readonly = !!(currentCal && currentCal.readonly);
  const bannerVisible = readonly && isReadonlyBannerVisible(currentCal.id);
  if (bannerVisible) {
    const refreshState = readonlyBannerRefreshState.calendarId === currentCal.id ? readonlyBannerRefreshState.status : 'idle';
    const ownerIdentity = storeOwnerIdentityText(currentCal);
    banner.innerHTML = `
      <span class="readonly-banner-copy">👁 ${escapeHtml(currentCal.name)} (solo lectura)${ownerIdentity ? `<span class="readonly-banner-owner"> · Propietario: ${escapeHtml(ownerIdentity)}</span>` : ''}</span>
      <span class="readonly-banner-actions">
        <button
          type="button"
          class="btn btn-sm readonly-banner-refresh icon-button"
          onclick="readonlyBannerRenameCurrent(event)"
          aria-label="Renombrar calendario importado"
          title="Renombrar calendario importado"
        >${appIconSpan('edit')}</button>
        <button
          type="button"
          class="btn btn-sm readonly-banner-refresh icon-button"
          data-state="${refreshState}"
          onclick="readonlyBannerRefreshCurrent(event)"
          aria-label="Actualizar calendario importado"
          title="Actualizar calendario importado"
        >${readonlyBannerRefreshMarkup(refreshState)}</button>
        <button
          type="button"
          class="btn btn-sm readonly-banner-refresh icon-button"
          onclick="closeReadonlyBanner(event)"
          aria-label="Cerrar aviso de solo lectura"
          title="Cerrar aviso de solo lectura"
        >${appIconSpan('close')}</button>
      </span>
    `;
    banner.classList.remove('hidden');
  } else {
    banner.innerHTML = '';
    banner.classList.add('hidden');
  }
}

function renderCalendarDay(ds, dayNumber, todayStr, isCurrentMonth) {
  const shifts = getDayShifts(ds);
  const evts = getDayEvents(ds);
  const isPastDay = ds < todayStr;
  let html = `<div class="cal-day${ds === todayStr ? ' today' : ''}${isCurrentMonth ? '' : ' adjacent-month'}${isPastDay ? ' past' : ''}" onclick="dayClick('${ds}')">`;
  html += `<div class="day-num">${dayNumber}</div>`;
  if (shifts.length) {
    html += '<div class="day-shifts">';
    shifts.forEach(s => {
      const note = s.note ? ` <small>${escapeHtml(s.note)}</small>` : '';
      html += `<div class="day-shift s-${escapeHtml(s.type)}">${escapeHtml(s.type)}${note}</div>`;
    });
    html += '</div>';
  }
  if (evts.length) {
    html += `<div class="day-events"><span class="event-dot"></span>${escapeHtml(evts.length > 1 ? String(evts.length) : truncateText(evts[0].text, 10))}</div>`;
  }
  html += '</div>';
  return html;
}

function sortShifts(a, b) {
  const order = { M: 0, T: 1, N: 2, R: 3, V: 4, L: 5 };
  return (order[a.type] ?? 10) - (order[b.type] ?? 10);
}

function resolveDayShiftPriority(items) {
  const shifts = (items || []).slice();
  const hasVacation = shifts.some(item => item?.type === 'V');
  if (!hasVacation) return shifts.sort(sortShifts);
  return shifts.filter(item => !(item.source?.isPatternInstance && item.type !== 'V')).sort(sortShifts);
}

function buildShiftVisibilityMap(shiftsByDay) {
  const visible = {};
  Object.entries(shiftsByDay || {}).forEach(([ds, items]) => {
    const resolved = resolveDayShiftPriority(items);
    if (resolved.length) visible[ds] = resolved;
  });
  return visible;
}

function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isoDate(date) {
  return dateStr(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(ds, amount) {
  const [y, m, d] = ds.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function truncateText(text, max) {
  return text && text.length > max ? `${text.slice(0, max)}…` : (text || '');
}

function dayClick(ds) {
  selectedDate = ds;
  modalOpen(ds);
}

let _touchStartX = 0;
let _touchStartY = 0;
function calInitSwipe() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  grid.addEventListener('touchstart', e => {
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
  }, { passive: true });
  grid.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _touchStartX;
    const dy = e.changedTouches[0].clientY - _touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) calPrev(); else calNext();
    }
  }, { passive: true });
}

function getDayShifts(ds) {
  const draft = getModalDraftDay(ds);
  const shifts = draft ? draft.shifts : ((currentCal && currentCal.shifts && currentCal.shifts[ds]) || []);
  return shifts.slice().sort(sortShifts);
}

function getDayEvents(ds) {
  const draft = getModalDraftDay(ds);
  const events = draft ? draft.events : ((currentCal && currentCal.events && currentCal.events[ds]) || []);
  return events.slice();
}

function setShift(shift) {
  if (!currentCal || currentCal.readonly) return;
  const current = getDayShifts(selectedDate);
  const byType = {};
  current.forEach(item => { byType[item.type] = item; });
  const nextTypes = current.map(item => item.type);

  if (shift === null) {
    modalSetDraftShifts([]);
  } else {
    const idx = nextTypes.indexOf(shift);
    if (idx >= 0) nextTypes.splice(idx, 1);
    else nextTypes.push(shift);
    modalSetDraftShifts(nextTypes.sort((a, b) => sortShifts({ type: a }, { type: b })).map(type => ({
      type,
      note: byType[type]?.note || '',
    })));
  }

  calRender();
  modalRenderShift();
}

function setShiftNote(type, note) {
  if (!currentCal || currentCal.readonly) return;
  modalSetDraftShifts(getDayShifts(selectedDate).map(item => ({
    type: item.type,
    note: item.type === type ? note.trim() : (item.note || ''),
  })));
  calRender();
  modalRenderShift();
}

function patternNormalizeShiftTypes(shifts) {
  const unique = [...new Set((shifts || []).filter(Boolean))];
  return unique.sort((a, b) => sortShifts({ type: a }, { type: b }));
}

function patternBuildDay(shifts) {
  return { shifts: patternNormalizeShiftTypes(shifts) };
}

function patternGetEffectiveDays() {
  const days = patternDays.map(day => patternBuildDay(day.shifts));
  if (patternCurrentDay.length) days.push(patternBuildDay(patternCurrentDay));
  return days.filter(day => day.shifts.length > 0);
}

function patternCurrentDayHasShift(shiftType) {
  return patternCurrentDay.includes(shiftType);
}

function patternValidateShiftAddition(shiftType) {
  if (patternCurrentDayHasShift(shiftType)) return 'Ese turno ya está en el día actual';

  const currentHasExclusive = patternCurrentDay.some(type => type === 'L' || type === 'V');
  const nextIsExclusive = shiftType === 'L' || shiftType === 'V';

  if (currentHasExclusive) return 'L y V deben ir solos en su día';
  if (nextIsExclusive && patternCurrentDay.length) return 'No podés mezclar L o V con otros turnos';

  return '';
}

function patternAdd(shiftType) {
  const validationError = patternValidateShiftAddition(shiftType);
  if (validationError) {
    toast(validationError);
    return;
  }
  patternCurrentDay = patternNormalizeShiftTypes([...patternCurrentDay, shiftType]);
  patternRenderSeq();
}

function patternCloseCurrentDay() {
  if (!patternCurrentDay.length) {
    toast('El día actual no tiene turnos');
    return;
  }
  patternDays.push(patternBuildDay(patternCurrentDay));
  patternCurrentDay = [];
  patternRenderSeq();
}

function patternRemoveLast() {
  if (!patternCurrentDay.length) return;
  patternCurrentDay = patternCurrentDay.slice(0, -1);
  patternRenderSeq();
}

function patternRemoveLastDay() {
  if (!patternDays.length) return;
  patternDays.pop();
  patternRenderSeq();
}

function patternClear() {
  patternDays = [];
  patternCurrentDay = [];
  patternRenderSeq();
}

function patternRenderDayGroup(day, index, options = {}) {
  const shifts = patternNormalizeShiftTypes(day?.shifts);
  const classes = ['pattern-day'];
  if (options.current) classes.push('pattern-day-current');
  if (!shifts.length) classes.push('pattern-day-empty');
  const title = options.current ? 'Día actual' : `Día ${index + 1}`;
  return `
    <div class="${classes.join(' ')}">
      <span class="pattern-day-header">${escapeHtml(title)}</span>
      <div class="pattern-day-shifts">${shifts.map(item => `<span class="seq-item shift-${item}">${escapeHtml(item)}</span>`).join('')}</div>
    </div>
  `;
}

function patternRenderSeq() {
  const sequenceEl = document.getElementById('pattern-sequence');
  const closedDaysMarkup = patternDays.map((day, index) => patternRenderDayGroup(day, index)).join('');
  const currentDayMarkup = patternRenderDayGroup({ shifts: patternCurrentDay }, patternDays.length, { current: true });
  sequenceEl.innerHTML = `${closedDaysMarkup}${currentDayMarkup}`;
  patternSyncDateRange();
}

function patternIsVacationOnly() {
  const days = patternGetEffectiveDays();
  return days.length > 0 && days.every(day => day.shifts.every(item => item === 'V'));
}

function patternDefaultEndDate(startDate) {
  if (!startDate) return '';
  if (patternIsVacationOnly()) return addDays(startDate, Math.max(patternGetEffectiveDays().length - 1, 0));
  const [year, month, day] = startDate.split('-').map(Number);
  return isoDate(new Date(year + 1, month - 1, day));
}

function patternSyncDateRange() {
  const startInput = document.getElementById('pattern-start');
  const endInput = document.getElementById('pattern-end');
  if (!startInput || !endInput || !startInput.value) return;
  endInput.value = patternDefaultEndDate(startInput.value);
}

function patternHandleStartDateChange() {
  patternSyncDateRange();
}

function patternModeChange() {
  const mode = document.querySelector('input[name="pattern-mode"]:checked').value;
  document.getElementById('pattern-until-wrap').classList.toggle('hidden', mode !== 'until');
  document.getElementById('pattern-month-wrap').classList.toggle('hidden', mode !== 'month');
}

async function patternApply() {
  const ownerCal = typeof getOwnerCalendar === 'function' ? getOwnerCalendar() : currentCal;
  if (!ownerCal || ownerCal.readonly) { toast('No podés editar Mi calendario ahora mismo'); return; }
  const days = patternGetEffectiveDays();
  if (!days.length) { toast('Añadí al menos un día válido al patrón'); return; }

  const mode = document.querySelector('input[name="pattern-mode"]:checked').value;
  let startDate = '';
  let endDate = '';

  if (mode === 'until') {
    startDate = document.getElementById('pattern-start').value;
    endDate = document.getElementById('pattern-end').value;
    if (!startDate || !endDate) { toast('Elegí inicio y fin'); return; }
  } else {
    const month = document.getElementById('pattern-month').value;
    if (!month) { toast('Elegí un mes'); return; }
    const startInput = document.getElementById('pattern-start').value;
    const [year, monthNumber] = month.split('-').map(Number);
    startDate = startInput && startInput.startsWith(month) ? startInput : `${month}-01`;
    endDate = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  }

  await googleCalendarCreatePattern(days, startDate, endDate);
  renderPatternsList();
  patternClear();
  document.getElementById('pattern-start').value = '';
  document.getElementById('pattern-end').value = '';
  document.getElementById('pattern-month').value = '';
  toast('Patrón aplicado ✓');
}

function renderPatternsList() {
  const el = document.getElementById('patterns-list');
  const title = document.getElementById('patterns-saved-title');
  const ownerCal = typeof getOwnerCalendar === 'function' ? getOwnerCalendar() : currentCal;
  const patterns = (ownerCal && ownerCal.patterns) || [];
  if (!patterns.length) {
    el.innerHTML = '';
    title.classList.add('hidden');
    return;
  }
  title.classList.remove('hidden');
  el.innerHTML = patterns.map(pattern => `
    <div class="pattern-item">
      <div>
        <div class="seq">${(pattern.days || []).map((day, index) => patternRenderDayGroup(day, index)).join('')}</div>
        <small>${escapeHtml(pattern.startDate || '')} → ${escapeHtml(pattern.endDate || '∞')}</small>
      </div>
      ${ownerCal?.readonly ? '' : `<button class="btn btn-sm btn-danger" onclick="patternDelete('${pattern.patternId}')">✕</button>`}
    </div>
  `).join('');
}

async function patternDelete(patternId) {
  const ownerCal = typeof getOwnerCalendar === 'function' ? getOwnerCalendar() : currentCal;
  if (!ownerCal || ownerCal.readonly) return;
  if (!confirm('¿Eliminar este patrón repetitivo?')) return;
  await googleCalendarDeletePattern(patternId);
  renderPatternsList();
  toast('Patrón eliminado');
}
