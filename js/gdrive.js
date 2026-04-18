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
  const disc = document.getElementById('btn-gdrive-disconnect');
  if (!btn) return;
  if (loggedIn) {
    btn.textContent = '✅ Conectado a Google Drive';
    btn.disabled = true;
    btn.onclick = null;
    if (disc) disc.classList.remove('hidden');
  } else {
    btn.textContent = '🔒 Conectar Google Drive';
    btn.disabled = false;
    btn.onclick = gdriveLogin;
    if (disc) disc.classList.add('hidden');
  }
}

/* Upload calendar to Drive and make it public. Returns fileId. */
async function gdriveUploadAndShare(cal) {
  if (!gdriveToken) throw new Error('No conectado a Drive');
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
      // Trash duplicates
      for (let i = 1; i < resp.result.files.length; i++) {
        gapi.client.drive.files.update({ fileId: resp.result.files[i].id, resource: { trashed: true } }).catch(() => {});
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
    // Create
    const metadata = { name: fileName, mimeType: 'application/json' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${gdriveToken}` },
      body: form,
    });
    fileId = (await resp.json()).id;

    // Make public
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
