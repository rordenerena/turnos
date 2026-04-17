/* events.js — Modal + event CRUD */

function modalOpen(ds) {
  selectedDate = ds;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-date').textContent = formatDateLabel(ds);
  const ro = currentCal && currentCal.readonly;
  document.getElementById('modal-shift-buttons').classList.toggle('hidden', ro);
  document.getElementById('modal-add-event').classList.toggle('hidden', ro);
  modalRenderShift();
  modalRenderEvents();
}

function modalClose(e) {
  if (e && e.target && e.target.id !== 'modal-overlay') return;
  document.getElementById('modal-overlay').classList.add('hidden');
  selectedDate = null;
}

function modalRenderShift() {
  const effective = computeEffectiveShifts();
  const current = effective[selectedDate] || null;
  document.querySelectorAll('#modal-shift-buttons .btn').forEach(b => {
    const m = b.getAttribute('onclick')?.match(/'(\w)'/);
    b.style.outline = (m && m[1] === current) ? '3px solid var(--text)' : 'none';
  });
}

function modalRenderEvents() {
  const list = document.getElementById('modal-events-list');
  const evts = (currentCal && currentCal.events && currentCal.events[selectedDate]) || [];
  const ro = currentCal && currentCal.readonly;
  if (!evts.length) { list.innerHTML = '<p class="hint">Sin eventos.</p>'; return; }
  list.innerHTML = evts.map((ev, i) => `
    <div class="event-item">
      <span>${ev.text}</span>
      ${ro ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteEvent(${i})">✕</button>`}
    </div>
  `).join('');
}

function addEvent() {
  if (!currentCal || currentCal.readonly) return;
  const input = document.getElementById('event-text');
  const text = input.value.trim();
  if (!text) return;
  if (!currentCal.events) currentCal.events = {};
  if (!currentCal.events[selectedDate]) currentCal.events[selectedDate] = [];
  currentCal.events[selectedDate].push({ text });
  input.value = '';
  storeSave(currentCal);
  modalRenderEvents();
  calRender();
}

function deleteEvent(idx) {
  if (!currentCal || currentCal.readonly) return;
  currentCal.events[selectedDate].splice(idx, 1);
  if (!currentCal.events[selectedDate].length) delete currentCal.events[selectedDate];
  storeSave(currentCal);
  modalRenderEvents();
  calRender();
}

function formatDateLabel(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const date = new Date(y, m - 1, d);
  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}
