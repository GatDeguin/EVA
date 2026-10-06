# EVA · verificación de la entrega

Fecha de ejecución: **5 de octubre de 2026, UTC**. Este registro distingue pruebas del producto, pruebas de coordinación con fallos inyectados, observaciones visuales y límites no verificados. El código y las decisiones se explican en [implementation-plan.md](implementation-plan.md), [motion-design.md](motion-design.md), [graphics-decisions.md](graphics-decisions.md), [crew-animation.md](crew-animation.md) y [surface-design.md](surface-design.md).

## Estado del cierre

**52/52 pruebas unitarias, 12/12 casos de integración del HTML final y 2/2 casos de coordinación de ciclo de vida aprobados**, con una confirmación focalizada adicional de **5/5 perfiles, 30/30 comprobaciones**. Las sesiones de navegador terminaron y quedaron cerradas. El render WebGL2, su postprocesado y el respaldo tras un fallo real de inicialización WebGPU se comprobaron en navegador. La ejecución de shaders WebGPU nativos sigue **sin verificar** en el Chromium/SwiftShader disponible. Los casos de coordinación que simulan una etiqueta o una pérdida WebGPU no cambian esa conclusión.

No se presenta una mejora porcentual de velocidad, un objetivo de FPS alcanzado ni una equivalencia con imágenes fotográficas/AAA. Los intervalos obtenidos con rasterización por software y pocas muestras sirven para documentar este entorno de prueba, no para pronosticar una GPU física.

## Archivo, dependencias y reproducción

| Elemento | Resultado |
|---|---|
| HTML del baseline | 1.246.745 bytes; SHA-256 `7abea341d1d1ea3e931678288cfd808685661c51d22ed251ce4e47aeeaa438a0` |
| HTML final | **2.049.453 bytes**; SHA-256 `37d4e39e6217de6e5c03011c1abe287e8a9b3c4298d574a85300889022bf94df` |
| Crecimiento de archivo | 802.708 bytes; **+64,3843 %**. Es variación de payload, no de memoria o tiempo de carga. |
| Reconstrucción | La compilación en memoria a partir de los fuentes coincide byte por byte con el HTML final. |
| Instalación limpia | `npm ci --offline --ignore-scripts` completado con la caché disponible y el lockfile fijado. |
| Dependencias | Three.js **0.186.1** en ejecución; esbuild **0.28.2** y Playwright **1.51.1** para desarrollo. |
| Revisión independiente | Revisión del diff y correcciones completadas; apta dentro del alcance y las limitaciones aquí descritas. |

El baseline y los informes de integración identifican su propio input. Los smoke tests aislados prueban módulos/escenas de diagnóstico, no todo el HTML final. El caso de ciclo de vida utiliza un bundle temporal instrumentado de **2.051.619 bytes**, SHA-256 `74e2c47e6edfc7d33541ce7a605dad49103536bb192fc4702e355e714680c135`; no es el archivo entregable ni una compilación WebGPU nativa.

Para reproducir desde los fuentes:

```sh
npm ci
npm test
npm run build
EVA_SOFTWARE_RENDERER=1 EVA_BROWSER_EXECUTABLE=/ruta/a/chromium npm run test:browser
EVA_SOFTWARE_RENDERER=1 EVA_BROWSER_EXECUTABLE=/ruta/a/chromium npm run test:lifecycle
```

`npm ci` requiere acceso a los paquetes o una caché preparada; esa necesidad de desarrollo no se traslada al HTML ya compilado. Las pruebas de navegador admiten un ejecutable compatible mediante la variable mostrada. La ejecución informada usó Chromium **134.0.6998.35**, Playwright 1.51.1, origen de archivo local, contexto offline y bloqueo/registro adicional de HTTP(S).

## Capas de evidencia

| Capa | Resultado y qué demuestra | Evidencia |
|---|---|---|
| Contratos Node | **52/52**: 9 de operarios, 12 de movimiento, 6 de calidad, 19 del renderer y 6 de superficies/iluminación. Datos, límites y ciclo de vida; no apariencia ni velocidad de GPU. | [node-tests.txt](evidence/node-tests.txt) |
| Integración del HTML final | **12/12**, 0 errores de página/consola y 0 solicitudes remotas; input congelado para la corrida y hash del producto sin cambios al finalizar. | [browser-results.json](evidence/browser-results.json) |
| Confirmación de perfiles tras el cambio | **5/5 perfiles, 30/30 comprobaciones** en una ejecución focalizada sobre el mismo HTML; sustituye estadísticas que podían pertenecer al frame anterior. | [browser-results.json](evidence/browser-results.json), `targetedVerifications[0]` |
| WebGL2 aislado | Render real HDR con bloom/MSAA, GTAO, FXAA y retorno de calidad. El caso WebGL2 registra 0 errores y 0 solicitudes remotas. | [render-smoke-results.json](evidence/render-smoke-results.json) |
| Inicialización WebGPU aislada | Se obtuvo adaptador, falló el dispositivo y se reemplazó el canvas; el renderer WebGL2 de respaldo produjo imagen. El intento nativo registra errores, que se conservan. | [render-smoke-results.json](evidence/render-smoke-results.json) |
| Grafo TSL sobre WebGL2 | Render real de HDR, bloom, GTAO de profundidad, denoise y FXAA mediante el backend compatible de Three; 0 errores y 0 solicitudes remotas. No es validación WGSL/WebGPU. | [node-smoke-results.json](evidence/node-smoke-results.json) |
| Coordinación de ciclo de vida | **2/2** con escena WebGL2 real, fallo de warmup y callback de pérdida inyectados sólo en un bundle temporal. Cámara sintética y AudioContext reales. | [lifecycle-results.json](evidence/lifecycle-results.json) |
| Visibilidad/actuación de operarios | Tres puestos visibles y poses de trabajo a 0, 3 y 6 segundos; se documentan apoyo, contacto y diferencias de rol. | [crew-animation.md](crew-animation.md), [visibilidad](evidence/crew/visibility-pixels.json) y capturas enlazadas abajo |

Los tests de movimiento usan dobles controlables de WAAPI para probar cancelación al principio, mitad y final. La integración complementa esos contratos con animaciones y foco reales en navegador. Los tests de tiempos GPU usan consultas simuladas para cubrir resultados tardíos, inválidos, caducados, disjoint y disposal; los smoke tests prueban también la lectura real disponible en SwiftShader. Ninguna de estas pruebas convierte una estimación en VRAM o frecuencia física medida.

## Integración general del producto

La corrida final fue del **03:34:58 al 03:38:40 UTC** y terminó **12/12, 0 fallos**, con `browserClosed=true` y `sourceStillMatches=true`. Desktop y viewport compacto registran **0 errores de página/consola y 0 solicitudes HTTP(S)**. Conservan dos advertencias del entorno: creación de proveedor WebGPU no disponible y extensión `KHR_parallel_shader_compile` ausente.

| Caso final | Resultado comprobado |
|---|---|
| Arranque | HTML listo y dibujado offline, bienvenida visible, sin pedir cámara ni crear audio automáticamente. |
| Operarios | Tres SkinnedMesh de 19 huesos; los tres cambian articulaciones durante frames reales, conservan transformaciones finitas y aportan píxeles visibles. |
| Pausa y demanda | Reloj y poses se congelan; tras asentarse no hay frames adicionales. El teclado permite paralaje sin avanzar simulación y Reanudar vuelve a avanzar. |
| 20 ciclos de paneles | Apertura/cierre, modalidad, regreso de foco, Tab dentro del diálogo y reapertura rápida correctos; sin animaciones activas/fallidas ni aumento de geometrías/texturas por esos ciclos. |
| Reducción durante entrada | Se interrumpe una animación real de entrada; el diálogo conserva su estado final operable y foco. El polvo permanece oculto al volver de inspección. |
| Cámara y modalidad | Rechazo controlado de permiso con recuperación manual; un preview sintético permanece inerte detrás de Ajustes y vuelve a ser operable al cerrarlo. |
| Luces y cámaras | Cine, Estudio y Alerta alcanzan luces distintas y estados coherentes; teclado mueve órbita, Recorrido toma la cámara y entrada manual recupera Ventana. |
| Cinco perfiles | Rendimiento, Equilibrada, Calidad, Ultra y Cinemática aplican los efectos/presupuestos esperados y respetan límites de buffer/DPR. El anexo confirma además un frame completado posterior a cada cambio. |
| PNG normal | Descarga de un PNG real de la escena, con firma y dimensiones verificadas. |
| Captura con cambios concurrentes | Mientras se demora la codificación se cambia calidad/tamaño; termina con PNG válido y la elección actual, sin restaurar DPR o dimensiones antiguos. |
| Reducción antes del inicio | Viewport táctil 390 × 844: estado reducido y reposo desde el inicio, ajustes/foco accesibles y sin desborde horizontal. |
| Recuperación fatal | Fallo inyectado durante recuperación de captura: audio real suspendido, tracker sintético detenido, sin RAF ni movimiento UI pendiente, diálogo de error y foco operables con H/Tab/Shift+Tab. |

La primera pasada alcanzó 11/12 por un fixture que comunicaba estado de cámara mediante `tracker.onState` sin actualizar el estado interno del tracker. Se corrigió para usar `_setState`; la tabla anterior y todas las métricas finales pertenecen a la repetición aprobada sobre **el mismo hash de producto**. El fallo previo del fixture no se cuenta como resultado final.

La respuesta de activación de los operarios está cubierta por las pruebas Node; esta batería de 12 casos no contiene una prueba dedicada de la secuencia completa de ocho segundos iniciada desde el botón de la aplicación. Esa parte no se presenta como verificada en navegador.

### Anexo: confirmación del frame de cada perfil

La revisión del test detectó una carrera: el marcador de frame se tomaba antes del evento `change`, por lo que un dibujo anterior podía contarse como respuesta del perfil nuevo. El anexo **`targetedVerifications[0]`** de [browser-results.json](evidence/browser-results.json) registra el contador dentro de un listener posterior al de la aplicación y espera un frame completado estrictamente posterior. Terminó **5/5 perfiles y 30/30 comprobaciones**, 0 errores, 0 solicitudes remotas y navegador cerrado, sobre el mismo SHA-256 del producto.

| Perfil | Frame al confirmar cambio | Frame observado | AA real | Bloom / AO | Draw calls del frame observado |
|---|---:|---:|---|---|---:|
| Rendimiento | 27 | 29 | FXAA | No / No | 160 |
| Equilibrada | 29 | 31 | MSAA 4× | Sí / No | 172 |
| Calidad | 31 | 33 | MSAA 4× | Sí / Sí | 329 |
| Ultra | 34 | 35 | MSAA 4× | Sí / Sí | 329 |
| Cinemática / Foto | 35 | 36 | MSAA 4× | Sí / Sí | 329 |

Son **cinco observaciones, una por perfil**, de una escena pausada en WebGL2/SwiftShader, viewport 640 × 520, buffer 483 × 270 y DPR 0,78. Los draws incluyen los pases correspondientes; no miden throughput ni velocidad y no son cinco benchmarks. La sombra, el AA y el postprocesado siguen teniendo coste aunque el DPR coincida por el límite del renderer por software.

El anexo sustituye **sólo las estadísticas por perfil que dependen del frame** de `cases[id=quality-profiles].evidence.profiles`; en particular, la observación antigua de Equilibrada retenía 160 draws del perfil anterior. El informe conserva esos datos anteriores, el hash del runner corregido y el código exacto del harness focalizado. Se repitieron únicamente las cinco transiciones: no se afirma una nueva ejecución completa de los 12 casos con el runner corregido y no se sustituyen las métricas de tiempo, capturas o revisiones de la corrida general.

### Capturas exportadas realmente

| Captura final | Dimensiones | Bytes | Observación |
|---|---:|---:|---|
| [Cinemática / Foto](evidence/browser/capture-cinematic.png) | 1240 × 694 | 706.298 | Partió de un buffer de vista de 483 × 270; volvió a su DPR y permaneció pausada. Sobremuestreo espacial, un fotograma. |
| [Captura normal](evidence/browser/capture-native.png) | 1092 × 620 | 561.218 | PNG de escena sin interfaz, a la resolución de trabajo del caso. |
| [Captura con cambio concurrente](evidence/browser/capture-delayed-race.png) | 1139 × 702 | 677.205 | Codificación demorada mediante fixture; el estado vigente se conserva al completar. |

### Pruebas con entrada o fallos controlados

El rechazo de cámara se inyecta en `getUserMedia`: comprueba mensaje y recuperación, no un diálogo de permiso físico. La presentación de cámara bajo Ajustes usa un estado sintético explícito, sin atribuirle detección de rostro. La carrera de captura demora la codificación para cambiar calidad/tamaño mientras está pendiente. El caso fatal inyecta un fallo de recuperación del renderer; comprueba accesibilidad y coordinación, no pérdida física de GPU. Estas condiciones se registran junto a los casos correspondientes.

El viewport compacto prueba un layout de **390 × 844** con entrada táctil y movimiento reducido. Sigue ejecutándose en el mismo navegador de escritorio y renderer por software; no constituye una prueba en hardware móvil ni una certificación de accesibilidad/lector de pantalla.

## Ciclo de vida: dos casos completados

El [informe de ciclo de vida](evidence/lifecycle-results.json) terminó con **2/2 aprobados**, navegador cerrado, **0 errores de página/consola y 0 solicitudes remotas**. Duración total observada: aproximadamente **51,7 s**, incluyendo carga e interacción; no es un benchmark. Cada caso conserva la advertencia de `KHR_parallel_shader_compile` no disponible.

La escena, PMREM, materiales, warmup y dibujo se ejecutan realmente en WebGL2. Sólo el bundle temporal anuncia `runtime.backend='webgpu'`, manteniendo `capabilities.backend='webgl2'`, para activar las ramas de coordinación del controlador. El primer caso rechaza deliberadamente después de un warmup real exitoso. El segundo invoca el callback real `renderer.onDeviceLost` con información identificada como fixture. **No se ejecuta GPU/WGSL nativo en estos casos.**

| Caso | Resultado observado |
|---|---|
| Fallo tardío de warmup | Dos runtimes, un rechazo controlado, pipeline anterior dispuesto y canvas anterior desconectado. La reconstrucción conserva Cinemática pausada; seleccionar Equilibrada permite reanudar reloj y dibujo. |
| Pérdida durante uso | Antes del evento hay vídeo de `Canvas.captureStream`, track activo y AudioContext iniciado mediante el botón. Después: track `ended`, una llamada efectiva a `stop`, vídeo desacoplado, audio `suspended`, `ready=false` y ningún RAF pendiente. |
| Reposo posterior al fallo | Al comparar el estado inmediato y el asentado, los frames permanecen en **21** y las llamadas instrumentadas de render en **23** durante la ventana de observación de 700 ms. Es una comprobación de detención, no una tasa de render. |
| Acceso al error | Ajustes se cierra; `alertdialog` queda fuera del árbol inerte, fondo inerte y foco en Recargar. H, Tab y Shift+Tab mantienen el foco operativo del error. |

El vídeo es un **MediaStream sintético local real**, no una webcam física. Se prueban reproducción y parada de tracks/vídeo; no precisión facial. AudioContext es real y se suspende realmente, pero no se evalúa el sonido percibido en altavoces.

## Métricas: muestras y límites

### Baseline

[baseline-results.json](evidence/baseline-results.json) usa viewport **1440 × 960**, escenario de **1400 × 795**, DPR **0,78**, buffer **1092 × 620**, WebGL2/ANGLE/SwiftShader. Cada muestreo se detiene tras 60 intervalos o una ventana nominal de ocho segundos. Ambos terminaron por tiempo con muy pocas muestras.

| Escenario anterior | Frames observados | Intervalos útiles | Intervalo medio | p50 | p95 | p99 / peor |
|---|---:|---:|---:|---:|---:|---:|
| Cine, calidad automática | 5 | 4 | 1.537,4 ms | 616,5 ms | 4.766,6 ms | 4.766,6 ms |
| Estudio, calidad automática | 8 | 7 | 1.038,1 ms | 616,6 ms | 3.749,8 ms | 3.749,8 ms |

| Método anterior instrumentado | Invocaciones | Duración media síncrona | p50 | p95 | p99 / peor |
|---|---:|---:|---:|---:|---:|
| `renderer.render()`, Cine | 5 | 3,04 ms | 2,10 ms | 7,40 ms | 7,40 ms |
| `renderer.render()`, Estudio | 8 | 2,14 ms | 1,60 ms | 4,90 ms | 4,90 ms |

Estas duraciones de método no son tiempo GPU ni CPU aislado. La GPU no se midió en ese baseline. p95/p99 con cuatro o siete intervalos coinciden con extremos y no caracterizan una distribución estable.

### Entrega final

Las cifras de [browser-results.json](evidence/browser-results.json) corresponden a la corrida aprobada del HTML final, en el mismo viewport desktop nominal. La selección automática usa Rendimiento por software; la adaptación reduce el DPR durante la ejecución. La ventana Cine duró **8.000,9 ms** y la de Estudio **8.037,8 ms**. No se calcula un porcentaje de aceleración: resolución, pases, carga del navegador y número de muestras no están fijados como un benchmark comparativo.

| Escenario final | Frames observados | Intervalos útiles | DPR al terminar | Intervalo medio | p50 | p95 | p99 / peor |
|---|---:|---:|---:|---:|---:|---:|---:|
| Cine, automática → Rendimiento | 13 | 12 | 0,7176 | 581,9 ms | 483,4 ms | 3.033,3 ms | 3.033,3 ms |
| Estudio, automática → Rendimiento | 25 | 24 | 0,6552 | 248,6 ms | 83,4 ms | 533,3 ms | 533,3 ms |

| Método final instrumentado | Invocaciones | Duración media síncrona | p50 | p95 | p99 / peor |
|---|---:|---:|---:|---:|---:|
| `renderer.render()`, Cine | 39 | 0,73 ms | 0,10 ms | 2,40 ms | 5,00 ms |
| `renderer.render()`, Estudio | 75 | 0,63 ms | 0,10 ms | 2,20 ms | 2,50 ms |

Las **39/75 invocaciones incluyen tres llamadas de pase por cada uno de los 13/25 frames** observados. El baseline instrumentó una llamada por frame. Por eso estas duraciones de método no deben restarse o dividirse para anunciar una mejora de coste por frame; tampoco incluyen la ejecución asíncrona completa del dispositivo. Valores cercanos a cero reflejan la resolución del reloj y trabajo de envío breve, no un render gratuito.

El diagnóstico de aplicación separa intervalo entre RAF, trabajo síncrono de la función de frame y resultados GPU válidos. Los siguientes snapshots de sus anillos **incluyen frames anteriores a la ventana**, por lo que difieren de los percentiles de las tablas anteriores:

| Snapshot de diagnóstico final | Entradas de frame del anillo | Trabajo JS p95 / p99 | Resultado GPU conservado p95 / p99 |
|---|---:|---:|---:|
| Al terminar Cine | 36 | 6,8 / 9,1 ms | 578,7 / 578,7 ms |
| Al terminar Estudio | 208 | 5,1 / 7,1 ms | 554,5 / 578,7 ms |

La cantidad de entradas cuenta **frames**, no consultas GPU independientes. Un resultado GPU leído de forma asíncrona puede conservarse durante varios frames; ese recuento independiente no se expone en el snapshot. Los percentiles GPU describen los últimos resultados válidos guardados, bajo SwiftShader; no constituyen una distribución de 36/208 mediciones de GPU física. Los valores de los smoke tests son también observaciones aisladas del renderer por software, no comparaciones válidas de coste entre efectos.

### Recursos cuyo alcance sí está delimitado

| Recurso final | Cantidad | Alcance |
|---|---:|---|
| Operarios / esqueletos | 3 / 3 | Una geometría corporal compartida; 19 huesos por esqueleto. |
| Geometrías de operarios y accesorios | 4 | Recursos compartidos, sin nuevas mallas/geometrías durante los ciclos. |
| Draw calls de operarios | 14 | Excluye pases de sombras. |
| Triángulos de operarios | 13.484 | Incluye cuerpos y accesorios de los tres puestos. |
| Materiales afectados por acabados | 16 sobre 32 mallas | No cambia la silueta ni añade draws. |
| Texturas nuevas de acabado | 10 | Mapas compartidos; 512², 256² y rampas de 64². |
| Texels RGBA8 de acabado con mipmaps | 4.937.032 bytes / 4,71 MiB | Cálculo de almacenamiento de texels; no VRAM total. |
| Atributos UV/color añadidos | 7.739.256 bytes / 7,38 MiB | Arrays del detalle de superficie; no incluye buffers del renderer. |
| Draw calls añadidos por acabado | 0 | La mejora reside en materiales y atributos. |

Los valores provienen del estado instrumentado, [crew-animation.md](crew-animation.md) y [surface-design.md](surface-design.md). Excluyen copias de canvas/CPU, datos transitorios de generación, PMREM, render targets, mapas de sombra y cachés del driver. Ni `navigator.deviceMemory` ni el número de objetos de textura miden VRAM libre.

## Evidencia visual y límite de antialiasing

| Evidencia | Qué permite observar |
|---|---|
| [Cine, cámara neutral](evidence/browser/04-cine.png) · [Estudio](evidence/browser/05-studio.png) · [Alerta](evidence/browser/06-alert.png) | Tres condiciones de luz con encuadre compartido; respuesta de armadura, recinto y emisivos. |
| [Órbita Estudio](evidence/browser/07-studio-inspect.png) | Geometría, silueta y materiales durante una vista de inspección. |
| [Perfil Cinemática](evidence/browser/07b-cinematic-profile.png) | Perfil superior integrado en un viewport acotado para el coste del renderer por software. |
| [Detalle con FXAA](evidence/aa/fxaa-fine-details.png) · [detalle con MSAA](evidence/aa/msaa-fine-details.png) | Comparación controlada de la microgeometría y el compromiso del AA de menor coste. |
| [Operarios en la vista inicial](evidence/crew/crew-default-crop.png) | Los tres puestos conservan escala/ubicación y mayor contraste local de ropa. |
| [Trabajo a 0 s](evidence/crew/crew-work-0.png) · [3 s](evidence/crew/crew-work-3.png) · [6 s](evidence/crew/crew-work-6.png) | Gestos diferenciados, manos ligadas a accesorios y pies sobre la plataforma. Las capturas solas no prueban continuidad temporal. |
| [Ajustes compactos reducidos](evidence/browser/08-compact-reduced-settings.png) · [Ventana compacta](evidence/browser/09-compact-reduced-window.png) | Legibilidad y acceso en el viewport estrecho bajo política reducida. |

La revisión de operarios identificó contraste insuficiente a unas treinta filas de píxeles de altura; se corrigió localmente mediante colores de ropa y una banda de identificación. Se descartaron como causa un fallo de skinning, culling u ocultación geométrica. La [medición de visibilidad](evidence/crew/visibility-pixels.json) y las capturas documentan esa corrección; no implican anatomía humana fotorrealista.

**Límite conservado:** las placas finas, rejillas y tornillos pueden producir moteado en el perfil Rendimiento a DPR 0,78 con la ruta de menor coste/FXAA. En el diagnóstico controlado, el patrón persistió al desactivar sombras, eliminar bump del hangar y aumentar el near plane; desapareció al seleccionar MSAA 4× con cámara y DPR constantes. Se clasifica como aliasing de microgeometría subpíxel en esa ruta, **no como shadow acne, desgaste, fallo de bias o defecto confirmado del shader**. Se mantienen la geometría y el shader de terceros; la ruta con MSAA conserva mejor las líneas mecánicas. Véase [surface-design.md](surface-design.md).

Las **11 capturas finales del runner figuran como `visualReview: reviewed`**; esa revisión queda separada de los 12 casos automatizados. Se revisaron las luces, el perfil Cinemática, la escala/visibilidad de operarios, las vistas compactas y la presentación de los fixtures. Esto no acredita una comparación con fotografía real ni elimina los límites de aliasing descritos. El PNG generado durante una prueba y su revisión visual son evidencias diferentes.

## Trazabilidad de los mandatos y límites pendientes

[motion-design.md](motion-design.md) considera las **16 técnicas de movimiento** con aplicación, adaptación u omisión y contratos de interrupción. [graphics-decisions.md](graphics-decisions.md) contiene **61 decisiones técnicas** con beneficio/coste y las **201 filas §0–200**, es decir, los 200 apartados principales más su objetivo inicial. Esa cobertura documental significa que se consideró todo el mandato; **no significa que se hayan implementado las 200 técnicas**.

Siguen fuera de lo demostrado: shaders WebGPU nativos en una GPU/navegador compatibles, rendimiento sostenido en GPU física y móvil, comportamiento térmico, VRAM total, permisos físicos de webcam y precisión del detector, escucha del audio, certificación con tecnologías de asistencia y una prueba dedicada de la secuencia completa de activación desde la UI. TAA, vectores de velocidad, reconstrucción temporal, SSR/SSGI, RT y acumulación temporal de Foto están deliberadamente omitidos; tampoco existen los sistemas de mundo exterior que el diorama no requiere. La captura es espacial y de un fotograma. Los límites de la escultura y figuras procedurales se conservan como límites del resultado, no se ocultan mediante una etiqueta AAA.
