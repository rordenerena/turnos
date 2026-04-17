# 📅 Calendario de Turnos

Calendario web para gestionar turnos de trabajo. Zero config, zero servidor, zero cuentas.

## Funcionalidades

- **Turnos**: Mañana (M), Tarde (T), Noche (N), Libre (L) con colores
- **Patrones repetitivos**: Secuencia cíclica aplicable hasta una fecha o a un mes concreto
- **Eventos**: Texto libre por día (sin horario)
- **Multi-calendario**: Tu calendario + los que importes de otros
- **Compartir por QR/link**: Los datos van comprimidos en la URL — sin servidor
- **Exportar/Importar JSON**: Backup manual
- **PWA**: Instalable, funciona offline
- **localStorage**: Todo se guarda en el navegador

## Cómo funciona el compartir

1. Abrí tu calendario → pestaña "Compartir" → "Generar QR"
2. Los datos se comprimen con gzip y se codifican en el fragmento `#` de la URL
3. El otro escanea el QR o abre el link → se importa automáticamente
4. Si volvés a compartir después de cambios, el otro escanea de nuevo → se **actualiza** (no duplica)

Cada calendario tiene un UUID único. Si el receptor ya tiene ese ID, se sobreescribe con los datos nuevos.

## Deploy en GitHub Pages

1. Subí todos los archivos a un repo
2. Settings → Pages → Deploy from branch → `main` / `/ (root)`
3. Listo. No hay nada que configurar.

## Estructura

```
turnos/
├── index.html
├── manifest.json
├── sw.js
├── css/styles.css
├── js/
│   ├── store.js      # localStorage CRUD, UUID, multi-calendario
│   ├── calendar.js   # Grilla, turnos, patrones
│   ├── events.js     # Modal, eventos por día
│   ├── share.js      # Compresión pako, QR, import/export
│   └── app.js        # Bootstrap, selector, tabs
└── icons/
```

## Uso

1. Abrí la web — tu calendario se crea automáticamente
2. Tocá un día para asignar turno o agregar evento
3. En "Patrones", armá una secuencia y aplicala
4. En "Compartir", generá un QR — quien lo escanee importa tu calendario
5. En ⚙️, cambiá tu nombre, exportá JSON o eliminá calendarios
