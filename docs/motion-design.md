# Movimiento semántico de EVA

## 1. Contexto observado y criterio

La aplicación es un diorama interactivo del hangar de EVA. Sus recorridos reales son mirar a través de la ventana, orbitar la maqueta, iniciar el recorrido automático, cambiar la iluminación, activar la cámara opcional, centrar la vista, abrir ajustes/ayuda, pausar y ejecutar la activación simulada. Los tres operarios existentes dan escala humana al hangar. No se agregan pantallas, rutas, sonidos ni controles de demostración de efectos.

Se inspeccionaron `shell.html`, `src/main.js`, `src/hangar.js`, `src/eva.js` y los módulos de proyección y seguimiento. La entrega conserva `index.html` autocontenido; los módulos recuperados permiten mantenerlo y reconstruirlo. La interfaz usa HTML/CSS, las transiciones puntuales usan Web Animations API y los personajes usan la escena Three.js existente. El sistema de UI no añade dependencias ni peticiones de red.

**Decisión de diseño:** movimiento contenido, mecánico y legible. El contenido nuevo se asienta cerca de su posición final; el cierre ocurre inmediatamente. El trabajo de los personajes explica sus funciones en el hangar. La cámara sigue los controles existentes y no recibe una inclinación o un zoom decorativos al pulsar botones.

**Hechos, inferencias y límites:** el código demuestra cuáles son los eventos y propietarios del estado. La utilidad de un asentamiento corto para conservar la orientación es una decisión de diseño, no un resultado de un estudio con usuarios. Las pruebas unitarias descritas al final verifican contratos de ejecución; por sí solas no demuestran apariencia, rendimiento de GPU, compatibilidad completa ni conformidad normativa.

## 2. Mapa semántico

| Intención → acción | Cambio real de estado | Respuesta perceptible → estado estable → siguiente acción |
|---|---|---|
| Ajustar o entender → abrir Ajustes/Guía | Se selecciona un diálogo; el fondo queda inerte | El mismo panel entra desde su borde derecho; el primer control recibe foco → panel completo → editar o cerrar |
| Volver al hangar → cerrar, Escape o fondo | Se cierra el diálogo y se restaura el contexto | Desaparición inmediata y foco de regreso → escena utilizable → continuar explorando |
| Cambiar la forma de explorar → Ventana/Órbita/Recorrido | Cambia el modo real y sus controles | Selección accesible inmediata, pictograma y texto se asientan → modo confirmado → explorar con la entrada indicada |
| Cambiar la atmósfera → Estudio/Cine/Alerta | Cambian los parámetros reales del rig de iluminación | Preset seleccionado y luz convergen al destino → nueva iluminación → inspeccionar o elegir otro preset |
| Usar el rostro → activar cámara, buscar, calibrar, detener o recuperar un error | Cambia el estado auténtico del seguimiento | Panel de cámara y texto describen el estado actual → cámara lista/apagada/error legible → calibrar, reintentar o continuar sin cámara |
| Empezar a explorar → cerrar bienvenida | Se descarta la invitación; puede persistirse la elección | Desaparición inmediata → controles del hangar disponibles → explorar |
| Entender una confirmación → centrar o cambiar una opción | La operación ya se ejecutó | Un único aviso aparece sin mover su anclaje → mensaje legible → seguir usando la aplicación |
| Observar el trabajo → escena activa | Avanza el reloj de simulación compartido | Coordinador señala; ingeniero revisa su tableta; técnico inspecciona → poses reconocibles con pies apoyados → observar, orbitar o pausar |
| Iniciar activación → activar EVA | Avanza la secuencia simulada existente y su estado de preparación | Etapas y progreso corresponden al tiempo real de simulación; los operarios responden → EVA activado → seguir explorando |
| Detener o reducir movimiento → Pausa/preferencia del sistema | Se congela la simulación o se aplica la política reducida | Poses estables y textos completos; se eliminan transiciones UI pendientes → interfaz usable → cambiar vista, editar o reanudar explícitamente |

### Separación del estado e invariantes

- **Dominio:** preferencias, disponibilidad de cámara, modo seleccionado y estado de la activación simulada. Una animación UI no confirma una operación de cámara ni representa progreso de trabajo que no haya ocurrido.
- **Interfaz:** `hidden`, `inert`, foco, selección, `aria-expanded`, `aria-pressed` y texto disponible. Se actualizan en la misma llamada que procesa la intención.
- **Presentación:** opacidad, desplazamiento corto de entrada, pose visual y asentamiento del rig. Cancelar presentación conserva el último estado funcional válido.
- No hay clones interactivos, dos textos simultáneos, controles invisibles esperando su turno ni callbacks antiguos que escriban sobre una intención nueva.
- Los pies de cada operario permanecen anclados; la identidad del personaje no cambia entre tareas. La UI conserva sus objetivos de interacción, el orden de lectura y las referencias de la cabecera/controles durante una entrada local.

## 3. Matriz de las 16 técnicas

“Adaptar” identifica una versión limitada o un mecanismo ya perteneciente a la escena. Una técnica omitida no se simula con un mecanismo distinto para completar la lista.

| Técnica | Decisión | Ubicación real | Necesidad semántica | Beneficio esperado | Riesgo principal | Alternativa reducida | Verificación prevista |
|---|---|---|---|---|---|---|---|
| Morph | Omitir | No corresponde a controles/vistas actuales | No hay un objeto UI que deba cambiar de forma o función | Mantener la identidad mediante el componente existente | Estirar texto o convertir botones en diálogos artificiales | Actualización directa | Confirmar que ningún control cambia de rol para producir un efecto |
| Stagger | Omitir | Sin listas nuevas que requieran revelado secuencial | Controles y pasos de cámara deben estar disponibles juntos | Evitar espera en acciones frecuentes | Controles invisibles que ya reciben foco | Contenido completo inmediatamente | Cámara y diálogos utilizables con teclado desde la apertura |
| Spring | Omitir | No corresponde a la UI; los operarios usan interpolación acotada | No hay gesto de arrastre y liberación que requiera masa/rebote | Evitar vibración y sobrepaso | Llamar “resorte” a un easing exponencial o inventar valores intermedios | Pose/estado final estático | Preparación sin sobrepaso; ninguna simulación física de resorte declarada |
| Easing | Aplicar | Entrada de paneles, iconos, controles y asentamiento de preparación/luces | Distinguir respuesta inmediata de asentamiento | Causalidad clara sin retrasar la acción | Finales demasiado lentos o progreso falseado | Duración cero; objetivos resueltos directamente | Interrupción rápida, política reducida y progreso exacto de activación |
| Crossfade | Adaptar | Estado del modo, cámara, avisos y etiquetas que cambian | Sustituir información en el mismo contexto | Leer un solo estado actual | Doble lectura o contraste insuficiente | Texto final inmediato con opacidad normal | Un único nodo; texto disponible antes de terminar; inspección de contraste intermedio |
| Shared element | Omitir | No hay navegación entre dos representaciones de la misma entidad | El diorama conserva ya su escena e identidad | Evitar clones y coordinación innecesaria | Duplicación accesible y origen ausente | Cambio directo de vista | Identidad de la escena y selección correcta al alternar vistas |
| Magnification | Adaptar | Pictogramas dentro de botones existentes | Reconocer foco/puntero/confirmación sin mover el objetivo | Feedback local con área activa estable | Temblor por medir una geometría ya escalada | Pictograma estático y foco visible | Puntero fino, teclado, tacto y botón de 44 px sin cambios de caja |
| Blur | Omitir | Fondo de diálogos | El fondo sólido existente ya separa diálogo y escena | Claridad y coste acotado | Desenfocar información/foco o ampliar superficie de pintura | Fondo sólido | Fondo inerte, foco legible y ausencia de filtros UI dinámicos |
| Mask | Omitir | No corresponde | Los paneles no requieren un revelado por forma o alfa | Mantener todo el contenido legible | Contenido oculto si falla una máscara | Contenido completo | Sin recursos de máscara ni dependencia de fondos claros/oscuros |
| Variable font | Omitir | Tipografía de sistema existente | No hay fuente variable autorizada con ejes verificados | Evitar descargas y cambios de métricas | Fingir variación con pesos estáticos o `scaleX` | Tipografía estática | Sin fuentes nuevas ni `font-variation-settings` sin recurso comprobado |
| Layout animation | Omitir | Ajustes, pasos de cámara y diseño adaptable | La navegación no reordena colecciones identificables | Layout final directo, sin deformar texto | Medidas obsoletas, saltos y espacios fantasma | Layout estable inmediato | Contenido largo, cambio de tamaño y orientación durante entradas |
| Clip path | Omitir | No corresponde | El borde del panel y su entrada corta explican la apertura | Foco y controles siempre completos | Recorte de contenido o hit testing confuso | Contenido completo | Sin recorte temporal de foco o controles |
| Path morph | Omitir | No corresponde; articulación esquelética no es interpolación de paths | No hay geometrías SVG relacionadas que cambien de significado | Preservar exactitud y simplificar | Interpolar paths incompatibles | Iconos y geometrías estables | Sin paths interpolados arbitrariamente ni datos inventados |
| Stroke draw | Omitir | Progreso de activación y pasos de cámara | El progreso representa tiempo de simulación; no una trayectoria dibujada | No sugerir una causalidad espacial inexistente | Confundir conexión decorativa con proceso real | Progreso/etiqueta completa y exacta | Escala de progreso corresponde a tiempo; la reducción resuelve la simulación |
| Perspective | Adaptar | Ventana 3D, órbita y escena existentes | Mostrar profundidad/paralaje reales del hangar | Orientación y escala espacial | Movimiento vestibular o área interactiva desalineada | Vista estable con navegación explícita; sin movimiento de cámara ornamental | Entradas existentes, pausa, cambio de vista y política reducida |
| Particles | Adaptar | Hasta 66 motas de polvo existentes del hangar | Dar una referencia expresiva de escala y volumen al diorama | Profundidad discreta durante observación | Fondo que consume recursos sin reposo | Polvo oculto mientras el sistema solicite reducción, también al pulsar Continuar | Un `Points`, cantidad acotada, sin emisor/RAF propios; estático en pausa y oculto en reducción |

La adaptación de crossfade usa un único nodo: el texto cambia inmediatamente y su opacidad se asienta desde un mínimo legible. No se superponen dos cadenas. La articulación de personajes se describe como animación esquelética y su preparación como easing; no se presenta como morph de interfaz, path morph ni resorte físico.

## 4. Gramática y tokens

Los tokens CSS de `src/motion.css` son la fuente de configuración en ejecución. `src/motion.js` contiene valores de respaldo centralizados para degradación sin la hoja de estilos. No se usa `transition: all`, `will-change` permanente, animación de tamaño de texto ni medición geométrica por fotograma.

| Intención/token | Valor normal | Función |
|---|---|---|
| `--motion-acknowledge-duration` | 120 ms | Confirmación del pictograma |
| `--motion-control-duration` | 180 ms | Color de control/estado de interruptor |
| `--motion-status-duration` | 160 ms | Sustitución local de texto/aviso |
| `--motion-nearby-duration` | 220 ms | Aparición de cámara/bienvenida/cargador |
| `--motion-context-duration` | 260 ms | Entrada del diálogo existente |
| `--motion-near-distance` | 8 px | Desplazamiento vertical de panel local |
| `--motion-context-distance` | 18 px | Desplazamiento desde el borde derecho |
| `--motion-legibility-opacity` | 0,74 | Fracción inicial de la opacidad normal del contenido |
| `--motion-emphasis-opacity` | 0,70 | Fracción inicial para confirmar un icono |
| `--motion-focus-scale` / `--motion-press-scale` | 1,07 / 0,97 | Pictograma; no el botón ni el foco |
| `--motion-settle` | `cubic-bezier(.2,.8,.2,1)` | Llegada breve sin sobrepaso |
| Política reducida | 0 ms, escala 1 | Estado final completo, sin desplazamiento |

Los paneles entran a opacidad parcial, no desde invisibilidad; sus controles quedan perceptibles y disponibles inmediatamente. La UI no escala texto, mueve toda la aplicación ni introduce una ceremonia al volver a abrir el mismo estado. El progreso de carga se actualiza directamente y la barra de activación usa el tiempo real de la simulación, sin easing de sus valores.

## 5. Contratos de transición

### A. Abrir, reemplazar y cerrar un diálogo

- **Identidad y propósito:** `settingsPanel` o `helpPanel` sigue siendo el mismo diálogo; su entrada confirma qué contexto se abrió.
- **Condiciones:** una intención válida del botón, Escape, botón de cierre o fondo. Sólo un diálogo pertenece a `activePanel`.
- **Resultado:** apertura con `hidden=false`, contenido operable, selección accesible y foco dentro; cierre con `hidden=true`, `inert=true` y foco restaurado por `main.js`.
- **Geometría:** anclaje derecho existente, 18 px horizontales hacia el reposo; opacidad inicial 0,74 de la normal. Se conserva el layout final y cualquier transform base.
- **Tiempo:** apertura 260 ms, curva de asentamiento; cierre 0 ms. La funcionalidad no espera esos 260 ms.
- **Interrupción:** repetir apertura visible no reinicia; cerrar cancela la entrada; reabrir crea una sola nueva transición. Cerrar no genera un clon de salida.
- **Interacción:** el controlador de aplicación gestiona modalidad, `aria-expanded`, foco y fondo. La capa de movimiento sólo aporta presentación/visibilidad.
- **Adaptación:** tacto y teclado usan las mismas acciones; reducción o ausencia de WAAPI presentan el estado final directamente.
- **Ciclo de vida:** un registro y una animación por elemento. Terminar/cancelar retira el efecto; una generación antigua no elimina la nueva.
- **Evidencia:** cancelación al principio/mitad/final, alternancia rápida, 20 ciclos y verificación real del regreso de foco.

### B. Panel de cámara, bienvenida y avisos

- **Identidad y propósito:** cada panel mantiene el contexto existente; la visibilidad sigue al estado real del seguimiento, a la invitación inicial o a una confirmación ya ocurrida.
- **Condiciones:** `updateCameraPanel`, primera entrada/bienvenida o una operación con aviso. Un error de cámara debe permanecer legible como error.
- **Resultado:** `hidden` se aplica inmediatamente. Una actualización que conserva el panel visible no reproduce su entrada. Dismissal inmediato, sin contenido interactivo oculto esperando un efecto.
- **Geometría:** cámara/bienvenida: 8 px verticales; aviso: sólo opacidad para conservar su `translateX(-50%)` y anclaje inferior.
- **Tiempo:** panel 220 ms; aviso 160 ms; cierre 0 ms. La duración de lectura del aviso pertenece a `main.js`, no al animador.
- **Interrupción:** una nueva intención reemplaza la anterior; detener cámara no espera una desaparición visual. Cambiar texto no oculta el error ni reinicia todo el panel.
- **Interacción:** `inert:true` al revelar contenido detrás de un diálogo activo; la aplicación conserva y restaura foco según la tarea de cámara/bienvenida.
- **Adaptación:** reducción/WAAPI ausente muestran todo inmediatamente; el diseño adaptable sigue siendo responsabilidad del layout existente.
- **Ciclo de vida:** no clones, observadores ni temporizadores añadidos. Cancelar sólo retira presentación; no detiene ni confirma una operación del tracker.
- **Evidencia:** permiso denegado, búsqueda/seguimiento/parada, nueva cámara bajo un modal, bienvenida en móvil y avisos largos.

### C. Texto de estado y confirmación del pictograma

- **Identidad y propósito:** un único nodo comunica el modo, la cámara o una etiqueta real; el pictograma confirma un botón ya accionado.
- **Condiciones:** el texto realmente cambia, o una acción válida se ejecuta. Una actualización sin cambio no produce movimiento.
- **Resultado:** `textContent` nuevo es síncrono. `aria-pressed`, operación real y nombre accesible no dependen de la animación. Feedback de botón se limita a su SVG.
- **Geometría:** sólo opacidad por WAAPI. CSS es el único propietario de la escala del SVG; el botón y el contorno de foco permanecen en su caja original.
- **Tiempo:** texto 160 ms, confirmación 120 ms. La reducción usa opacidad normal sin transición.
- **Interrupción:** una nueva etiqueta toma la opacidad visual actual y conserva el destino normal; no vuelve a oscurecerse desde el comienzo ni deja texto antiguo.
- **Interacción:** nunca hay dos cadenas superpuestas ni una copia accesible. Los anuncios relevantes se realizan una vez desde la aplicación, no por fotograma.
- **Adaptación:** foco visible tiene equivalente al hover; el tacto usa pulsación. Sin hover no se inventa proximidad del puntero.
- **Ciclo de vida:** una animación por nodo; `finished` cancelado se resuelve como resultado esperado; otros errores se registran y el texto sigue disponible.
- **Evidencia:** cambios rápidos, etiqueta sin cambios, error real de animación, botón de caja estable y contraste en el punto de mínima opacidad.

### D. Tres operarios y respuesta a la activación

- **Identidad y propósito:** `coordinator`, `engineer` y `technician` son los tres operarios originales, con tareas distintas: señal de autorización/vigilancia, lectura y toque en tableta, inspección y ajuste.
- **Condiciones:** escena activa y reloj de simulación compartido. La activación simulada proporciona un objetivo normalizado entre 0 y 1.
- **Resultado:** personajes reconocibles, pies apoyados y poses dentro del espacio de trabajo. Pausa congela la pose; el flag reducido recibido por el módulo presenta tareas estáticas y resuelve la preparación directamente.
- **Geometría:** esqueletos de 19 huesos; geometría de piel compartida; objetivos de tobillo fijos y orientación del pie compensada. Los accesorios siguen sus manos/tareas.
- **Tiempo:** ciclos de 12,8 s, 8,6 s y 11,6 s, respectivamente; preparación mediante easing exponencial con constantes de 1,05/1,21/1,37 s. Son parámetros de presentación, no resortes ni datos medidos de personas.
- **Interrupción:** invertir el objetivo de preparación mantiene continuidad; detener/reanudar usa el mismo reloj, sin avanzar una cantidad fija por frame ni reproducir una introducción completa.
- **Interacción:** la escena conserva los controles existentes de pausa y navegación. Los personajes no adquieren falsos hit targets ni se vuelven necesarios para completar una tarea.
- **Adaptación:** el flag reducido recibido detiene ciclos ambientales; pausa/potencia apagada congelan pose y preparación. La preferencia del sistema entra en una escena pausada/estática; el usuario puede autorizar explícitamente el movimiento de la escena mediante Continuar. En ese caso el controlador permite los ciclos de los operarios, mientras la UI sigue reducida y el polvo permanece oculto. La cámara explícita sigue permitiendo inspección.
- **Ciclo de vida:** `hangar.update(t, dt, state)` actualiza `crew`; no hay temporizadores ni RAF privados. La geometría/materiales compartidos se gestionan con la escena.
- **Evidencia:** pruebas del módulo de operarios para límites, pies, tiempos, pausa, reducción y continuidad; revisión visual temporal separada para legibilidad y oclusión.

### E. Activación simulada, polvo y reposo de la escena

- **Identidad y propósito:** la activación existente explica la puesta en marcha representada de EVA; el polvo es una referencia expresiva del volumen de la maqueta, sin codificar cantidades ni datos.
- **Condiciones:** activación por el botón real; polvo visible sólo fuera de Órbita (`inspect`) y cuando el sistema no solicite movimiento reducido. La escena visible y no pausada autoriza el avance del reloj.
- **Resultado:** la secuencia llega al estado de EVA activado. En reducción, ese resultado se aplica inmediatamente con anuncio textual y sin forzar una reanudación.
- **Geometría:** progreso `scaleX` entre 0 y 1. Polvo: buffer fijo de 66 puntos en un único `Points`, con rango de dibujo acotado por la calidad efectiva y colocación determinista dentro del hangar; no emisor adicional, atracción ni dispersión. No hay un nodo HTML por partícula.
- **Tiempo:** activación de 8 s de simulación en modo normal, progreso derivado del tiempo exacto; polvo de vida igual a la escena, oscilación existente muy pequeña y sin acumulación de partículas.
- **Interrupción:** pausa conserva el tiempo; reducción resuelve la activación y cancela presentación pendiente. No se vuelve a emitir cada mensaje de etapa en cada frame.
- **Interacción:** la simulación está identificada como tal; cámara/controles siguen disponibles. No hay falsa carga de red ni una celebración en cada confirmación.
- **Adaptación:** el polvo permanece oculto mientras el sistema solicite movimiento reducido, incluso al pulsar Continuar. Las entradas explícitas de cámara conservan su función; la reanudación autoriza movimiento de la escena y mantiene reducidas las transiciones UI. Inspección no requiere partículas.
- **Ciclo de vida:** los puntos pertenecen a la escena; la UI no crea bucles. Una escena pausada y asentada puede dibujarse bajo demanda; ocultar la pestaña cancela transiciones UI activas.
- **Evidencia:** progresión exacta, cambio de política durante activación, reposo del render, inventario acotado y ausencia de RAF privados.

## 6. API e integración

```js
import { createMotion } from './motion.js';
const motion = createMotion({ reducedMotion });

// Sustituye la escritura de hidden; foco y modalidad permanecen en main.js.
void motion.reveal(panel, { kind: 'drawer', show: true });
void motion.reveal(cameraPanel, { kind: 'panel', show, inert: Boolean(activePanel) });
void motion.reveal(toast, { kind: 'status', show: true });
void motion.text(modeStatus, label);
void motion.feedback(button); // Selecciona únicamente el SVG de ese botón.

// La misma preferencia debe gobernar CSS y JavaScript.
document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
motion.setReduced(reducedMotion);
// Al ocultar documento: motion.cancelAll('hidden-document').
// Al desmontar la aplicación: motion.dispose().
```

`reveal` acepta `drawer`, `panel` o `status`; una llamada `show:false` cancela la animación y establece `hidden/inert` inmediatamente. Una apertura inicialmente oculta elimina su inertness local salvo que el llamador indique `inert:true`. Repetir `show:true` no modifica una modalidad impuesta por otro controlador ni vuelve a animar. No se debe escribir `hidden=false` antes de llamar a `reveal`, porque esa escritura ya significa que el estado visible está establecido.

Los métodos devuelven promesas con `{status, reason}`. La cancelación esperada no produce un rechazo sin manejar; un error real se notifica mediante `onError` o consola, se contabiliza y deja el estado final utilizable. `cancelAll` conserva el estado funcional de todos los elementos. `dispose` cancela y hace inertes las futuras llamadas a este propietario, sin reutilizarlo para un nuevo montaje.

`getStats()` devuelve `created`, `completed`, `cancelled`, `failed`, `active`, `reduced` y `disposed`. Son contadores de transiciones UI, no estadísticas de FPS o memoria de GPU. Sólo hay una referencia fuerte por transición activa; la finalización elimina ese registro y cancela el efecto WAAPI sin `commitStyles`, de modo que no quedan transformaciones inline residuales.

## 7. Comprobaciones y límites

### Prueba ejecutada del propietario de movimiento

```sh
node --test tests/motion.test.mjs
```

Resultado observado al implementar la capa: **12 pruebas aprobadas, 0 fallos**. Usan promesas WAAPI controlables, sin pausas de tiempo arbitrarias. Cubren estado síncrono, aperturas idempotentes, cierre/reapertura al principio/mitad/final del reloj, texto más reciente, reducción antes/durante la entrada, 20 ciclos con finalización/cancelación alternadas, limpieza de todos los efectos y desmontaje, falta de WAAPI, elementos desconectados, documento oculto, cancelación externa esperada, sustitución de la promesa `finished` durante limpieza, errores reales, transforms preexistentes, SVG dentro de botón e inertness bajo modalidad.

La prueba de los tres puntos temporales controla el reloj del doble de WAAPI; demuestra la política del propietario, **no** interpolación visual real a esos instantes. La prueba de 20 ciclos verifica registros/efectos del propietario, **no** una medición de memoria del navegador.

### Revisión de la aplicación completa

La auditoría de navegador debe comprobar el archivo final reconstruido, con su entorno y hash. En particular: foco y Escape de diálogos, permiso de cámara denegado, reducción durante una entrada y una activación, móvil/tacto/teclado, cambios de tamaño, contraste durante asentamiento, postura/oclusión de los tres operarios, reposo con la escena pausada y comportamiento sin soporte de efectos. Registrar inicio, punto intermedio y final; una captura final no demuestra continuidad.

Se tomó una referencia anterior de la aplicación en Chromium 134 con SwiftShader, offline, a 1440 × 960; el informe de rendimiento de la entrega compara únicamente condiciones identificadas. El sistema de movimiento UI añade cero dependencias, cero temporizadores, cero observadores y cero RAF privados. Su coste consiste en lecturas acotadas de estilo al comenzar eventos y efectos de opacidad/transformación. No se afirma una mejora porcentual de FPS, memoria o rendimiento de GPU a partir de las pruebas unitarias o de muestras escasas de renderizado software.

### Archivos y reproducción

- `src/motion.js`: propietario de transiciones, política reducida y contadores.
- `src/motion.css`: tokens, equivalentes de foco/tacto y estilos reducidos.
- `tests/motion.test.mjs`: regresiones de contratos/ciclo de vida.
- `docs/motion-design.md`: mapa, matriz de 16 técnicas, contratos y límites de evidencia.
- Integración en `src/main.js`, incorporación CSS en `scripts/build.mjs` y resultado autocontenido en `index.html`: controlador/build de la aplicación.
- `src/crew.js` y la integración en `src/hangar.js`: articulación y tareas de los tres operarios.

Ejecutar `npm test` para las pruebas disponibles y `npm run build` para regenerar `index.html`. La evidencia del navegador final se entrega por separado de estos resultados unitarios; no debe describirse como aprobada antes de ejecutarla.
