/* events.js — modal y CRUD sobre Google Calendar */

let modalDayDraft = null;

function cloneDayShifts(items) {
  return (items || []).map(item => ({
    type: item.type,
    note: item.note || '',
    source: item.source ? { ...item.source } : null,
  }));
}

function cloneDayEvents(items) {
  return (items || []).map(item => ({
    text: item.text || '',
    source: item.source ? { ...item.source } : null,
  }));
}

function normalizeDayDraftValue(day) {
  return {
    shifts: cloneDayShifts(day?.shifts).sort(sortShifts).map(item => ({ type: item.type, note: item.note || '' })),
    events: cloneDayEvents(day?.events).map(item => ({ text: item.text || '' })),
  };
}

function modalDraftIsDirty() {
  if (!modalDayDraft) return false;
  return JSON.stringify(normalizeDayDraftValue(modalDayDraft.original)) !== JSON.stringify(normalizeDayDraftValue(modalDayDraft.current));
}

function modalGetDraft(ds) {
  if (!modalDayDraft || modalDayDraft.ds !== ds) return null;
  return modalDayDraft.current;
}

function modalSetDraftShifts(nextShifts) {
  if (!modalDayDraft) return;
  modalDayDraft.current.shifts = cloneDayShifts(nextShifts).sort(sortShifts);
}

function modalSetDraftEvents(nextEvents) {
  if (!modalDayDraft) return;
  modalDayDraft.current.events = cloneDayEvents(nextEvents);
}

function modalResetDraft() {
  modalDayDraft = null;
  const input = document.getElementById('event-text');
  if (input) input.value = '';
  modalRenderActionButtons();
}

function modalRenderActionButtons() {
  const saveButton = document.getElementById('modal-save-btn');
  const cancelButton = document.getElementById('modal-cancel-btn');
  const icon = document.getElementById('modal-save-icon');
  const spinner = document.getElementById('modal-save-spinner');
  if (!saveButton || !cancelButton || !icon || !spinner) return;
  const saving = !!modalDayDraft?.saving;
  saveButton.disabled = saving;
  cancelButton.disabled = saving;
  icon.classList.toggle('hidden', saving);
  spinner.classList.toggle('hidden', !saving);
}

function modalFinalizeClose() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalResetDraft();
  calRender();
  selectedDate = null;
}

function modalOpen(ds) {
  selectedDate = ds;
  const readonly = !!(currentCal && currentCal.readonly);
  modalDayDraft = readonly ? null : {
    ds,
    original: {
      shifts: cloneDayShifts((currentCal && currentCal.shifts && currentCal.shifts[ds]) || []),
      events: cloneDayEvents((currentCal && currentCal.events && currentCal.events[ds]) || []),
    },
    current: {
      shifts: cloneDayShifts((currentCal && currentCal.shifts && currentCal.shifts[ds]) || []),
      events: cloneDayEvents((currentCal && currentCal.events && currentCal.events[ds]) || []),
    },
    saving: false,
  };
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-date').textContent = formatDateLabel(ds);
  document.getElementById('modal-shift-buttons').classList.toggle('hidden', readonly);
  document.getElementById('modal-add-event').classList.toggle('hidden', readonly);
  modalRenderActionButtons();
  modalRenderShift();
  modalRenderEvents();
}

async function modalClose(e) {
  if (modalDayDraft?.saving) return;
  if (currentCal && !currentCal.readonly && modalDraftIsDirty()) {
    modalDayDraft.saving = true;
    modalRenderActionButtons();
    try {
      await googleCalendarReplaceDayContent(selectedDate, modalDayDraft.current.shifts, modalDayDraft.current.events);
    } catch (error) {
      modalDayDraft.saving = false;
      modalRenderActionButtons();
      toast(`No se pudo guardar el día: ${error.message}`);
      return;
    }
  }
  modalFinalizeClose();
}

function modalCancel(e) {
  if (e && e.target && e.target.id !== 'modal-overlay') return;
  if (modalDayDraft?.saving) return;
  modalFinalizeClose();
}

function modalRenderShift() {
  const current = getDayShifts(selectedDate);
  const types = current.map(item => item.type);
  document.querySelectorAll('#modal-shift-buttons .btn').forEach(button => {
    const match = button.getAttribute('onclick')?.match(/'([^']+)'/);
    button.style.outline = match && types.includes(match[1]) ? '3px solid var(--text)' : 'none';
  });

  const notesEl = document.getElementById('modal-shift-notes');
  const readonly = !!(currentCal && currentCal.readonly);
  if (!current.length) {
    notesEl.innerHTML = '<div class="shift-note-row" style="visibility:hidden"><span class="seq-item">X</span><input type="text" disabled></div>';
    return;
  }
  notesEl.innerHTML = current.map(item => `
    <div class="shift-note-row">
      <span class="seq-item shift-${item.type}">${escapeHtml(item.type)}</span>
      <input type="text" value="${escapeHtml(item.note || '')}" placeholder="Nota..." maxlength="20" ${readonly ? 'disabled' : ''} onchange="setShiftNote('${item.type}', this.value)">
    </div>
  `).join('');
}

function modalRenderEvents() {
  const list = document.getElementById('modal-events-list');
  const events = getDayEvents(selectedDate);
  const readonly = !!(currentCal && currentCal.readonly);
  if (!events.length) {
    list.innerHTML = '<p class="hint">Sin eventos.</p>';
    return;
  }
  list.innerHTML = events.map((event, index) => `
    <div class="event-item">
      <span>${escapeHtml(event.text)}</span>
      ${readonly ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteEvent(${index})">✕</button>`}
    </div>
  `).join('');
}

function addEvent() {
  if (!currentCal || currentCal.readonly) return;
  const input = document.getElementById('event-text');
  const text = input.value.trim();
  if (!text) return;
  modalSetDraftEvents([...getDayEvents(selectedDate), { text }]);
  input.value = '';
  modalRenderEvents();
  calRender();
}

function deleteEvent(index) {
  if (!currentCal || currentCal.readonly) return;
  const events = getDayEvents(selectedDate);
  if (!events[index]) return;
  modalSetDraftEvents(events.filter((_, eventIndex) => eventIndex !== index));
  modalRenderEvents();
  calRender();
}

function formatDateLabel(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const date = new Date(y, m - 1, d);
  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}
