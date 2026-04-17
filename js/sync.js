/* sync.js — GitHub Gist sync: create, update, read calendars */

const GIST_TOKEN = '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';
const GIST_API = 'https://api.github.com/gists';

/* Create a new gist for a calendar, returns gist ID */
async function gistCreate(cal) {
  const payload = gistPayload(cal);
  const resp = await fetch(GIST_API, {
    method: 'POST',
    headers: gistHeaders(),
    body: JSON.stringify({ description: `Turnos: ${cal.name}`, public: false, files: { 'calendar.json': { content: JSON.stringify(payload) } } }),
  });
  if (!resp.ok) throw new Error(`Gist create failed: ${resp.status}`);
  const data = await resp.json();
  return data.id;
}

/* Update an existing gist */
async function gistUpdate(gistId, cal) {
  const payload = gistPayload(cal);
  const resp = await fetch(`${GIST_API}/${gistId}`, {
    method: 'PATCH',
    headers: gistHeaders(),
    body: JSON.stringify({ files: { 'calendar.json': { content: JSON.stringify(payload) } } }),
  });
  if (!resp.ok) throw new Error(`Gist update failed: ${resp.status}`);
}

/* Read a gist (public, no auth needed for secret gists if you have the ID) */
async function gistRead(gistId) {
  const resp = await fetch(`${GIST_API}/${gistId}`, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
  if (!resp.ok) throw new Error(`Gist read failed: ${resp.status}`);
  const data = await resp.json();
  const content = data.files['calendar.json']?.content;
  if (!content) throw new Error('No calendar.json in gist');
  return JSON.parse(content);
}

function gistHeaders() {
  return { 'Authorization': `Bearer ${GIST_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
}

function gistPayload(cal) {
  return { id: cal.id, name: cal.name, shifts: cal.shifts, events: cal.events, patterns: cal.patterns, updatedAt: cal.updatedAt };
}

/* Upload current calendar to gist (create or update) */
async function syncUpload() {
  if (!currentCal || currentCal.readonly) return;
  try {
    if (currentCal.gistId) {
      await gistUpdate(currentCal.gistId, currentCal);
    } else {
      const gistId = await gistCreate(currentCal);
      currentCal.gistId = gistId;
      storeSave(currentCal);
    }
  } catch (e) {
    console.warn('Sync upload failed:', e);
  }
}

/* Debounced upload — 3s after last change */
let _syncTimer = null;
function scheduleSyncUpload() {
  if (!currentCal || currentCal.readonly || !currentCal.gistId) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncUpload, 3000);
}

/* Fetch all imported calendars from their gists */
async function syncFetchImported() {
  const imported = storeGetImported();
  for (const cal of imported) {
    if (!cal.gistId) continue;
    try {
      const data = await gistRead(cal.gistId);
      if (data.updatedAt && data.updatedAt > cal.updatedAt) {
        const result = storeImportCalendar({ ...data, gistId: cal.gistId });
        if (currentCal && currentCal.id === cal.id) {
          currentCal = result.cal;
          calRender();
        }
        renderCalSelector();
      }
    } catch (e) {
      console.warn(`Sync fetch failed for ${cal.name}:`, e);
    }
  }
}
