/* gdrive.js — Google OAuth + Drive sync (backup layer over localStorage) */

const GDRIVE_CLIENT_ID = '743453800087-molu80v03v3ms24ovp194vscc53nr6aj.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const GDRIVE_FILE_NAME = 'turnos-calendar.json';

let gdriveToken = null;
let gdriveFileId = null;
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
    // SDK not loaded yet, retry
    setTimeout(gdriveInit, 500);
  }
}

/* Restore session from saved token */
function gdriveRestoreSession() {
  const saved = localStorage.getItem('turnos_gdrive_token');
  if (!saved) return;
  const parsed = JSON.parse(saved);
  if (parsed.expires_at > Date.now()) {
    gdriveToken = parsed.access_token;
    gapi.client.setToken({ access_token: gdriveToken });
    gdriveOnLogin();
  } else {
    localStorage.removeItem('turnos_gdrive_token');
  }
}

/* Login with Google */
function gdriveLogin() {
  if (typeof google === 'undefined' || !google.accounts) { toast('Google SDK cargando, intentá de nuevo'); return; }
  if (!gdriveReady) { toast('Inicializando Drive, intentá de nuevo'); return; }
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
      gdriveOnLogin();
    },
  });
  client.requestAccessToken({ prompt: '' });
}

/* Logout */
function gdriveLogout() {
  if (gdriveToken) google.accounts.oauth2.revoke(gdriveToken);
  gdriveToken = null;
  gdriveFileId = null;
  localStorage.removeItem('turnos_gdrive_token');
  gapi.client.setToken('');
  gdriveUpdateUI(false);
}

/* After login: sync down then update UI */
async function gdriveOnLogin() {
  gdriveUpdateUI(true);
  toast('Drive conectado, sincronizando...');
  try {
    await gdriveSyncDown();
    toast('Drive sincronizado ✓');
  } catch (e) {
    console.warn('Drive sync failed:', e);
  }
}

/* Update login/logout button */
function gdriveUpdateUI(loggedIn) {
  const btn = document.getElementById('btn-gdrive');
  if (!btn) return;
  if (loggedIn) {
    btn.textContent = '✅ Conectado a Google Drive';
    btn.disabled = true;
    btn.onclick = null;
    document.getElementById('btn-gdrive-disconnect').classList.remove('hidden');
  } else {
    btn.textContent = '🔒 Conectar Google Drive';
    btn.disabled = false;
    btn.onclick = gdriveLogin;
    document.getElementById('btn-gdrive-disconnect').classList.add('hidden');
  }
}

/* Find our file in Drive */
async function gdriveFindFile() {
  const resp = await gapi.client.drive.files.list({
    q: `name='${GDRIVE_FILE_NAME}' and trashed=false`,
    fields: 'files(id,modifiedTime)',
    spaces: 'drive',
  });
  const files = resp.result.files;
  return files && files.length ? files[0] : null;
}

/* Read file content from Drive */
async function gdriveReadFile(fileId) {
  const resp = await gapi.client.drive.files.get({ fileId, alt: 'media' });
  return typeof resp.result === 'string' ? JSON.parse(resp.result) : resp.result;
}

/* Create file in Drive */
async function gdriveCreateFile(data) {
  const metadata = { name: GDRIVE_FILE_NAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${gdriveToken}` },
    body: form,
  });
  return (await resp.json()).id;
}

/* Update file in Drive */
async function gdriveUpdateFile(fileId, data) {
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${gdriveToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/* Build payload from all own calendars */
function gdriveBuildPayload() {
  const all = storeGetAll();
  return { syncedAt: new Date().toISOString(), calendars: all };
}

/* Sync UP: localStorage → Drive */
async function gdriveSyncUp() {
  if (!gdriveToken) return;
  const payload = gdriveBuildPayload();
  try {
    if (!gdriveFileId) {
      const existing = await gdriveFindFile();
      gdriveFileId = existing ? existing.id : null;
    }
    if (gdriveFileId) {
      await gdriveUpdateFile(gdriveFileId, payload);
    } else {
      gdriveFileId = await gdriveCreateFile(payload);
    }
  } catch (e) {
    console.warn('Drive upload failed:', e);
  }
}

/* Sync DOWN: Drive → localStorage (merge: Drive wins if newer) */
async function gdriveSyncDown() {
  if (!gdriveToken) return;
  const existing = await gdriveFindFile();
  if (!existing) { gdriveFileId = null; return; }
  gdriveFileId = existing.id;
  const remote = await gdriveReadFile(existing.id);
  if (!remote || !remote.calendars) return;

  const local = storeGetAll();
  let changed = false;

  for (const [id, remoteCal] of Object.entries(remote.calendars)) {
    const localCal = local[id];
    if (!localCal || (remoteCal.updatedAt && remoteCal.updatedAt > (localCal.updatedAt || ''))) {
      local[id] = remoteCal;
      changed = true;
    }
  }

  if (changed) {
    storeSaveAll(local);
    const activeId = storeGetActive();
    currentCal = storeGet(activeId) || storeGetMine()[0];
    renderCalSelector();
    calRender();
  }
}

/* Debounced sync up — 5s after last change */
let _driveTimer = null;
function scheduleDriveSync() {
  if (!gdriveToken) return;
  clearTimeout(_driveTimer);
  _driveTimer = setTimeout(gdriveSyncUp, 5000);
}
