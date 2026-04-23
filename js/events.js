/* events.js — modal y CRUD sobre Google Calendar */

let modalDayDraft = null;
const MODAL_SHIFT_NOTE_MAX_LENGTH = 120;

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

function modalBuildShiftNotesIndex(...groups) {
  const notesByType = {};
  groups.flat().forEach(item => {
    if (!item?.type) return;
    notesByType[item.type] = item.note || '';
  });
  return notesByType;
}

function modalRememberShiftNotes(items) {
  if (!modalDayDraft) return;
  modalDayDraft.shiftNotesByType = {
    ...(modalDayDraft.shiftNotesByType || {}),
    ...modalBuildShiftNotesIndex(items || []),
  };
}

function modalGetRememberedShiftNote(type) {
  if (!modalDayDraft || !type) return '';
  return modalDayDraft.shiftNotesByType?.[type] || '';
}

function modalSetDraftShifts(nextShifts) {
  if (!modalDayDraft) return;
  const cloned = cloneDayShifts(nextShifts).sort(sortShifts);
  modalRememberShiftNotes(cloned);
  modalDayDraft.current.shifts = cloned;
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
  const readonly = !!(currentCal && currentCal.readonly);
  saveButton.disabled = saving;
  cancelButton.disabled = saving;
  saveButton.classList.toggle('hidden', readonly);
  cancelButton.setAttribute('aria-label', readonly ? 'Cerrar' : 'Cancelar edición');
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
    shiftNotesByType: modalBuildShiftNotesIndex(
      (currentCal && currentCal.rawShifts && currentCal.rawShifts[ds]) || [],
      (currentCal && currentCal.shifts && currentCal.shifts[ds]) || []
    ),
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
      <input type="text" value="${escapeHtml(item.note || '')}" placeholder="Nota..." maxlength="${MODAL_SHIFT_NOTE_MAX_LENGTH}" ${readonly ? 'disabled' : ''} onchange="setShiftNote('${item.type}', this.value)">
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
