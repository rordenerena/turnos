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
    const shifts = effective[ds] || [];
    const evts = (currentCal && currentCal.events && currentCal.events[ds]) || [];
    html += `<div class="cal-day${ds === todayStr ? ' today' : ''}" onclick="dayClick('${ds}')">`;
    html += `<div class="day-num">${d}</div>`;
    if (shifts.length) {
      shifts.forEach(s => {
        const t = s.type || s;
        const n = s.note ? ` <small>${s.note}</small>` : '';
        html += `<div class="day-shift s-${t}">${t}${n}</div>`;
      });
    }
    if (evts.length) html += `<div class="day-events"><span class="event-dot"></span>${evts.length > 1 ? evts.length : evts[0].text.substring(0, 10)}</div>`;
    html += '</div>';
  }
  grid.innerHTML = html;
  const totalCells = startDay + daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  // Readonly banner + hide tabs
  const banner = document.getElementById('readonly-banner');
  const ro = currentCal && currentCal.readonly;
  if (ro) {
    const syncBtn = currentCal.driveFileId ? ` <button class="btn btn-sm btn-accent" onclick="refreshFromDrive('${currentCal.id}')" style="margin-left:8px">🔄</button>` : '';
    banner.innerHTML = `👁 ${currentCal.name} (solo lectura)${syncBtn}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  document.querySelectorAll('.tab[data-tab="patterns"],.tab[data-tab="shared"],.tab[data-tab="settings"]').forEach(t => t.classList.toggle('hidden', ro));
}

/* Normalize: "M" → {type:"M",note:""}, {type:"M",note:"x"} stays */
function normShift(s) { return typeof s === 'string' ? { type: s, note: '' } : s; }

function computeEffectiveShifts() {
  if (!currentCal) return {};
  const result = {};
  const all = currentCal.shifts || {};

  for (const ds in all) {
    result[ds] = (all[ds] || []).map(normShift);
  }

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
      if (!(ds in all)) { // only if no manual shift
        const daysSince = Math.floor((cur - start) / 86400000);
        const idx = ((daysSince % p.sequence.length) + p.sequence.length) % p.sequence.length;
        if (!result[ds]) result[ds] = [];
        result[ds].push({ type: p.sequence[idx], note: '' });
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

/* Swipe navigation */
let _touchStartX = 0;
let _touchStartY = 0;
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('cal-grid');
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
});

function setShift(shift) {
  if (!currentCal || currentCal.readonly) return;
  if (!currentCal.shifts) currentCal.shifts = {};
  if (!currentCal.shifts[selectedDate]) currentCal.shifts[selectedDate] = [];

  const shifts = currentCal.shifts[selectedDate].map(normShift);

  if (shift === null) {
    currentCal.shifts[selectedDate] = [];
  } else {
    const idx = shifts.findIndex(s => s.type === shift);
    if (idx >= 0) shifts.splice(idx, 1);
    else shifts.push({ type: shift, note: '' });
    currentCal.shifts[selectedDate] = shifts;
  }

  storeSave(currentCal);
    scheduleDriveSync();
  calRender();
  modalRenderShift();
}

function setShiftNote(type, note) {
  if (!currentCal || currentCal.readonly) return;
  const shifts = (currentCal.shifts[selectedDate] || []).map(normShift);
  const s = shifts.find(s => s.type === type);
  if (s) s.note = note.trim();
  currentCal.shifts[selectedDate] = shifts;
  storeSave(currentCal);
    scheduleDriveSync();
  calRender();
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
    scheduleDriveSync();
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
    scheduleDriveSync();
  calRender();
  renderPatternsList();
  toast('Patrón eliminado');
}
