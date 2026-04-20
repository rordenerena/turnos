/* calendar.js — render mensual, turnos y patrones remotos */

let currentCal = null;
let calYear, calMonth;
let selectedDate = null;
let patternSeq = [];
let readonlyBannerRefreshState = { calendarId: null, status: 'idle', resetTimer: null };
const readonlyBannerHiddenByCalendar = new Set();

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
  readonlyBannerHiddenByCalendar.add(currentCal.id);
  calRender();
}

async function toggleReadonlyBannerForCalendar(calendarId, event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!calendarId) return;

  if (!currentCal || currentCal.id !== calendarId) {
    readonlyBannerHiddenByCalendar.delete(calendarId);
    await selectCalendar(calendarId);
    return;
  }

  if (!currentCal.readonly) return;

  if (isReadonlyBannerVisible(calendarId)) readonlyBannerHiddenByCalendar.add(calendarId);
  else readonlyBannerHiddenByCalendar.delete(calendarId);

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
  const todayStr = isoDate(new Date());

  let html = '';
  for (let i = 0; i < startDay; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(calYear, calMonth, d);
    const shifts = getDayShifts(ds);
    const evts = getDayEvents(ds);
    html += `<div class="cal-day${ds === todayStr ? ' today' : ''}" onclick="dayClick('${ds}')">`;
    html += `<div class="day-num">${d}</div>`;
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
  }
  grid.innerHTML = html;
  grid.style.gridTemplateRows = `repeat(${Math.ceil((startDay + daysInMonth) / 7)}, 1fr)`;

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

function sortShifts(a, b) {
  const order = { M: 0, T: 1, N: 2, R: 3, L: 4 };
  return (order[a.type] ?? 10) - (order[b.type] ?? 10);
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

function patternAdd(shiftType) {
  patternSeq.push(shiftType);
  patternRenderSeq();
}

function patternRemoveLast() {
  patternSeq.pop();
  patternRenderSeq();
}

function patternClear() {
  patternSeq = [];
  patternRenderSeq();
}

function patternRenderSeq() {
  document.getElementById('pattern-sequence').innerHTML = patternSeq.map(item => `<span class="seq-item shift-${item}">${item}</span>`).join('');
}

function patternModeChange() {
  const mode = document.querySelector('input[name="pattern-mode"]:checked').value;
  document.getElementById('pattern-until-wrap').classList.toggle('hidden', mode !== 'until');
  document.getElementById('pattern-month-wrap').classList.toggle('hidden', mode !== 'month');
}

async function patternApply() {
  const ownerCal = typeof getOwnerCalendar === 'function' ? getOwnerCalendar() : currentCal;
  if (!ownerCal || ownerCal.readonly) { toast('No podés editar Mi calendario ahora mismo'); return; }
  if (!patternSeq.length) { toast('Añadí turnos a la secuencia'); return; }

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

  await googleCalendarCreatePattern(patternSeq, startDate, endDate);
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
        <div class="seq">${pattern.sequence.map(item => `<span class="seq-item shift-${item}">${escapeHtml(item)}</span>`).join('')}</div>
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
