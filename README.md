# 📅 Calendario de Turnos

Calendario web para gestionar turnos de trabajo. Zero config, zero servidor, zero cuentas obligatorias.

## Funcionalidades

- **Turnos**: Mañana (M), Tarde (T), Noche (N), Libre (L), Refuerzo (R) — con colores distintivos
- **Múltiples turnos por día**: Podés asignar más de un turno al mismo día (ej: M + R)
- **Notas en turnos**: Cada turno puede tener un comentario (ej: M "Patri" = mañana de Patri)
- **Patrones repetitivos**: Secuencia cíclica (ej: M,M,T,T,N,N,L,L) aplicable hasta una fecha o a un mes concreto
- **Eventos**: Texto libre por día (sin horario, solo marcas)
- **Multi-calendario**: Tu calendario (editable) + los que importes de otros (solo lectura)
- **Compartir por QR/link**: Los datos van comprimidos en la URL. Escaneo integrado con cámara
- **Compartir nativo**: Botón para compartir por WhatsApp, Telegram, etc. vía Web Share API
- **Google Drive sync**: Backup y sincronización opcional vía Google Drive
- **Tema claro/oscuro**: Automático según el SO o manual desde ⚙️
- **PWA**: Instalable en móvil, funciona offline
- **localStorage**: Todo se guarda en el navegador — funciona sin cuentas

## Cómo funciona el compartir

1. Abrí tu calendario → pestaña "Compartir" → "Compartir Turnos"
2. Los datos se comprimen con gzip y se codifican en el fragmento `#` de la URL
3. Si estás conectado a Google Drive, el calendario se sube y el QR incluye el `driveFileId` para sync futuro
4. El otro escanea el QR (con el botón 📷) o abre el link → se importa automáticamente
5. Si volvés a compartir después de cambios, el otro escanea de nuevo → se **actualiza** (no duplica)

Cada calendario tiene un UUID único. Si el receptor ya tiene ese ID, se sobreescribe con los datos nuevos.

## Google Drive — Sincronización

La conexión con Google Drive es **opcional**. Sin ella, la app funciona 100% con localStorage.

### Qué hace Drive

- **Backup automático**: Cada cambio en tu calendario se sube a Drive (2.5s después del último cambio)
- **Sync entre dispositivos**: Si usás la misma cuenta de Google en móvil y tablet, los cambios se sincronizan
- **Recuperación tras reinstalar**: Si desinstalás la PWA y la volvés a instalar, al loguearte con Google se restauran todos tus calendarios (propios e importados)
- **Sync de importados**: Los calendarios importados se guardan en tu Drive como backup (con su `driveFileId` original), así al reinstalar podés seguir actualizándolos sin re-escanear QR
- **Carpeta organizada**: Todos los archivos se guardan en una carpeta "Turnos" en tu Drive

### Flujo de sync

```
Dispositivo A (conectado a Drive):
  Cambia turno → 2.5s → se sube a Drive automáticamente
  Comparte QR → incluye driveFileId → el receptor puede sincronizar después

Dispositivo B (importó el calendario):
  Escanea QR → importa datos instantáneamente
  Conecta Drive → puede tocar 🔄 para actualizar desde el Drive del dueño
  Al abrir la app → auto-sincroniza calendarios importados (si está logueado)

Reinstalación:
  Instala PWA → pone nombre → conecta Google Drive
  → Se restauran calendarios propios + importados desde Drive
  → Si hay duplicado vacío local, se elimina automáticamente
```

### Quién es la fuente de verdad

**Last write wins**: el último dispositivo que sube a Drive gana. Al abrir la app, se descarga de Drive si hay versión más nueva. Para evitar conflictos, editá desde un solo dispositivo a la vez.

### Lectura pública

Los archivos de calendario en Drive se comparten como públicos (lectura). Esto permite que otros usuarios lean tu calendario sin necesitar autenticación. Para leer desde otro dispositivo logueado, se usa el token OAuth del usuario.

## Deploy en GitHub Pages

1. Subí todos los archivos a un repo
2. Settings → Pages → Deploy from branch → `main` / `/ (root)`
3. Listo. No hay nada que configurar.

### Google Cloud Console (para Drive sync)

1. Crear proyecto → habilitar Google Drive API
2. OAuth consent screen → publicar app
3. Credentials → OAuth 2.0 Client ID (Web) → agregar origin `https://TU-USUARIO.github.io`
4. Credentials → API Key → restringir a tu dominio y Google Drive API
5. Poner Client ID y API Key en `js/gdrive.js`

## Estructura

```
turnos/
├── index.html          # App principal + onboarding + scanner QR
├── manifest.json       # PWA manifest (standalone, launch_handler)
├── sw.js               # Service Worker (network-first + cache fallback + update detection)
├── css/styles.css      # Estilos responsive, tema claro/oscuro, colores por turno
├── js/
│   ├── store.js        # localStorage CRUD, UUID, multi-calendario
│   ├── calendar.js     # Grilla mensual, turnos con notas, patrones
│   ├── events.js       # Modal de día, eventos CRUD
│   ├── share.js        # Compresión pako, QR, import/export, scanner
│   ├── gdrive.js       # Google OAuth, Drive sync, backup/restore
│   └── app.js          # Bootstrap, selector, tabs, tema, onboarding, scanner
└── icons/              # PNG + SVG icons para PWA
```

## Modelo de datos

```json
{
  "id": "uuid",
  "name": "Turnos de Roberto",
  "version": 1,
  "readonly": false,
  "driveFileId": "1abc...",
  "shifts": {
    "2026-04-17": [
      { "type": "M", "note": "Patri" },
      { "type": "R", "note": "" }
    ]
  },
  "events": {
    "2026-04-20": [{ "text": "Reunión equipo" }]
  },
  "patterns": [
    { "sequence": ["M","M","T","T","N","N","L","L"], "startDate": "2026-04-01", "endDate": "2026-06-30" }
  ]
}
```

## Uso

1. Abrí la web — te pide tu nombre y crea tu calendario
2. Tocá un día para asignar turno (con nota opcional) o agregar evento
3. En "Patrones", armá una secuencia y aplicala a un rango de fechas
4. En "Compartir", generá un QR — quien lo escanee importa tu calendario
5. En ⚙️: cambiá nombre, tema, conectá Google Drive, actualizá la app o eliminá calendarios
6. Los calendarios importados se ven en solo lectura (pestañas de edición ocultas)
7. Botón 🔄 en calendarios importados para actualizar desde Google Drive
