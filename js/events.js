/* events.js — modal y CRUD sobre Google Calendar */

function modalOpen(ds) {
  selectedDate = ds;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-date').textContent = formatDateLabel(ds);
  const readonly = !!(currentCal && currentCal.readonly);
  document.getElementById('modal-shift-buttons').classList.toggle('hidden', readonly);
  document.getElementById('modal-add-event').classList.toggle('hidden', readonly);
  modalRenderShift();
  modalRenderEvents();
}

function modalClose(e) {
  if (e && e.target && e.target.id !== 'modal-overlay') return;
  document.getElementById('modal-overlay').classList.add('hidden');
  selectedDate = null;
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
  const events = (currentCal && currentCal.events && currentCal.events[selectedDate]) || [];
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

async function addEvent() {
  if (!currentCal || currentCal.readonly) return;
  const input = document.getElementById('event-text');
  const text = input.value.trim();
  if (!text) return;
  await googleCalendarCreateEvent(googleCalendarEventPayload(selectedDate, text));
  input.value = '';
  await googleCalendarRefreshOwner({ silent: true });
  modalRenderEvents();
  calRender();
}

async function deleteEvent(index) {
  if (!currentCal || currentCal.readonly) return;
  const events = (currentCal.events && currentCal.events[selectedDate]) || [];
  const event = events[index];
  if (!event?.source?.eventId) return;
  await googleCalendarDeleteEvent(event.source.eventId);
  await googleCalendarRefreshOwner({ silent: true });
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
