# EVA · ejecución de los dos mandatos

## Encargo y criterio de aceptación

Aplicar el prompt de movimiento semántico y el de realismo para navegador al diorama existente, y animar los tres personajes de su plataforma. Mantener un `index.html` autocontenido, los controles de ventana/órbita/recorrido, detección facial local, sonido voluntario, captura y preferencias. El mandato autoriza ejecución autónoma; las decisiones de relevancia se documentan y se implementan.

## A–H · diagnóstico previo

| Área | Hallazgo previo a los cambios |
|---|---|
| A. Estado | Diorama de busto EVA–01 con hangar, tres figuras pequeñas, luces Estudio/Cine/Alerta, cámara off-axis y detector facial incluido. |
| B. Arquitectura | Three.js 0.186.1, WebGL2, materiales PBR y texturas procedurales, PCF, RoomEnvironment/PMREM, EffectComposer y bloom. Un HTML de 1.246.745 bytes en `main`. |
| C. Límites | No hay modelos humanos escaneados ni animación capturada. Son figuras a escala de una maqueta. No se presume GPU del usuario, memoria de vídeo, tiempo GPU ni 60 FPS. El archivo debe seguir abriendo sin descargas. |
| D. Cuellos | Los operarios son figuras fusionadas: sólo gira cada grupo completo. Calidad alta/ligera con degradación única. Se dibuja incluso estando la escena pausada. La referencia gráfica de prueba usa SwiftShader y sus intervalos son demasiado escasos para inferir velocidad de hardware. |
| E. Distancia al objetivo | Rigidez de operarios, superficies de armadura poco diferenciadas, poco control de contacto/oclusión, falta de perfiles y de diagnóstico verificable. La geometría original sigue siendo una interpretación artística, no fotogrametría. |
| F. Selección | Articulación y skinning, pies anclados, capas de actuación, materiales diferenciados, luces coherentes, AO acotado, HDR/AA, WebGPU real con WebGL2 de respaldo, resolución adaptable, estados UI accesibles. |
| G. Omisiones por contexto | No hay océano, paisaje, tráfico, vegetación ni meteorología. No añadirlos para cubrir casillas. No inventar una fuente variable, motion matching, trazado de rayos o reconstrucción temporal si no se implementan. |
| H. Orden | Fuente reproducible y baseline → animación/movimiento/materiales → renderer y calidad → integración → verificación visual y funcional → revisión independiente → entrega en GitHub. |

El JavaScript recompilado de los fuentes recuperados coincide byte por byte con el de `main`: SHA-256 normalizado `467c4beb36f8c85393065649722ae85c1653c0aa2fc9b1815bcf05a01c17ba2f`. La recuperación añade mantenibilidad sin sustituir el diorama.

## Plan de implementación

**Goal:** Mejorar presencia, legibilidad y movimiento sin romper los recorridos reales.

**Architecture:** El HTML sigue siendo el producto compilado. `src/main.js` coordina dominio y ciclo de vida; módulos pequeños poseen animación de personajes, presentación UI, superficies, renderer y calidad. Los módulos reciben la misma escena y reloj, sin bucles privados.

**Tech Stack:** Three.js 0.186.1, JavaScript ES2020, CSS/WAAPI, Node/esbuild para compilar, Node test y Playwright para validar.

### Restricciones generales

- Cero solicitudes de red de la aplicación al abrir el HTML.
- Cámara y sonido se activan sólo por una acción de usuario.
- `prefers-reduced-motion` funciona al iniciar y cambia durante la sesión.
- No confundir tiempo de CPU, intervalo de frame y tiempo de GPU.
- Conservar el plano de pantalla en proyección off-axis y los pies en la plataforma.
- No mantener recursos transitorios, callbacks obsoletos ni ciclos RAF duplicados.

### 1. Personajes y superficies

- [x] `src/crew.js` y `src/hangar.js`: tres rigs con acciones diferentes, animación por reloj, respuesta a activación y articulación GPU.
- [x] Pruebas de contacto, transformaciones finitas, congelación y presupuesto de recursos: nueve pruebas de operarios incluidas en las 52 unitarias aprobadas.
- [x] `src/surface-detail.js`, `src/eva.js`, `src/exhibit-lighting.js`: variación de materiales específica, texturas deterministas y luces coherentes.
- [x] Inspeccionar poses intermedias y las tres luces; capturas de trabajo a 0/3/6 s y revisión Cine/Estudio/Alerta registradas.

### 2. Movimiento de interfaz

- [x] `src/motion.js` y `src/motion.css`: único dueño de WAAPI; las decisiones de estado y foco son inmediatas.
- [x] Matriz completa de 16 técnicas y contratos en `docs/motion-design.md`.
- [x] Apertura/cierre repetido, cancelar/reabrir, movimiento reducido antes y durante la transición; 20 ciclos reales y contratos unitarios sin animaciones huérfanas.

### 3. Render y calidad

- [x] `src/render-pipeline.js`: selección real de backend, fallback seguro, HDR, AA, bloom y AO cuando corresponda.
- [x] `src/quality.js`: cinco perfiles, DPR y presupuesto de píxeles limitados, histéresis, estadística de frames.
- [x] `src/main.js`: integración, diagnóstico, pausa con render a demanda, captura y restauración del estado.
- [x] Verificar selección inválida, falta de WebGPU, WebGL2, errores de inicialización y cambio de calidad durante interacción. Unitarias, WebGL2 real, cinco perfiles confirmados tras su evento de cambio y fixtures de coordinación; salida WebGPU nativa no verificada en este entorno.

### 4. Entrega y verificación

- [x] Compilación reproducible de `index.html`; fuentes, avisos y dependencias fijadas. Instalación limpia y recompilación idéntica verificadas.
- [x] Pruebas unitarias de contratos: 52 aprobadas, 0 fallos.
- [x] Prueba de navegador offline sobre el HTML final identificado por hash: 12/12 casos aprobados, navegador cerrado.
- [x] Teclado, foco, táctil, resize y 20 ciclos de paneles; pausar/reanudar y captura. Dos casos adicionales de coordinación de ciclo de vida aprobados.
- [ ] Secuencia completa de activación desde el botón en navegador: no incluida en los 12 casos; la respuesta de los rigs sí está cubierta por pruebas unitarias.
- [x] Evidencia con entorno, muestras y límites en `docs/verification.md`.
- [x] Revisión independiente del diff y correcciones antes del commit/PR; apta para entrega dentro de los límites registrados.

### Riesgos que guían las pruebas

1. Fallo WebGPU después de adquirir el contexto: devolver un canvas nuevo antes de instalar entradas.
2. Ocultar un panel a mitad de entrada: no dejar foco en nodos ocultos ni promesas sin resolver.
3. Pausar mientras cambia la iluminación: alcanzar un estado estable y detener trabajo innecesario.
4. Captura de mayor tamaño: restaurar resolución, pausa y calidad incluso si falla el PNG.
5. Volver de pestaña oculta: no avanzar segundos de animación ni iniciar dos bucles.

Las técnicas del prompt gráfico se interpretan mediante su §186 y su modo autónomo: seleccionar las pertinentes, describir sustituciones y no llamar TAA a un suavizado espacial.
