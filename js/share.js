/* share.js — Compress calendar data, generate QR, import from URL hash */

function shareCompress(cal) {
  const payload = {
    id: cal.id,
    name: cal.name,
    shifts: cal.shifts,
    events: cal.events,
    patterns: cal.patterns,
    updatedAt: cal.updatedAt,
  };
  if (cal.driveFileId) payload.driveFileId = cal.driveFileId;
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
    // Upload to Drive if connected
    if (gdriveToken) {
      toast('Subiendo a Drive...');
      await gdriveUploadAndShare(currentCal);
    }

    const compressed = shareCompress(currentCal);
    const url = `${location.origin}${location.pathname}#cal=${compressed}`;

    QRCode.toCanvas(document.getElementById('qr-canvas'), url, { width: 250, margin: 2, errorCorrectionLevel: 'L' });
    document.getElementById('share-url').textContent = url;
    document.getElementById('qr-container').classList.remove('hidden');
    toast(gdriveToken ? 'QR generado con sync ✓' : 'QR generado ✓');
    document.getElementById('share-sync-hint').textContent = currentCal.driveFileId
      ? '🟢 Este QR incluye sync con Google Drive'
      : '⚪ Sin sync — conectá Google Drive en ⚙️ para activarlo';
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
      text: `Te comparto mi calendario de turnos  "${currentCal.name}":`,
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
    const syncInfo = data.driveFileId ? ' (con sync 🔄)' : ' (sin sync)';
    toast((result.isNew ? `Importado "${data.name}"` : `Actualizado "${data.name}"`) + syncInfo);
    renderCalSelector();
    calRender();
    switchTab('calendar');
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
        ${c.driveFileId ? `<button class="btn btn-sm btn-accent" onclick="refreshFromDrive('${c.id}')">🔄</button>` : ''}
        <button class="btn btn-sm btn-primary" onclick="selectCalendar('${c.id}');switchTab('calendar')">Ver</button>
        <button class="btn btn-sm btn-danger" onclick="removeImported('${c.id}')">✕</button>
      </div>
    </div>
  `).join('');
}

async function refreshFromDrive(calId) {
  const cal = storeGet(calId);
  if (!cal || !cal.driveFileId) { toast('Sin enlace de Drive'); return; }
  if (!gdriveToken) { toast('Conectá Google Drive en ⚙️ primero'); return; }
  try {
    toast('Actualizando...');
    const data = await gdriveReadPublic(cal.driveFileId);
    if (data) {
      data.driveFileId = cal.driveFileId;
      const result = storeImportCalendar(data);
      if (currentCal && currentCal.id === calId) { currentCal = result.cal; calRender(); }
      renderCalSelector();
      renderImportedList();
      toast(`${cal.name} actualizado ✓`);
    }
  } catch (e) {
    toast('Error al actualizar: ' + e.message);
  }
}

function removeImported(id) {
  const cal = storeGet(id);
  // Delete from Drive if connected and has driveFileId
  if (gdriveToken && cal && cal.driveFileId) {
    gapi.client.drive.files.update({ fileId: cal.driveFileId, resource: { trashed: true } }).catch(() => {});
  }
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
