# Koe-Kyō (声響)

Estudio de voz local con React, Vite, Tailwind 4, Tauri 2 y FastAPI/pedalboard.
Frontend y motor de audio dockerizados; aplicación Tauri nativa.

## Iniciar
Requiere Docker Desktop abierto, con contenedores Linux y Compose v2.

```powershell
docker compose up -d --build --wait
```

Abrir http://localhost:5173. Para detener sin borrar proyectos:

```powershell
docker compose down
```

## Flujo de trabajo
1. Menú del estudio > Grabar o Importar archivo. Solo se abre el panel elegido.
2. Al grabar, permite el micrófono. La onda, nivel dBFS y tiempo aparecen en directo.
3. Detener incorpora la toma final. Hasta 10 minutos por toma y 16 pistas por proyecto.
4. Selecciona una pista con su nombre o su onda.
5. Editar pista, arriba de las pistas, permite introducir Inicio y Fin, conservar o
   borrar la selección y dividir en Inicio. También puedes seleccionar arrastrando.
6. Posición (segundos), volumen y silencio controlan el montaje.
7. Escuchar mezcla reproduce el montaje y mueve la línea ámbar por todas las pistas.
   La barra temporal permite mover el cursor; al moverla se detiene y puedes reanudar.
8. Si la pista no tiene efectos, pulsa Mejorar voz para abrir el panel izquierdo.
   Si ya tiene efectos, basta seleccionarla: aparecen sus controles sin Mejorar voz.
   Añade uno o varios presets, ajusta sus controles y confirma con Activar efecto.
   Agregado y activo son estados distintos: un efecto apagado no modifica el audio.
   Una vez activo, los controles actualizan automáticamente la misma pista.
   La casilla o Desactivar efecto lo apagan sin borrarlo; la × lo elimina.
   Quitar todos los efectos recupera la fuente original guardada.
   Escuchar mezcla y WAV de pista usan el audio de esta misma pista, sin bloques extra.
9. Deshacer revierte hasta diez cambios de esta sesión, incluidos los efectos aplicados.
10. El audio nuevo se añade al final por defecto; puedes elegir En el cursor o Superponer.

Los efectos activos se actualizan después de una espera breve (450 ms), procesando desde
el original, sin acumular el resultado de pasadas anteriores. El estado indica si está
procesando o esperando al motor. La reproducción se actualiza al terminar.
No existen los botones Aplicar a esta pista o Usar mezcla para mejorar voz ni un reproductor
extra de salida. La exportación se realiza desde la pista o la mezcla del editor.

## Presets y DSP
- Podcast: voz cercana, cálida y sin reverberación añadida.
- Locutor: cuerpo, presencia, control de sibilancias y nivelado.
- Habitación cerrada: reverberación corta, con 1 segundo de cola.
- Aire libre: voz seca, puerta de ruido y reducción espectral moderada.
- Catedral: reverberación amplia, con 4 segundos de cola.

Controles básicos: profundidad, claridad, compresión y puerta de ruido.
Más herramientas de voz: de-esser, reducción espectral de ruido continuo,
nivelado RMS, tono (-6 a +6 semitonos) y atenuación de colas suaves en pausas.

Cadena: Limpieza IA (DeepFilterNet3) > reducción espectral, colas, nivelado, tono >
puerta de ruido > Highpass (según micrófono) > EQ del micrófono > LowShelf 160 Hz >
Compressor 3:1 > HighShelf 4500 Hz > De-esser dinámico > Reverb (ambientes) >
normalización LUFS > limitador de pico verdadero -1 dBTP.

Parámetros nuevos de POST /process (todos opcionales):
- ai_denoise 0-100: DeepFilterNet3 local, atenuación máxima de 6 a 60 dB. Quita ruido y eco de sala.
  El modelo se descarga al construir la imagen; después funciona sin Internet.
- loudness: -14 (Spotify/YouTube), -16 (podcast, por defecto), -19 u off.
  Medición BS.1770-4 / EBU R128 propia, verificada: 1 kHz a -23 dBFS mide -23,0 LUFS.
- mic: generic, dynamic, condenser, usb, lavalier, laptop. Ajusta paso alto, EQ correctiva
  y la frecuencia central del de-esser.
- deess: EQ dinámica de banda dividida; solo atenúa la banda sibilante cuando supera
  el umbral relativo a la voz (hasta 8:1 y 16 dB).
La respuesta incluye X-Input-LUFS, X-Output-LUFS y X-True-Peak (dBTP, sobremuestreo x4).

La reducción espectral es estadística y puede atenuar voz suave.
Colas de sala reduce sonido tenue durante pausas, no elimina completamente el eco.
El cambio de tono no es afinación automática por notas. No hay separación de hablantes IA.
La imagen del backend ocupa ~1,2 GB (PyTorch CPU) y usa hasta ~1,9 GB de RAM con 15 min estéreo.

## Proyectos y autoguardado
El menú permite Guardar proyecto, Nuevo proyecto y Duplicar proyecto.
El selector Abrir proyecto recupera los guardados; el nombre puede editarse.

SQLite conserva el audio PCM float32, cortes, posiciones, volúmenes, silencios,
fuentes originales, resultados procesados, cadenas activas/inactivas y todos los controles. Los cortes se guardan
como audio editado. El historial Deshacer no se conserva al recargar.

El autoguardado espera 700 ms desde el último cambio y muestra Guardado localmente
al finalizar. Durante la grabación crea una toma provisional cada 5 segundos;
Detener guarda la versión final. Una recarga recupera el último guardado confirmado.
Cerrar durante la captura puede perder los últimos segundos.

Base: /data/projects.sqlite3, en el volumen Docker projects-data.
Actualizar o recrear los contenedores conserva el volumen.
**docker compose down -v elimina el volumen y sus proyectos.**

Límite: 512 MB de PCM y 16 pistas por proyecto. Los errores de guardado aparecen
en pantalla. El micrófono requiere localhost/HTTPS y permiso del usuario.

## Exportar a Audacity o DaVinci Resolve
- WAV de pista: cada pista desde cero, con su volumen y efectos ya aplicados.
- Exportar mezcla WAV: suma las pistas activas y conserva sus posiciones.
- Los efectos activos quedan incluidos en esas mismas exportaciones; no hay audio de salida separado.

Salida del editor: WAV PCM de 24 bits, 48 kHz estéreo.
La suma se atenúa globalmente solo si supera -1 dBFS.
Importa los WAV desde Audacity o desde el Media Pool de DaVinci Resolve.
Las exportaciones son audio estándar; no generan archivos nativos .aup3 o .drp.

Importación: WAV/MP3 mono o estéreo, hasta 100 MB y 15 minutos por pista.
El motor de efectos admite hasta 100 MB y 15 minutos de entrada y procesa un trabajo
a la vez. Proyectos grandes se pueden editar/exportar aunque necesiten recortarse
para enviarlos al motor.

## Tauri
Para Windows: Node 22, Rust estable, herramientas C++ de Visual Studio y WebView2.
En macOS: Rust y Xcode Command Line Tools. Compilar en el sistema de destino.

```powershell
npm install
npm run tauri dev
npm run tauri build
```

El instalador aparece en src-tauri/target/release/bundle/.
Tauri inicia Docker Compose automáticamente y mantiene los contenedores al salir.
La primera ejecución puede descargar y construir imágenes y necesita Internet.
Docker Desktop debe estar instalado y abierto. El instalador incluye los recursos
de Docker, no Docker Desktop. El ejecutable nativo no se ha compilado en este equipo
porque Rust no está disponible.

## Pruebas
```powershell
npm install
npx playwright install chromium
npm run test:editor
```

Opcional: PLAYWRIGHT_CHROMIUM_EXECUTABLE apunta a un Chromium ya instalado.
Las pruebas usan un micrófono simulado: grabación PCM, onda en directo, toma
provisional, mejora de la pista, edición, línea móvil, WAV, presets y persistencia
al recargar, duplicar y cambiar proyectos.

## Archivos principales
- src/App.jsx: panel lateral de efectos, presets y aplicación DSP.
- src/AudioEditor.jsx: grabación, edición, reproducción y menú.
- src/LiveRecording.jsx y public/recorder-worklet.js: onda y captura PCM.
- src/audio.js: recortes, mezcla y codificación WAV.
- src/projectStore.js: apertura, autoguardado y duplicación.
- backend/main.py: API y cadena de efectos.
- backend/voice_fx.py: procesamiento adicional propio.
- backend/projects.py: SQLite y almacenamiento de pistas.
- compose.yaml: servicios y volumen persistente.
- src-tauri/: aplicación nativa y arranque de Docker.

## Referencias
- https://spotify.github.io/pedalboard/reference/pedalboard.html
- https://fastapi.tiangolo.com/tutorial/request-files/
- https://tailwindcss.com/docs/installation/using-vite
- https://v2.tauri.app/reference/config/

## Segmentos y velocidad
Arrastra la cabecera de cada segmento para moverlo antes o después en la línea de tiempo.
Editar pista permite extraer una selección interior en tres segmentos, dividir, conservar,
borrar y mover el segmento al cursor. Cada segmento conserva su cadena de efectos.
El zoom horizontal mantiene una escala temporal; al añadir audio la línea de tiempo crece.
El control Velocidad ofrece 0.5x, 0.75x, 1x, 1.25x, 1.5x y 2x.
Cambiar velocidad conservando tono procesa la fuente con pedalboard.time_stretch.
La nueva duración se refleja en reproducción, onda, exportación y autoguardado.
Los segmentos posteriores mantienen su posición: no se desplazan automáticamente al cambiar velocidad.
Los proyectos anteriores a la conservación de fuentes pueden contener efectos ya incorporados
en el audio: para quitar esos efectos históricos hace falta volver a importar su archivo original.

## Acciones visibles de pistas
Añadir pista abre el menú para grabar otra toma o importar más archivos.
Cada grabación es una pista independiente y nueva, sin efectos heredados.
Una pista con efectos muestra su recuento, sin botón Mejorar voz; al seleccionarla se abren sus controles.
Una pista sin efectos no muestra el panel hasta pulsar Mejorar voz o Agregar efecto.
Agregar un efecto lo deja apagado. Activar efecto confirma su entrada; luego sus parámetros se actualizan automáticamente.
Eliminar pista está arriba del montaje para la pista seleccionada, además de la papelera de cada fila.
Separar selección divide una pista en tres segmentos independientes y movibles.
Combinar en una une las pistas activas y mantiene las silenciadas. Los efectos quedan incorporados
al audio combinado. Deshacer recupera las pistas anteriores durante esta sesión.
Restaurar desde archivo original reemplaza el audio seleccionado, conserva su posición
y quita su cadena de efectos. Sirve para material de versiones anteriores procesado sin original guardado.

## Pista actual por defecto
Destino empieza en Pista actual: las importaciones y tomas son segmentos movibles en la misma fila.
Elige Nueva pista o Crear otra pista para añadir música en otra fila; empieza en cero si no indicas cursor.
Los segmentos mantienen sus efectos propios y no heredan los de otros.
Puedes superponer segmentos de una fila, pero dos pistas separadas facilitan editar voz y música.
Combinar en una convierte los segmentos activos en un único audio. Deshacer los recupera durante la sesión.

## Reproducción en loop
La casilla Loop repite automáticamente hasta pulsar Detener.
El selector Reproducir permite Toda la grabación, Pista seleccionada o Segmento seleccionado.
Una pista sola conserva los huecos entre sus segmentos y omite el silencio anterior al primero.
El cursor vuelve al comienzo del alcance elegido y el contador indica cada vuelta.
Puedes activar/desactivar Loop o cambiar el alcance durante la reproducción.
Cambiar de selección mientras escuchas solo una pista/segmento cambia el audio reproducido.
El loop sirve para escuchar; no altera ni alarga los WAV exportados.

### Loop del audio seleccionado
El inspector incluye Reproducir este audio en loop: repite únicamente el bloque marcado,
aunque comparta fila con otros segmentos o esté situado lejos del tiempo cero.
El selector distingue Pista / audio seleccionado de Fila completa seleccionada.
El nombre del destino aparece junto al selector. El alcance Toda la grabación conserva su comportamiento.
Cambiar rápidamente de alcance o selección cancela cualquier arranque anterior para evitar audios superpuestos.

## Visualizador neón
El espectro muestra barras fosforescentes verdes, cian, violetas y magenta con reflejo.
Se alimenta de un AnalyserNode real: responde al audio reproducido, a su loop y al alcance seleccionado.
Durante la grabación analiza el micrófono sin enviarlo a los altavoces.
La onda de edición se mantiene disponible para cortar y mover.
En silencio las barras bajan; al detener se asientan. Respeta movimiento reducido y limita la tasa de dibujo.

## Identidad Koe-Kyō (声響)
El título neón aparece arriba; la pestaña y la ventana nativa usan el nuevo nombre.
El obake de la esquina inferior izquierda flota, parpadea y saluda al pulsarlo.
La × lo oculta y el pequeño botón inferior lo recupera. Respeta movimiento reducido.
La base de proyectos y el volumen Docker conservan sus identificadores para preservar las sesiones existentes.
