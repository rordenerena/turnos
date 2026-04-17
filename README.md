# 📅 Calendario de Turnos

Calendario web para gestionar turnos de trabajo. Zero config, zero servidor, zero cuentas.

## Funcionalidades

- **Turnos**: Mañana (M), Tarde (T), Noche (N), Libre (L), Refuerzo (R) — con colores distintivos
- **Múltiples turnos por día**: Podés asignar más de un turno al mismo día (ej: M + R)
- **Notas en turnos**: Cada turno puede tener un comentario (ej: M "Patri" = mañana de Patri)
- **Patrones repetitivos**: Secuencia cíclica (ej: M,M,T,T,N,N,L,L) aplicable hasta una fecha o a un mes concreto
- **Eventos**: Texto libre por día (sin horario, solo marcas)
- **Multi-calendario**: Tu calendario (editable) + los que importes de otros (solo lectura)
- **Compartir por QR/link**: Los datos van comprimidos en la URL con acortador automático
- **Compartir nativo**: Botón para compartir por WhatsApp, Telegram, etc. vía Web Share API
- **Exportar/Importar JSON**: Backup manual completo
- **PWA**: Instalable en móvil, funciona offline
- **localStorage**: Todo se guarda en el navegador — sin cuentas, sin servidor

## Cómo funciona el compartir

1. Abrí tu calendario → pestaña "Compartir" → "Compartir Turnos"
2. Los datos se comprimen con gzip y se codifican en el fragmento `#` de la URL
3. La URL se acorta automáticamente (zip1.io) para que el QR sea más limpio
4. El otro escanea el QR o abre el link → se importa automáticamente
5. Si volvés a compartir después de cambios, el otro escanea de nuevo → se **actualiza** (no duplica)

Cada calendario tiene un UUID único. Si el receptor ya tiene ese ID, se sobreescribe con los datos nuevos.

## Deploy en GitHub Pages

1. Subí todos los archivos a un repo
2. Settings → Pages → Deploy from branch → `main` / `/ (root)`
3. Listo. No hay nada que configurar.

## Estructura

```
turnos/
├── index.html          # App principal + onboarding
├── manifest.json       # PWA manifest (standalone, launch_handler)
├── sw.js               # Service Worker (network-first + cache fallback)
├── css/styles.css      # Estilos responsive, colores por turno
├── js/
│   ├── store.js        # localStorage CRUD, UUID, multi-calendario
│   ├── calendar.js     # Grilla mensual, turnos con notas, patrones
│   ├── events.js       # Modal de día, eventos CRUD
│   ├── share.js        # Compresión pako, QR, acortador, import/export
│   └── app.js          # Bootstrap, selector, tabs, onboarding
└── icons/              # SVG icons para PWA
```

## Modelo de datos

```json
{
  "id": "uuid",
  "name": "Turnos de Roberto",
  "version": 1,
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
5. En ⚙️, cambiá tu nombre, exportá JSON, actualizá la app o eliminá calendarios
6. Los calendarios importados se ven en solo lectura (pestañas de edición ocultas)
