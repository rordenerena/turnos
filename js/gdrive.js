/* gdrive.js — Google OAuth + Drive: backup & restore own calendars */

const GDRIVE_CLIENT_ID = '743453800087-molu80v03v3ms24ovp194vscc53nr6aj.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const GDRIVE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

let gdriveToken = null;
let gdriveReady = false;

function gdriveIsImportedCalendar(cal) {
  return !!(cal && cal.readonly);
}

async function gdriveParseErrorResponse(resp, fallbackMessage) {
  let detail = '';
  try {
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      detail = data?.error?.message || data?.message || '';
    } else {
      detail = (await resp.text()).trim();
    }
  } catch {}
  return detail || `${fallbackMessage} (${resp.status})`;
}

async function gdriveAssertOk(resp, fallbackMessage) {
  if (!resp.ok) {
    throw new Error(await gdriveParseErrorResponse(resp, fallbackMessage));
  }
  return resp;
}

async function gdriveReadFileAuthenticated(fileId) {
  if (!gdriveToken) throw new Error('No hay sesión autenticada de Drive');
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: { Authorization: `Bearer ${gdriveToken}` },
  });
  await gdriveAssertOk(resp, 'No se pudo leer el archivo de Drive');
  return await resp.json();
}

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
    gdriveFetchUser();
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
      gdriveFetchUser();
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
  const userEl = document.getElementById('gdrive-user');
  if (!btn) return;
  if (loggedIn) {
    btn.textContent = '✅ Conectado a Google Drive';
    btn.disabled = true;
    btn.onclick = null;
    if (actions) actions.classList.remove('hidden');
    if (userEl) userEl.classList.remove('hidden');
  } else {
    btn.textContent = '🔒 Conectar Google Drive';
    btn.disabled = false;
    btn.onclick = gdriveLogin;
    if (actions) actions.classList.add('hidden');
    if (userEl) userEl.classList.add('hidden');
  }
}

/* Fetch user info from Google OAuth2 */
async function gdriveFetchUser() {
  if (!gdriveToken) return;
  const userEl = document.getElementById('gdrive-user');
  if (userEl) userEl.classList.remove('hidden');
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${gdriveToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (userEl) userEl.textContent = `👤 ${data.email}`;
    }
  } catch (e) {
    console.warn('Failed to fetch user:', e);
  }
}

/* Manual sync: download from Drive then upload local changes */
async function gdriveManualSync() {
  if (!gdriveToken) { toast('Conecta Google Drive primero'); return; }
  toast('Sincronizando...');
  try {
    await gdriveRestoreCalendars();
    const mine = storeGetMine();
    for (const cal of mine) {
      await gdriveUpload(cal);
    }
    toast('Copia de seguridad completa ✓');
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
        const data = await gdriveReadFileAuthenticated(file.id);
        if (!data || !data.id) continue;
        data.driveFileId = file.id;
        const local = storeGet(data.id);
        if (!local) {
          const mine = storeGetMine();
          const emptyDupe = mine.find(c => c.name === data.name && !c.driveFileId && Object.keys(c.shifts || {}).length === 0 && (c.patterns || []).length === 0);
          if (emptyDupe) storeDelete(emptyDupe.id);
          data.readonly = false;
          storeSave(data, { touchUpdatedAt: false, syncedAt: new Date().toISOString() });
          restored++;
        } else if (data.updatedAt && data.updatedAt > (local.updatedAt || '')) {
          storeSave({ ...local, ...data, readonly: local.readonly }, { touchUpdatedAt: false, syncedAt: new Date().toISOString() });
          restored++;
        }
      } catch {}
    }
    if (restored) {
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
  const create = await gapi.client.drive.files.create({
    resource: { name: 'Turnos', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  _driveFolderId = create.result.id;
  return _driveFolderId;
}

/* Upload calendar to Drive (private backup). Returns fileId. */
async function gdriveUpload(cal) {
  if (!gdriveToken) throw new Error('No conectado a Drive');
  if (gdriveIsImportedCalendar(cal)) return; // Skip imported calendars silently
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
    const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${gdriveToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await gdriveAssertOk(resp, 'No se pudo actualizar el archivo en Drive');
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
    await gdriveAssertOk(resp, 'No se pudo crear el archivo en Drive');
    fileId = (await resp.json()).id;
    if (!fileId) throw new Error('Drive no devolvió un fileId válido');
  }

  cal.driveFileId = fileId;
  storeSave(cal);
  return fileId;
}

/* Debounced Drive upload with visual countdown */
let _driveTimer = null;
let _countdownInterval = null;
const SYNC_DELAY = 2500;

function scheduleDriveSync() {
  if (!gdriveToken || !currentCal || currentCal.readonly) return;
  clearTimeout(_driveTimer);
  clearInterval(_countdownInterval);

  // Capture calendar id NOW, not when the timeout fires
  const calId = currentCal.id;

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
      const freshCal = storeGet(calId);
      if (!freshCal || freshCal.readonly) return;
      await gdriveUpload(freshCal);
      if (currentCal && currentCal.id === calId) {
        currentCal.driveFileId = freshCal.driveFileId;
      }
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
