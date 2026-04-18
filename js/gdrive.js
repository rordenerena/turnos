/* gdrive.js — Google OAuth + Drive: upload own calendar, share publicly, read public files */

const GDRIVE_CLIENT_ID = '743453800087-molu80v03v3ms24ovp194vscc53nr6aj.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

let gdriveToken = null;
let gdriveReady = false;

/* Init Google APIs */
function gdriveInit() {
  if (typeof gapi !== 'undefined') {
    gapi.load('client', async () => {
      await gapi.client.init({ discoveryDocs: [GDRIVE_DISCOVERY] });
      gdriveReady = true;
      gdriveRestoreSession();
    });
  } else {
    setTimeout(gdriveInit, 500);
  }
}

function gdriveRestoreSession() {
  const saved = localStorage.getItem('turnos_gdrive_token');
  if (!saved) return;
  const parsed = JSON.parse(saved);
  if (parsed.expires_at > Date.now()) {
    gdriveToken = parsed.access_token;
    gapi.client.setToken({ access_token: gdriveToken });
    gdriveUpdateUI(true);
    setTimeout(() => gdriveUpdateUI(true), 500);
    setTimeout(gdriveRestoreCalendars, 3000);
  } else {
    localStorage.removeItem('turnos_gdrive_token');
  }
}

function gdriveLogin() {
  if (typeof google === 'undefined' || !google.accounts) { toast('Cargando Google, esperá unos segundos...'); return; }
  if (!gdriveReady) {
    toast('Conectando con Drive...');
    const check = setInterval(() => {
      if (gdriveReady) { clearInterval(check); gdriveLogin(); }
    }, 500);
    setTimeout(() => clearInterval(check), 10000);
    return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GDRIVE_CLIENT_ID,
    scope: GDRIVE_SCOPES,
    callback: (resp) => {
      if (resp.error) return;
      gdriveToken = resp.access_token;
      localStorage.setItem('turnos_gdrive_token', JSON.stringify({
        access_token: resp.access_token,
        expires_at: Date.now() + resp.expires_in * 1000,
      }));
      gapi.client.setToken({ access_token: gdriveToken });
      gdriveUpdateUI(true);
      toast('Drive conectado ✓');
      gdriveRestoreCalendars();
    },
  });
  client.requestAccessToken({ prompt: '' });
}

function gdriveLogout() {
  if (gdriveToken) google.accounts.oauth2.revoke(gdriveToken);
  gdriveToken = null;
  localStorage.removeItem('turnos_gdrive_token');
  gapi.client.setToken('');
  gdriveUpdateUI(false);
}

function gdriveUpdateUI(loggedIn) {
  const btn = document.getElementById('btn-gdrive');
  const actions = document.getElementById('gdrive-actions');
  if (!btn) return;
  if (loggedIn) {
    btn.textContent = '✅ Conectado a Google Drive';
    btn.disabled = true;
    btn.onclick = null;
    if (actions) actions.classList.remove('hidden');
  } else {
    btn.textContent = '🔒 Conectar Google Drive';
    btn.disabled = false;
    btn.onclick = gdriveLogin;
    if (actions) actions.classList.add('hidden');
  }
}

/* Manual sync: download from Drive then upload local changes */
async function gdriveManualSync() {
  if (!gdriveToken) { toast('Conectá Google Drive primero'); return; }
  toast('Sincronizando...');
  try {
    await gdriveRestoreCalendars();
    await gdriveFetchImported();
    if (currentCal && !currentCal.readonly) await gdriveUploadAndShare(currentCal);
    toast('Sincronización completa ✓');
  } catch (e) {
    toast('Error al sincronizar: ' + e.message);
  }
}

/* Restore own calendars from Drive (after login or reinstall) */
async function gdriveRestoreCalendars() {
  if (!gdriveToken) return;
  try {
    const resp = await gapi.client.drive.files.list({
      q: "name contains 'turnos-' and mimeType='application/json' and trashed=false",
      fields: 'files(id,name)',
      spaces: 'drive',
    });
    const files = resp.result.files || [];
    let restored = 0;
    for (const file of files) {
      try {
        const data = await gdriveReadPublic(file.id);
        if (!data || !data.id) continue;
        data.driveFileId = file.id;
        const local = storeGet(data.id);
        if (!local) {
          // New calendar from Drive — check if there's an empty local with same name to replace
          const mine = storeGetMine();
          const emptyDupe = mine.find(c => c.name === data.name && !c.driveFileId && Object.keys(c.shifts || {}).length === 0 && (c.patterns || []).length === 0);
          if (emptyDupe) {
            storeDelete(emptyDupe.id);
          }
          data.readonly = false;
          storeSave(data);
          restored++;
        } else if (data.updatedAt && data.updatedAt > (local.updatedAt || '')) {
          storeSave({ ...local, ...data, readonly: local.readonly });
          restored++;
        }
      } catch {}
    }
    if (restored) {
      // If there are still duplicates with same name, rename the one without driveFileId
      const mine = storeGetMine();
      const names = {};
      for (const c of mine) {
        if (names[c.name]) {
          const toRename = c.driveFileId ? names[c.name] : c;
          toRename.name = toRename.name + ' (local)';
          storeSave(toRename);
        }
        names[c.name] = c;
      }
      currentCal = storeGet(storeGetActive()) || mine[0];
      if (currentCal) storeSetActive(currentCal.id);
      renderCalSelector();
      calRender();
      toast(`${restored} calendario(s) restaurado(s) desde Drive ✓`);
    }
  } catch (e) {
    console.warn('Drive restore failed:', e);
  }
}

/* Upload calendar to Drive and make it public. Returns fileId. */
/* Get or create "Turnos" folder in Drive */
let _driveFolderId = null;
async function gdriveGetFolder() {
  if (_driveFolderId) return _driveFolderId;
  const resp = await gapi.client.drive.files.list({
    q: "name='Turnos' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
    spaces: 'drive',
  });
  if (resp.result.files && resp.result.files.length) {
    _driveFolderId = resp.result.files[0].id;
    return _driveFolderId;
  }
  // Create folder
  const create = await gapi.client.drive.files.create({
    resource: { name: 'Turnos', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  _driveFolderId = create.result.id;
  return _driveFolderId;
}

async function gdriveUploadAndShare(cal) {
  if (!gdriveToken) throw new Error('No conectado a Drive');
  const folderId = await gdriveGetFolder();
  const payload = { id: cal.id, name: cal.name, shifts: cal.shifts, events: cal.events, patterns: cal.patterns, updatedAt: cal.updatedAt };
  const fileName = `turnos-${cal.id}.json`;
  let fileId = cal.driveFileId || null;

  // Verify saved fileId still exists
  if (fileId) {
    try {
      await gapi.client.drive.files.get({ fileId, fields: 'id' });
    } catch { fileId = null; }
  }

  // Find existing file (get most recent if duplicates)
  if (!fileId) {
    const resp = await gapi.client.drive.files.list({
      q: `name='${fileName}' and trashed=false`,
      fields: 'files(id,modifiedTime)',
      orderBy: 'modifiedTime desc',
      spaces: 'drive',
    });
    if (resp.result.files && resp.result.files.length) {
      fileId = resp.result.files[0].id;
      for (let i = 1; i < resp.result.files.length; i++) {
        fetch(`https://www.googleapis.com/drive/v3/files/${resp.result.files[i].id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${gdriveToken}` },
        }).catch(() => {});
      }
    }
  }

  if (fileId) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${gdriveToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    const metadata = { name: fileName, mimeType: 'application/json', parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${gdriveToken}` },
      body: form,
    });
    fileId = (await resp.json()).id;

    await gapi.client.drive.permissions.create({
      fileId: fileId,
      resource: { role: 'reader', type: 'anyone' },
    });
  }

  // Save fileId on the calendar
  cal.driveFileId = fileId;
  storeSave(cal);
  return fileId;
}

/* Read a public Drive file — use OAuth token if logged in, API key otherwise */
async function gdriveReadPublic(fileId) {
  const headers = {};
  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  if (gdriveToken) {
    headers['Authorization'] = `Bearer ${gdriveToken}`;
  } else {
    url += '&key=AIzaSyDQ0i7vJNDF9YxF01Xv7xqmmaJReFwvocY';
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Drive ${resp.status}: ${err.substring(0, 100)}`);
  }
  return resp.json();
}

/* Debounced Drive upload with visual countdown */
let _driveTimer = null;
let _countdownInterval = null;
const SYNC_DELAY = 5000;

function scheduleDriveSync() {
  if (!gdriveToken || !currentCal || currentCal.readonly) return;
  clearTimeout(_driveTimer);
  clearInterval(_countdownInterval);

  const indicator = document.getElementById('sync-indicator');
  const ring = document.getElementById('sync-ring-fg');
  const icon = document.getElementById('sync-icon');
  indicator.classList.remove('hidden');
  icon.textContent = '⏳';
  ring.style.stroke = '#a5d6a7';

  const start = Date.now();
  _countdownInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / SYNC_DELAY, 1);
    ring.style.strokeDashoffset = 100 - (progress * 100);
    if (progress >= 1) clearInterval(_countdownInterval);
  }, 50);

  _driveTimer = setTimeout(async () => {
    clearInterval(_countdownInterval);
    ring.style.strokeDashoffset = 0;
    icon.textContent = '🔄';
    try {
      await gdriveUploadAndShare(currentCal);
      icon.textContent = '✅';
      ring.style.stroke = '#a5d6a7';
    } catch (e) {
      icon.textContent = '❌';
      ring.style.stroke = '#ef9a9a';
      console.warn('Drive sync:', e);
    }
    setTimeout(() => indicator.classList.add('hidden'), 1500);
  }, SYNC_DELAY);
}

/* Fetch updates for all imported calendars that have driveFileId */
async function gdriveFetchImported() {
  if (!gdriveToken) return;
  const imported = storeGetImported();
  for (const cal of imported) {
    if (!cal.driveFileId) continue;
    try {
      const data = await gdriveReadPublic(cal.driveFileId);
      if (data && data.updatedAt && data.updatedAt > (cal.updatedAt || '')) {
        data.driveFileId = cal.driveFileId;
        const result = storeImportCalendar(data);
        if (currentCal && currentCal.id === cal.id) {
          currentCal = result.cal;
          calRender();
        }
        renderCalSelector();
      }
    } catch (e) {
      console.warn(`Drive fetch failed for ${cal.name}:`, e);
    }
  }
}
