/* share.js — Compress calendar data, generate QR, import from URL hash */

function shareCompress(cal) {
  // Only share the essential data (not readonly flag, not createdAt)
  const payload = {
    id: cal.id,
    name: cal.name,
    shifts: cal.shifts,
    events: cal.events,
    patterns: cal.patterns,
    updatedAt: cal.updatedAt,
  };
  const json = JSON.stringify(payload);
  const compressed = pako.deflate(new TextEncoder().encode(json));
  return btoa(String.fromCharCode(...compressed));
}

function shareDecompress(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const decompressed = pako.inflate(bytes);
  const json = new TextDecoder().decode(decompressed);
  return JSON.parse(json);
}

async function shareGenerate() {
  if (!currentCal || currentCal.readonly) { toast('Seleccioná tu propio calendario'); return; }
  try {
    const compressed = shareCompress(currentCal);
    const longUrl = `${location.origin}${location.pathname}#cal=${compressed}`;

    // Try to shorten the URL
    let url = longUrl;
    try {
      const resp = await fetch('https://zip1.io/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: longUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        url = data.short_url.replace('http://', 'https://');
      }
    } catch {}

    QRCode.toCanvas(document.getElementById('qr-canvas'), url, { width: 250, margin: 2, errorCorrectionLevel: 'L' });
    document.getElementById('share-url').textContent = url;
    document.getElementById('qr-container').classList.remove('hidden');
    toast('QR generado ✓');
  } catch (e) {
    toast('Error al generar: ' + e.message);
  }
}

function shareCopyLink() {
  const url = document.getElementById('share-url').textContent;
  navigator.clipboard.writeText(url).then(() => toast('Link copiado ✓')).catch(() => toast('No se pudo copiar'));
}

async function shareNative() {
  const url = document.getElementById('share-url').textContent;
  if (!url) { toast('Generá el link primero'); return; }
  if (!navigator.share) {
    toast('Compartir no disponible en este dispositivo');
    return;
  }
  try {
    await navigator.share({
      title: 'Calendario de Turnos',
      text: 'Te comparto mi calendario de turnos',
      url: url,
    });
  } catch (e) {
    if (e.name !== 'AbortError') toast('Error al compartir');
  }
}

function shareCheckUrl() {
  const hash = location.hash;
  if (!hash.startsWith('#cal=')) return false;
  try {
    const b64 = hash.substring(5);
    const data = shareDecompress(b64);
    if (!data.id || !data.name) { toast('Datos inválidos'); return false; }
    const result = storeImportCalendar(data);
    storeSetActive(result.cal.id);
    currentCal = result.cal;
    // Clean URL hash without reloading
    history.replaceState(null, '', location.pathname + location.search);
    toast(result.isNew ? `Calendario "${data.name}" importado ✓` : `Calendario "${data.name}" actualizado ✓`);
    return true;
  } catch (e) {
    toast('Error al importar: ' + e.message);
    return false;
  }
}

function renderImportedList() {
  const el = document.getElementById('imported-list');
  const imported = storeGetImported();
  if (!imported.length) { el.innerHTML = '<p class="hint">No tenés calendarios importados.</p>'; return; }
  el.innerHTML = imported.map(c => `
    <div class="imported-item">
      <div>
        <div class="imp-name">📅 ${c.name}</div>
        <div class="imp-date">Actualizado: ${new Date(c.updatedAt).toLocaleString('es')}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm btn-primary" onclick="selectCalendar('${c.id}');switchTab('calendar')">Ver</button>
        <button class="btn btn-sm btn-danger" onclick="removeImported('${c.id}')">✕</button>
      </div>
    </div>
  `).join('');
}

function removeImported(id) {
  storeDelete(id);
  // If we were viewing this one, switch to own calendar
  if (currentCal && currentCal.id === id) {
    const mine = storeGetMine();
    currentCal = mine[0] || storeEnsureOwn();
    storeSetActive(currentCal.id);
  }
  renderImportedList();
  renderCalSelector();
  toast('Calendario eliminado');
}

/* Export / Import JSON file */
function exportJSON() {
  if (!currentCal) return;
  const blob = new Blob([JSON.stringify(currentCal, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `turnos-${currentCal.name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.id) data.id = uuid();
      const result = storeImportCalendar(data);
      storeSetActive(result.cal.id);
      currentCal = result.cal;
      renderCalSelector();
      calRender();
      toast(`Importado "${data.name}" ✓`);
    } catch { toast('Archivo JSON inválido'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}
