function renderLegalDocument() {
  const root = document.getElementById('legal-document-content');
  if (!root) return;

  const source = root.dataset.source;
  const sourceLink = document.getElementById('legal-document-source-link');
  const status = document.getElementById('legal-document-status');

  if (sourceLink && source) sourceLink.href = source;

  if (!source) {
    if (status) status.textContent = 'No se encontró la fuente principal del documento.';
    return;
  }

  fetch(source)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(html => {
      root.innerHTML = html;
    })
    .catch(() => {
      root.innerHTML = '<section class="card legal-page-card"><p>No se pudo cargar el documento desde su fuente principal. Puedes abrir el asset directo desde <a href="' + source + '">aquí</a>.</p></section>';
    });
}

document.addEventListener('DOMContentLoaded', renderLegalDocument);
