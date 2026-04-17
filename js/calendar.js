/* calendar.js — Calendar rendering, navigation, shifts & patterns */

let currentCal = null;
let calYear, calMonth;
let selectedDate = null;

function calInit() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calRender(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calRender(); }
function calToday() { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); calRender(); }

function calRender() {
  const label = document.getElementById('cal-month-label');
  const grid = document.getElementById('cal-grid');
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  label.textContent = `${months[calMonth]} ${calYear}`;

  const first = new Date(calYear, calMonth, 1);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = dateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const effective = computeEffectiveShifts();

  let html = '';
  for (let i = 0; i < startDay; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(calYear, calMonth, d);
    const shift = effective[ds] || null;
    const evts = (currentCal && currentCal.events && currentCal.events[ds]) || [];
    html += `<div class="cal-day${ds === todayStr ? ' today' : ''}" onclick="dayClick('${ds}')">`;
    html += `<div class="day-num">${d}</div>`;
    if (shift) html += `<div class="day-shift s-${shift}">${shift}</div>`;
    if (evts.length) html += `<div class="day-events"><span class="event-dot"></span>${evts.length > 1 ? evts.length : evts[0].text.substring(0, 10)}</div>`;
    html += '</div>';
  }
  grid.innerHTML = html;

  // Readonly banner
  const banner = document.getElementById('readonly-banner');
  if (currentCal && currentCal.readonly) {
    banner.textContent = `👁 ${currentCal.name} (solo lectura)`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function computeEffectiveShifts() {
  if (!currentCal) return {};
  const result = { ...currentCal.shifts };
  if (!currentCal.patterns) return result;
  currentCal.patterns.forEach(p => {
    if (!p.sequence || !p.sequence.length || !p.startDate) return;
    const start = new Date(p.startDate + 'T00:00:00');
    const end = p.endDate ? new Date(p.endDate + 'T23:59:59') : new Date(calYear, calMonth + 1, 0, 23, 59, 59);
    const viewStart = new Date(calYear, calMonth, 1);
    const viewEnd = new Date(calYear, calMonth + 1, 0);
    const iterStart = start > viewStart ? start : viewStart;
    const iterEnd = end < viewEnd ? end : viewEnd;
    if (iterStart > iterEnd) return;
    const cur = new Date(iterStart);
    while (cur <= iterEnd) {
      const ds = dateStr(cur.getFullYear(), cur.getMonth(), cur.getDate());
      if (!currentCal.shifts[ds]) {
        const daysSince = Math.floor((cur - start) / 86400000);
        const idx = ((daysSince % p.sequence.length) + p.sequence.length) % p.sequence.length;
        result[ds] = p.sequence[idx];
      }
      cur.setDate(cur.getDate() + 1);
    }
  });
  return result;
}

function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dayClick(ds) {
  selectedDate = ds;
  modalOpen(ds);
}

function setShift(shift) {
  if (!currentCal || currentCal.readonly) return;
  if (shift === null) delete currentCal.shifts[selectedDate];
  else currentCal.shifts[selectedDate] = shift;
  storeSave(currentCal);
  calRender();
  modalRenderShift();
}

/* Patterns */
let patternSeq = [];
function patternAdd(s) { patternSeq.push(s); patternRenderSeq(); }
function patternRemoveLast() { patternSeq.pop(); patternRenderSeq(); }
function patternClear() { patternSeq = []; patternRenderSeq(); }
function patternRenderSeq() {
  document.getElementById('pattern-sequence').innerHTML = patternSeq.map(s => `<span class="seq-item shift-${s}">${s}</span>`).join('');
}

function patternModeChange() {
  const mode = document.querySelector('input[name="pattern-mode"]:checked').value;
  document.getElementById('pattern-until-wrap').classList.toggle('hidden', mode !== 'until');
  document.getElementById('pattern-month-wrap').classList.toggle('hidden', mode !== 'month');
}

function patternApply() {
  if (!currentCal || currentCal.readonly) { toast('No podés editar este calendario'); return; }
  if (!patternSeq.length) { toast('Agregá turnos a la secuencia'); return; }
  const mode = document.querySelector('input[name="pattern-mode"]:checked').value;
  let startDate, endDate = null;

  if (mode === 'until') {
    const startInput = document.getElementById('pattern-start').value;
    if (!startInput) { toast('Seleccioná fecha de inicio'); return; }
    startDate = startInput;
    endDate = document.getElementById('pattern-end').value;
    if (!endDate) { toast('Seleccioná fecha fin'); return; }
  } else {
    // Month mode: use pattern-start if set, otherwise day 1
    const startInput = document.getElementById('pattern-start').value;
    const mv = document.getElementById('pattern-month').value;
    if (!mv) { toast('Seleccioná un mes'); return; }
    const [y, m] = mv.split('-').map(Number);
    if (startInput && startInput.startsWith(mv)) {
      startDate = startInput;
    } else {
      startDate = `${mv}-01`;
    }
    endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  }
  currentCal.patterns.push({ sequence: [...patternSeq], startDate, endDate });
  storeSave(currentCal);
  calRender();
  renderPatternsList();
  toast('Patrón aplicado ✓');

  // Clear pattern form
  patternSeq = [];
  patternRenderSeq();
  document.getElementById('pattern-start').value = '';
  document.getElementById('pattern-end').value = '';
  document.getElementById('pattern-month').value = '';
}

function renderPatternsList() {
  const el = document.getElementById('patterns-list');
  if (!currentCal || !currentCal.patterns.length) { el.innerHTML = '<p class="hint">Sin patrones.</p>'; return; }
  el.innerHTML = currentCal.patterns.map((p, i) => `
    <div class="pattern-item">
      <div>
        <div class="seq">${p.sequence.map(s => `<span class="seq-item shift-${s}">${s}</span>`).join('')}</div>
        <small>${p.startDate} → ${p.endDate || '∞'}</small>
      </div>
      ${currentCal.readonly ? '' : `<button class="btn btn-sm btn-danger" onclick="patternDelete(${i})">✕</button>`}
    </div>
  `).join('');
}

function patternDelete(idx) {
  if (!currentCal || currentCal.readonly) return;
  currentCal.patterns.splice(idx, 1);
  storeSave(currentCal);
  calRender();
  renderPatternsList();
  toast('Patrón eliminado');
}
