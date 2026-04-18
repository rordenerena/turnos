# 📅 Calendario de Turnos

Calendario web para gestionar turnos de trabajo con **Google Calendar como fuente de verdad**. No hay backend: todo corre en el navegador y se publica en GitHub Pages.

## Modelo del producto

- **Login obligatorio con Google** antes de usar la app.
- La app crea o reutiliza **un único calendario secundario administrado por Turnos** por usuario.
- Ese calendario se vuelve **público en modo lectura** para compartirlo por iCal.
- Los turnos se guardan como **eventos de día completo** directamente en Google Calendar.
- Los patrones se guardan como **series recurrentes** con metadatos en `extendedProperties.private`.
- Los calendarios importados son **solo lectura** y, si provienen de un Google Calendar público generado por la app, se refrescan usando **Google Calendar API con la sesión activa**; para otros iCal queda un fallback best-effort por feed.
- `localStorage` queda limitado a **preferencias, caché y suscripciones importadas**, no a los datos dueños.

## Funcionalidades

- **Turnos**: Mañana (M), Tarde (T), Noche (N), Libre (L), Refuerzo (R)
- **Notas por turno**: usando la descripción del evento all-day
- **Patrones repetitivos**: series recurrentes diarias con `INTERVAL = largo de la secuencia`
- **Excepciones por día**: cambios y borrados dentro de un patrón usando instancias canceladas, sin aplanar toda la serie
- **Eventos libres por día**: también como eventos all-day
- **Compartir por QR/link**: el QR comparte la referencia al iCal público del calendario
- **Importación read-only**: usando la referencia iCal compartida; los feeds de Google se refrescan por API autenticada y los iCal genéricos usan fallback best-effort
- **Tema claro/oscuro**
- **PWA** instalable

## Cómo funciona el compartir

1. Iniciás sesión con Google.
2. La app resuelve o crea tu calendario administrado.
3. En la pestaña **Compartir**, generás un QR o link.
4. Ese link lleva una referencia `#ical=...` al feed público de Google Calendar.
5. El receptor lo abre o escanea y la app guarda una suscripción read-only.
6. Si el enlace compartido apunta a un Google Calendar público generado por la app, el importado se refresca por Google Calendar API con tu sesión activa; otros iCal usan fallback best-effort.

## Google Cloud Console

1. Crear proyecto y habilitar **Google Calendar API**.
2. OAuth consent screen → publicar app.
3. Credentials → OAuth 2.0 Client ID (Web) → agregar origin `https://TU-USUARIO.github.io`.
4. Poner el Client ID en `js/gcalendar.js`.

La app usa scope completo de Calendar porque necesita:

- crear el calendario secundario,
- administrar su ACL pública,
- crear/editar/borrar eventos e instancias,
- leer el perfil básico del usuario.

## Estructura

```text
turnos/
├── index.html          # App principal + auth gate + scanner QR
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker
├── css/styles.css      # Estilos responsive
├── js/
│   ├── store.js        # Preferencias, metadatos owner e importaciones iCal
│   ├── calendar.js     # Grilla mensual, edición de turnos y patrones
│   ├── events.js       # Modal de día y eventos all-day
│   ├── share.js        # QR/link + parser iCal para importados
│   ├── gcalendar.js    # Auth Google + capa Google Calendar (sin Drive)
│   └── app.js          # Bootstrap auth-gated y navegación
└── icons/              # PNG + SVG icons para PWA
```

## Convenciones de datos en Google Calendar

### Turno manual

- `summary`: `M`, `T`, `N`, `L` o `R`
- `description`: nota opcional
- `extendedProperties.private`:
  - `turnosApp=1`
  - `turnosKind=shift`
  - `turnosShiftType=<tipo>`

### Patrón

Un patrón crea **un evento recurrente por offset de la secuencia** con:

- `turnosApp=1`
- `turnosKind=pattern`
- `turnosPatternId`
- `turnosSequenceIndex`
- `turnosSequenceLength`
- `turnosShiftType`

### Evento libre

- `summary`: texto visible
- `turnosKind=event`

## Notas

- Ya no existe flujo de Google Drive.
- Ya no existe snapshot comprimido del calendario en URL.
- La app ya no usa `localStorage` como fuente de verdad del calendario dueño.
