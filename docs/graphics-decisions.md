# EVA · decisiones gráficas y trazabilidad

## Alcance, lectura del mandato y estado de la evidencia

El producto es una maqueta escultórica de EVA–01 dentro de un hangar, con tres operarios sobre una plataforma. El objetivo es mejorar la lectura de volumen, materiales, contacto y movimiento de ese espacio, conservando su ejecución directa en un HTML. No se incorpora un mundo abierto para justificar técnicas pensadas para otro producto.

Se revisó el mandato completo: sus **200 secciones §1–200, además del objetivo §0**, la misión y el modo autónomo. La selección se rige por §186 («Nunca implementar automáticamente todo») y por el paso 10 del modo autónomo, que exige elegir las técnicas pertinentes. Los imperativos se evalúan bajo esa regla global. Una sustitución se identifica como tal y una omisión continúa siendo una omisión: esta trazabilidad no acredita que se hayan implementado todas las técnicas ni que se haya demostrado fotorrealismo AAA.

Este documento describe decisiones y hechos inspeccionables en los fuentes. La evidencia ejecutada, su entorno y sus límites deben consultarse en [verification.md](verification.md). Una técnica presente en código no equivale a una prueba visual superada. En particular, se incluye una ruta real `WebGPURenderer`; el Chromium 134 disponible ha presentado pérdida de dispositivo incluso con una operación WebGPU nativa mínima, por lo que **no se atribuye a ese entorno una validación visual de shaders WebGPU nativos**. El respaldo WebGL2 debe evaluarse por separado.

## A–H · contexto previo a los cambios

El registro inicial y el orden de trabajo están en [implementation-plan.md](implementation-plan.md). Esta tabla conserva su diagnóstico como baseline, sin convertir los resultados posteriores en observaciones previas.

| Área | Contexto del baseline y decisión que origina |
|---|---|
| A. Estado actual | Busto articulado, hangar y tres figuras pequeñas; vistas Ventana, Órbita y Recorrido; cámara local, sonido voluntario, captura y preferencias. |
| B. Arquitectura detectada | Three.js 0.186.1, WebGL2, PBR, PCF, PMREM de un entorno genérico y bloom con EffectComposer. HTML original de 1.246.745 bytes. |
| C. Limitaciones reales | Escultura procedural, sin fotogrametría, anatomía humana detallada ni movimiento capturado. GPU y VRAM del usuario desconocidas. Debe abrir sin descargas. |
| D. Cuellos de botella | Las figuras originales sólo giraban como grupos rígidos; materiales con poca diferenciación; calidad con poca granularidad; render continuo aun en pausa. Las muestras con rasterización por software no permiten inferir rendimiento de hardware. |
| E. Distancia al objetivo | La articulación humana, el apoyo de pies, las diferencias de acabado y la coherencia entre luminarias y reflejos aportan más que añadir efectos ópticos. La geometría sigue siendo una interpretación artística. |
| F. Técnicas relevantes | Skinning, IK y capas de actuación; roughness/bump por acabado; iluminación local y PMREM del hangar; HDR, AA espacial, AO acotado; dos backends, calidad adaptable y diagnóstico. |
| G. Técnicas irrelevantes | Sistemas de paisaje, océano, tráfico, vegetación y clima; simulación masiva; rasgos humanos de primer plano. La reconstrucción temporal y los reflejos de pantalla se omiten también por coste y complejidad, aunque podrían beneficiar otra versión. |
| H. Roadmap | Baseline y fuentes reproducibles → personajes y superficies → renderer y calidad → integración de movimiento/UI → verificación funcional y visual → revisión y entrega. |

## Implementación seleccionada y límites precisos

### Renderer, color y sombras

[render-pipeline.js](../src/render-pipeline.js) consulta las capacidades, intenta obtener e inicializar un dispositivo WebGPU y construye `WebGPURenderer` con un pipeline TSL real. Si falla la inicialización, reemplaza el canvas antes de crear `WebGLRenderer` con un contexto WebGL2. [main.js](../src/main.js) también contempla el fallo posterior al preparar materiales o postprocesado, antes de instalar los controles. La identidad de backend expuesta en diagnóstico corresponde al inicializado; disponer de `navigator.gpu` no basta para anunciar WebGPU activo.

La detección incluye una estimación de cadencia a partir de la mediana de intervalos RAF iniciales, con una ventana máxima de 250 ms concurrente con la búsqueda de adaptador. Se conserva nula si la pestaña está oculta o faltan muestras útiles. `refreshRateHz` es esa observación, no una lectura garantizada de la frecuencia física de pantalla. La pista `systemMemoryGB` se comparte con la selección del perfil móvil; tampoco equivale a VRAM disponible.

Ambas rutas trabajan con materiales PBR, iluminación lineal, tone mapping ACES y salida sRGB/SDR. WebGPU emplea RGBA16F; WebGL2 usa HDR cuando lo admiten las extensiones consultadas y reduce a RGBA8, sin bloom ni AO, si no lo permiten. HDR interno no significa salida HDR a la pantalla. La exposición permanece bajo control manual: no hay histograma ni adaptación automática de luminancia.

Una única luz principal proyecta sombra PCF. Las otras luces aproximan luminarias y rebotes del recinto sin mapas de sombra adicionales. El entorno especular se genera una vez con PMREM desde una escena auxiliar del propio hangar; se libera la escena auxiliar. No es una captura dinámica del conjunto de objetos ni una solución de rebotes múltiples.

El AA efectivo es **MSAA o FXAA**. Las muestras se ajustan a las admitidas por el backend. En WebGPU, activar GTAO requiere profundidad muestreable y selecciona FXAA; no se anuncia MSAA cuando se ha desactivado. FXAA trabaja después de tone mapping. El GTAO se evalúa a media resolución y se filtra espacialmente; en WebGPU su contribución multiplica de forma acotada el color iluminado. Es una señal de contacto, no GI ni oclusión exclusiva de la luz indirecta. No hay TAA, vectores de velocidad, reproyección, reconstrucción temporal, SSR ni SSGI.

### Superficies, escala y vida

[surface-detail.js](../src/surface-detail.js) emplea mapas PBR estándar y atributos de vértice. [eva.js](../src/eva.js) distingue **cuatro acabados**: pintura con recubrimiento discreto, fundición, mecanizado y elastómero. Roughness y altura tienen frecuencias y amplitudes específicas; el acabado mecanizado incluye marcas direccionales. Los UV de detalle se ajustan a la escala de cada carta y las semillas son deterministas. La respuesta de pulido/retención procede de curvatura, orientación y variación espacial; no es una simulación de uso acumulado ni una máscara física de clima. El detalle no añade mallas ni llamadas de dibujo. Los bevels y la geometría macroscópica originales se conservan.

[exhibit-lighting.js](../src/exhibit-lighting.js) mantiene los tres ambientes Estudio, Cine y Alerta con transición amortiguada y un estado final estable. La niebla es una aproximación lineal de profundidad; no contiene scattering volumétrico, froxels ni ray marching. El polvo consta de hasta 66 puntos en un buffer fijo y se mueve como conjunto; no se simula con compute.

[crew.js](../src/crew.js) crea tres `SkinnedMesh` con una geometría corporal compartida y un esqueleto por operario. JavaScript calcula objetivos y poses; la GPU deforma los vértices. Coordinación, lectura de tableta y mantenimiento tienen ciclos y respuestas distintos, con respiración, orientación de cabeza, brazos articulados y transición de preparación. IK analítica mantiene los pies sobre una plataforma plana conocida y dirige las manos hacia accesorios reales del rig. No hay locomoción, raycasts de terreno, motion matching, captura de movimiento ni simulación anatómica.

### Calidad, captura y ciclo de vida

Los parámetros están en [quality.js](../src/quality.js). Son presupuestos de aplicación y objetivos de adaptación; **no son promesas de FPS** ni mediciones del hardware.

| Perfil | Presupuesto de píxeles | DPR máximo | Sombra solicitada | AA solicitado | Bloom / AO | Polvo máximo | Referencia de adaptación |
|---|---:|---:|---:|---:|---|---:|---:|
| Rendimiento | 800.000 | 1 | 1024² | 0 muestras → FXAA | No / No | 22 | 60 Hz |
| Equilibrada | 1.500.000 | 1,35 | 2048² | 2 muestras, ajustadas al soporte | Sí / No | 40 | 60 Hz |
| Calidad | 2.600.000 | 1,65 | 2048² | 4 muestras, según pipeline | Sí / Sí | 66 | 30 Hz |
| Ultra | 3.700.000 | 2 | 4096² | 4 muestras, según pipeline | Sí / Sí | 66 | 30 Hz |
| Cinemática / Foto | 6.000.000 | 2,5 | 4096² | 4 muestras, según pipeline | Sí / Sí | 66 | Escena pausada; sin adaptación automática |

El DPR también queda limitado por la pantalla, la cantidad de píxeles y el tamaño máximo de textura. El renderizado por software recibe un límite adicional. La adaptación reduce primero resolución; con carga sostenida desactiva AO y después bloom y reduce sombra/polvo. La recuperación requiere más tiempo que la degradación y usa un intervalo de espera para limitar oscilaciones. La señal puede incorporar consultas GPU reales cuando son válidas; si no hay resultado, usa intervalo de frames. Esa alternativa se identifica como intervalo, no como tiempo GPU.

La pausa congela el reloj de escena y pasa a render a demanda una vez asentadas cámara e iluminación. Entrada, cambio de tamaño y ajustes vuelven a solicitar frames. Ocultar la pestaña cancela RAF y detiene recursos de cámara/sonido según su ciclo de vida. No hay bucles privados para los operarios.

La captura de Foto genera **un PNG de un único fotograma**. Calcula un objetivo espacial de hasta 2× por eje, sujeto a 4.000.000 de píxeles y al límite de textura, y lo compara con el DPR de trabajo: conserva el mayor para no reducir una vista Cinemática que ya tiene más resolución. En ese caso puede mantener el presupuesto superior del perfil, de hasta 6.000.000 de píxeles. Al terminar, `finally` reaplica la calidad y las dimensiones vigentes; no restaura ciegamente un DPR anterior si hubo cambios mientras se codificaba el PNG. No hay jitter, acumulación de 32 frames, superresolución temporal, DOF ni trazado de caminos.

## Matriz de decisión de técnicas (§186)

Los costes GPU, CPU y memoria son **estimaciones cualitativas relativas**, no timings, benchmarks ni incrementos medidos. En técnicas omitidas describen el coste esperado de incorporarlas. «Inicial» sitúa el coste fuera del bucle de render. Las columnas WebGPU/WebGL2 indican lo que EVA implementa, no todo lo que la API podría hacer. «Sí» acredita presencia en código; la validación de cada ruta se registra aparte. P0 = fundamento/compatibilidad; P1 = mejora perceptual elegida; P2 = apoyo; O = omitida en este alcance.

| Técnica | Beneficio visual | GPU | CPU | Memoria | WebGPU | WebGL2 | Prioridad |
|---|---|---|---|---|---|---|---|
| Renderer dual y fallback con canvas nuevo | Conservar acceso y composición | Variable | Bajo; inicial medio | Media; dos rutas compiladas | Sí, renderer real | Sí, respaldo real | P0 |
| Detección de límites y perfil inicial | Evitar cargas inviables | Bajo, sondeo inicial | Bajo inicial | Baja | Sí | Sí | P0 |
| Cinco perfiles y resolución dinámica | Mantener interacción con carga variable | Reduce coste | Bajo | Reduce buffers | Sí | Sí | P0 |
| Iluminación lineal, HDR y ACES | Luces y materiales coherentes | Medio | Bajo | Media por buffers | RGBA16F | RGBA16F o SDR | P0 |
| Exposición manual | Encuadre y lectura de sombras | Bajo | Bajo | Baja | Sí | Sí | P1 |
| Autoexposición por histograma | Adaptación entre espacios luminosos | Medio | Bajo | Media | Omitida | Omitida | O |
| PBR y recubrimiento por acabado | Separar pintura, metal y juntas | Medio | Bajo | Media | Sí | Sí | P1 |
| Roughness multiescala y bump métrico | Evitar superficie uniforme y escala falsa | Bajo/medio | Medio inicial | Media, mapas compartidos | Sí | Sí | P1 |
| Pulido, retención y AO por geometría | Desgaste con causa geométrica | Bajo | Medio inicial | Baja/media, atributos | Sí | Sí | P1 |
| Bevels y separación macro/meso/micro | Silueta y reflejos de borde | Medio | Bajo por frame | Media, geometría | Conservada | Conservada | P1 |
| Batches estáticos y materiales compartidos | Densidad con menos submits | Reduce coste | Reduce coste | Media | Sí | Sí | P0 |
| Mipmaps y anisotropía limitada | Reducir aliasing de microdetalle | Bajo/medio | Bajo | Media por mipmaps | Sí | Sí | P1 |
| Atlas de materiales y texture arrays | Reducir cambios con muchos assets | Bajo/medio | Medio inicial | Variable | Omitidos | Omitidos | O |
| KTX2/Basis y compresión GPU | Reducir payload y texturas grandes | Bajo | Medio al decodificar | Reduce texturas | Sólo detección | Sólo detección | O |
| GLB, Meshopt y Draco | Optimizar assets externos complejos | Bajo | Medio inicial | Variable | Sin esos assets | Sin esos assets | O |
| POM, displacement y teselación alternativa | Relieve de superficies cercanas | Medio/alto | Bajo/medio inicial | Media | Omitidos | Omitidos | O |
| Luminaria principal y rebotes acotados | Jerarquía y lectura de volumen | Medio | Bajo | Baja | Sí | Sí | P1 |
| PCF con una sombra y resolución por perfil | Apoyo y oclusión local | Medio/alto | Medio | Media/alta | Sí | Sí | P1 |
| CSM, estabilización de cascadas y PCSS | Sombras extensas y penumbra variable | Alto | Medio | Alta | Omitidos | Omitidos | O |
| GTAO con filtro espacial a media resolución | Contacto en huecos y uniones | Medio | Bajo/medio | Media | Sí, profundidad + FXAA | Sí, GTAOPass | P1 |
| Contact shadows por ray marching y bent normals | Oclusión fina/direccional | Medio | Bajo | Media | Omitidos | Omitidos | O |
| PMREM estático del hangar | Reflejos y ambiente coherentes | Medio inicial; bajo por frame | Bajo | Media | Sí | Sí con HDR | P1 |
| Grids de probes, SH dedicado y GI híbrida | Rebotes localizados | Medio/alto | Medio inicial | Media/alta | Sustitución ambiental | Sustitución ambiental | O |
| SSGI | Rebotes visibles dependientes de escena | Alto | Bajo/medio | Alta, buffers/historia | Omitida | Omitida | O |
| SSR y reflejos planares | Reflejar objetos cercanos | Alto | Bajo/medio | Media/alta | Omitidos | Omitidos | O |
| Clustered lighting y culling de luces GPU | Escalar muchas luces | Medio | Bajo tras preparación | Media | Omitidos | Omitidos | O |
| Niebla lineal de recinto | Profundidad discreta | Bajo | Bajo | Baja | Sí | Sí | P2 |
| Volumetría, froxels y nubes temporales | Medios participantes y exterior | Alto | Medio | Alta | Omitidos | Omitidos | O |
| Skinning GPU de tres operarios | Eliminar figuras rígidas | Bajo/medio | Bajo/medio, poses | Media, rig compartido | Sí | Sí | P1 |
| Capas de actuación, mirada e IK de brazos | Gestos vinculados al trabajo | Bajo | Medio, tres rigs | Baja | Compartido | Compartido | P1 |
| IK de pies sobre plano conocido | Mantener apoyo durante balanceo | Bajo | Bajo/medio | Baja | Compartido | Compartido | P1 |
| Motion matching y locomoción | Movimiento de personajes viajeros | Medio | Alto | Alta, clips/índice | Omitidos | Omitidos | O |
| Piel SSS, ojos humanos y pelo | Primeros planos humanos | Medio/alto | Medio inicial | Alta | Omitidos | Omitidos | O |
| Polvo contextual en buffer fijo | Profundidad y actividad discreta | Bajo | Bajo | Baja | Points | Points | P2 |
| Partículas compute y simulación masiva | Densidad de efectos | Medio | Bajo tras preparación | Media | Omitidas | Omitidas | O |
| Decals/señales y alpha limitado | Escala y contexto de mantenimiento | Bajo/medio | Bajo | Baja/media | Conservados | Conservados | P2 |
| Cámara off-axis y órbita amortiguada | Presencia espacial e interacción | Bajo | Bajo | Baja | Compartido | Compartido | P0 |
| Cámara física completa, colisiones y head bob | Recorrido de primera persona | Medio | Medio | Media | Omitidos | Omitidos | O |
| MSAA o FXAA espacial | Reducir bordes dentados | Medio MSAA; bajo FXAA | Bajo | Media con MSAA | Según AO y soporte | Según soporte | P1 |
| Motion vectors, TAA y upscale temporal | Estabilidad subpíxel y reconstrucción | Medio/alto | Medio | Alta, historial | Omitidos | Omitidos | O |
| Reuso temporal, checkerboard y blue noise acumulado | Amortizar efectos caros | Medio | Medio | Alta | Omitidos | Omitidos | O |
| Bloom por luminancia HDR | Respuesta de emisivos | Medio | Bajo | Media, buffers reducidos | Sí | Sí con HDR | P2 |
| DOF, motion blur, LUT, aberración y film grain | Estilización óptica | Medio/alto | Bajo | Media | Omitidos | Omitidos | O |
| Foto de resolución espacial mayor | Inspección y exportación | Alto transitorio | Bajo | Alta transitoria, limitada | Sí en código | Sí en código | P2 |
| Acumulación temporal para captura | AA y detalle de escena estática | Alto acumulado | Medio | Alta | Omitida | Omitida | O |
| Frustum culling con límites conservadores | Evitar dibujo invisible | Reduce coste | Bajo | Baja | Motor | Motor | P0 |
| LOD/HLOD, impostors y shader LOD | Escalar grandes distancias | Reduce coste | Medio | Media/alta, variantes | Omitidos | Omitidos | O |
| HZB, GPU culling e indirect drawing | Escalar escenas masivas | Medio | Reduce submits | Media/alta | Omitidos | Omitidos | O |
| Streaming de mundo/mips y assets progresivos | Contenido mayor que memoria/carga inicial | Variable | Medio/alto | Media, cachés | Omitidos | Omitidos | O |
| Worker, OffscreenCanvas y WASM | Descargar tareas CPU masivas | Variable | Medio, coordinación | Media | Omitidos | Omitidos | O |
| Física, fixed timestep, ECS y BVH | Simulación e interacción complejas | Bajo/medio | Medio/alto | Media/alta | Omitidos | Omitidos | O |
| Reutilización de buffers y render a demanda | Menos trabajo y presión de memoria | Reduce coste | Reduce coste | Baja/acotada | Sí; sin garantía zero-garbage | Sí; sin garantía zero-garbage | P0 |
| Preparación de shaders y cachés del motor | Reducir primeras apariciones costosas | Medio inicial | Medio inicial | Media | Sí, warmup | Sí, compileAsync | P0 |
| HTML único, assets locales y progreso | Inicio comprensible sin dependencias remotas | Bajo | Medio inicial | Payload acotado | Sí | Sí | P0 |
| UI semántica, entrada accesible y fullscreen voluntario | Respuesta y control de la experiencia | Bajo | Bajo | Baja | Compartido | Compartido | P0 |
| Métricas CPU/frame/GPU y recursos | Poder comprobar coste y degradación | Bajo, consultas opcionales | Bajo; resumen periódico | Baja, anillos acotados | Consulta si disponible | Consulta si disponible | P0 |
| Vistas de materiales, overdraw y heatmap | Diagnóstico gráfico especializado | Medio | Medio | Media | Omitidas | Omitidas | O |
| Terreno, cielo físico, sol y paisaje | Exterior amplio | Alto | Medio/alto | Alta | Fuera del diorama | Fuera del diorama | O |
| Agua, ondas, lluvia, charcos y clima | Entorno expuesto y respuesta ambiental | Alto | Medio/alto | Alta | Fuera del diorama | Fuera del diorama | O |
| Vegetación, viento, hierba y fauna/tráfico lejano | Densidad de un mundo exterior | Medio/alto | Medio/alto | Alta | Fuera del diorama | Fuera del diorama | O |
| RT hardware o referencia path tracing | Rebotes/reflejos de referencia | Muy alto | Medio | Alta | Omitidos | Omitidos | O |

## Coste de entrega, dependencias y memoria

El HTML final mide **2.049.453 bytes**, frente a **1.246.745 bytes** del baseline: **802.708 bytes adicionales, +64,3843 %**. Su SHA-256 es `37d4e39e6217de6e5c03011c1abe287e8a9b3c4298d574a85300889022bf94df`; la recompilación en memoria coincide byte por byte. Los dos renderers y sus addons forman parte del archivo autocontenido. [verification.md](verification.md) registra la instalación limpia, la identidad del archivo probado y los límites de las mediciones. El aumento de bytes no se interpreta como una medida de tiempo de carga, memoria o parseo.

[package.json](../package.json) fija Three.js 0.186.1 como dependencia de ejecución; esbuild 0.28.2 y Playwright 1.51.1 pertenecen al desarrollo. No se añade otra biblioteca de ejecución para un efecto trivial. No hay loaders de modelos externos ni descargas de texturas en el flujo normal; la geometría y los mapas se generan localmente. No se presupone una conexión rápida ni un servidor con compresión para abrir el archivo.

Los nuevos mapas de acabado son pequeños y compartidos: pintura de 512², otros acabados de 256² y dos rampas de respuesta de 64², con mipmaps. `surfaceStats.textureBytes` estima sus texels RGBA8 y mipmaps; `attributeBytes` cuenta atributos añadidos. **No representan VRAM total**: excluyen, entre otros, buffers de render, sombras, PMREM, copias retenidas por CPU y cachés del controlador. `navigator.deviceMemory` es una pista de memoria de sistema, no memoria gráfica disponible. Los presupuestos de texturas 64/128/256 MB son políticas conservadoras de aplicación, no reservas ni mediciones de VRAM libre.

La geometría es finita y se construye al inicio; el hangar y la armadura conservan agrupación por material y los cuerpos comparten geometría. Esto acota el dominio, pero no demuestra por sí mismo que el tiempo de generación ni la memoria máxima sean adecuados en todos los dispositivos. El loop reutiliza vectores y buffers en zonas relevantes, aunque conserva asignaciones pequeñas en coordinación/iluminación: no se declara «zero garbage». Las estadísticas del renderer cuentan llamadas y primitivas procesadas por sus pases, no exclusivamente objetos únicos visibles.

## Criterios de comprobación y brechas declaradas

| Comprobación | Criterio revisable y límite de la afirmación |
|---|---|
| Arranque y compatibilidad | Compilación reproducible; archivo abierto sin recursos de red; backend reportado igual al real; fallo WebGPU con canvas nuevo y controles operativos en WebGL2. Un adaptador detectado no prueba que la escena WebGPU se haya renderizado. Probar el grafo TSL sobre WebGL verifica esa ruta de compatibilidad, no shaders ejecutados en WebGPU nativo. |
| Materiales y luz | Capturas comparables de Estudio, Cine y Alerta; observar recubrimiento, fundición, mecanizado y juntas, exposición, negros, borde de sombra y bloom. La comparación con fotografía real sigue siendo un criterio, no un resultado ya acreditado aquí. |
| Movimiento | Cámara lateral y órbita, poses intermedias, activación y pausa/reanudación. Buscar shimmer, saltos, intersecciones, pies desplazados y manos separadas de accesorios. Una captura estática no cierra este criterio. |
| Calidad y recursos | Límites de DPR/píxeles/sombras, elección de AA efectiva, histéresis, efectos realmente desactivados, respuesta a cambios repetidos y ausencia de crecimiento transitorio sin límite. No inferir VRAM de un contador de texturas. |
| Métricas | Distinguir intervalo de frame, trabajo JS y consultas GPU; registrar muestras, p95/p99 y picos. Tiempo GPU nulo cuando no hay consulta válida. No presentar intervalos dominados por SwiftShader como rendimiento de una GPU física. |
| Captura | PNG de escena sin UI, límites de tamaño, pausa estable y calidad/dimensiones vigentes restauradas incluso al fallar o cambiar ajustes durante la codificación. No reducir el DPR de una vista Cinemática superior. Identificarla como exportación espacial de un fotograma. |
| Funcionalidad y accesibilidad | Ventana/Órbita/Recorrido, mouse/teclado/táctil, foco de paneles, ajustes persistidos, cámara y sonido voluntarios, resize y movimiento reducido. Contratos de UI en [motion-design.md](motion-design.md). |
| Sesiones sostenidas | Validación posterior en GPU física y móvil para calentamiento, pacing y memoria. La adaptación está implementada; su mera existencia no demuestra estabilidad térmica. |

Brechas frente a la lectura literal del mandato: reconstrucción temporal y sus buffers; SSR/SSGI; grids de probes; debug views gráficas completas; culling/LOD/streaming de mundo; física/Workers/WASM; salida HDR de pantalla; exposición automática; humanos de primer plano y simulación ambiental. Se omiten deliberadamente, no se renombran como si otras técnicas las implementaran. El mayor límite perceptual restante es la naturaleza procedural de la escultura y de sus figuras, junto con la ausencia de datos reales de materiales y anatomía. Los objetivos de §191 y §200 se juzgan con evidencia, no con el número de efectos.

## Trazabilidad completa de §0–200

**I** = implementado o conservado en código; **A** = adaptado al diorama, con sustitución/alcance indicado; **O** = omitido; **V** = criterio de verificación o decisión que necesita evidencia. Las filas V no significan «prueba superada». Una fila A no acredita las partes que señala como ausentes. Las decisiones de alcance se aplican por §186 y el modo autónomo a todos los apartados, incluidos los redactados como imperativos.

### §0–49 · fundamentos, materiales e iluminación

| Sección y tema | Estado | Disposición contextual |
|---|---|---|
| 0. Objetivo fundamental | V | Coherencia, interacción y estabilidad guían la revisión; no se afirma equivalencia fotográfica demostrada. |
| 1. Principio rector | A | Prioridad en articulación, apoyo, acabados e iluminación; postprocesado discreto. |
| 2. Arquitectura web | I | Detección previa, renderer WebGPU real y respaldo WebGL2 con reemplazo de canvas. |
| 3. Ruta WebGPU | A | Pipeline TSL y skinning GPU; compute, draw indirecto y procesamiento temporal omitidos. |
| 4. WebGL2 fallback | I | Renderer y postprocesado propios; HDR o degradación SDR según soporte. |
| 5. Capacidades | A | API/adaptador, límites, compresión y clase aproximada; cadencia RAF estimada y memoria inferida, sin lectura de VRAM real. |
| 6. Presets | I | Cinco perfiles más selección automática; presupuestos explícitos, sin garantía de FPS. |
| 7. Adaptación dinámica | A | Consultas GPU cuando son válidas más intervalo de frame; resolución, AO, bloom, sombra y polvo escalables. |
| 8. Resolución dinámica | A | Resolución de dibujo limitada por DPR/píxeles y escala; salida espacial, sin upscale temporal. |
| 9. Temporal upscaling | O | Sin historia, máscaras reactivas ni reconstrucción; resolución adaptable y AA espacial. |
| 10. Motion vectors | O | No se generan velocidades de cámara, rig ni objetos. |
| 11. TAA | O | Sin jitter, reproyección ni rechazo de disoclusiones; MSAA/FXAA son sustitutos espaciales. |
| 12. Alternativas AA | A | MSAA soportado o FXAA; en WebGPU con AO se usa FXAA. No SMAA ni componente temporal. |
| 13. Pipeline de color | I | Mapas de datos sin sRGB, iluminación lineal, ACES y transformación de salida sRGB. |
| 14. HDR interno | A | RGBA16F en WebGPU y WebGL2 compatible; RGBA8 con efectos reducidos como último respaldo. |
| 15. Tone mapping | I | ACES del motor y exposición controlable; rolloff sujeto a revisión visual. |
| 16. Autoexposición | O | Exposición manual; no existe tránsito continuo entre exterior e interior. |
| 17. PBR | I | Materiales principales Standard/Physical; metalness, roughness, bump/AO y emisivos según acabado. |
| 18. Roughness multiescala | I | Variación macro/media/micro determinista y diferente por acabado. |
| 19. Material layering | A | Pintura/recubrimiento y respuesta de pulido/retención con mapas; sin sistema general de capas climáticas. |
| 20. Material atlasing | A | Se conservan batches y materiales/mapas compartidos; no se construye un atlas general. |
| 21. Texture arrays | O | Sin grandes familias de terreno/edificios/decal que las justifiquen. |
| 22. Compresión de texturas | A | Soporte detectado; mapas procedurales pequeños, sin KTX2/Basis ni transcodificador. |
| 23. Mipmapping | I | Mipmaps y anisotropía limitada en mapas apropiados; sin mip bias dinámico propio. |
| 24. Geometría glTF | O | Se conserva geometría procedural local; no se añade GLB ni animación comprimida. |
| 25. Meshopt | O | Sin payload de geometría externa que decodificar; se agrupa la geometría existente. |
| 26. Frecuencias geométricas | I | Silueta y formas secundarias geométricas; microacabado mediante mapas. |
| 27. Bevels | I | Se conservan bevels volumétricos de armadura; no se beveliza indiscriminadamente cada pieza. |
| 28. POM | O | No hay muros de ladrillo/terreno cercano que requieran relieve profundo; bump discreto. |
| 29. Teselación alternativa | A | Geometría detallada generada al inicio; sin teselación de hardware ni displacement/LODs dinámicos. |
| 30. Iluminación solar | O | Recinto de exhibición; luz principal y luminarias locales sustituyen la función compositiva. |
| 31. Cielo físico | O | No existe cielo visible ni ciclo horario. |
| 32. Atmospheric scattering | A | Niebla lineal de profundidad; sin Rayleigh/Mie ni dependencia física de humedad/altura. |
| 33. CSM | O | Espacio acotado y una sombra local; no hay distancia exterior para cascadas. |
| 34. Shadow stabilization | A | Luz/frustum de sombra estables y sesgos acotados; sin cascadas ni texel snapping propio. |
| 35. PCF/PCSS | A | PCF y resolución por perfil; no PCSS ni penumbra dependiente del bloqueador. |
| 36. Contact shadows | A | Sombra principal, apoyo por IK y GTAO; sin pase específico de ray marching de contacto. |
| 37. GTAO/SSAO | A | GTAO a media resolución y filtro espacial; sin acumulación temporal. |
| 38. Bent normals | O | No se estima dirección libre de oclusión. |
| 39. Iluminación indirecta | A | Entorno PMREM y luces de rebote artísticas; no GI de escena ni rebotes medidos. |
| 40. SSGI | O | Coste y estabilidad no justificados aquí; sin pirámide de profundidad ni historia GI. |
| 41. Probe GI | O | No hay grid de irradiancia ni interpolación espacial de probes. |
| 42. GI híbrida | A | Luz directa más aproximación ambiental; no suma de SSGI y probes espaciales. |
| 43. Reflection pipeline | A | Entorno PMREM consistente; sin SSR ni reflejos planares. |
| 44. SSR | O | No hay ray marching de profundidad, refinamiento ni acumulación de reflejos. |
| 45. Reflection probes | A | Un entorno estático del hangar filtrado con PMREM; sin red de probes ni actualización por objeto. |
| 46. Planar reflections | O | No se añaden espejos, charcos ni suelo de espejo. |
| 47. Light probes | A | Iluminación ambiental del motor para dinámicos; sin LightProbe/SH dedicado. |
| 48. Clustered lighting | O | Pocas luces seleccionadas y un shadow caster; no hay clusters del frustum. |
| 49. Light culling GPU | O | Sin listas de luces por compute; su coste no se justifica con este conjunto. |

### §50–99 · entorno, escalabilidad y personajes

| Sección y tema | Estado | Disposición contextual |
|---|---|---|
| 50. Volumetric fog | A | Niebla lineal y polvo contextual; sin volumen reducido ni reconstrucción temporal. |
| 51. Froxel volumetrics | O | Sin scattering/extinción volumétrica; complejidad desproporcionada al recinto. |
| 52. Clouds | O | No hay cielo ni nubes visibles. |
| 53. Nubes adaptativas | O | Sin sistema de nubes que escalar o reproyectar. |
| 54. Weather system | O | Hangar interior; estado compartido de iluminación/activación, sin meteorología. |
| 55. Wetness | O | Acabados secos; no se simula lluvia o humedad acumulada. |
| 56. Puddles | O | No hay charcos ni máscaras de pendiente/concavidad para agua. |
| 57. Ripple shader | O | No hay lluvia ni superficies acuáticas. |
| 58. Water | O | No se introduce agua en el diorama. |
| 59. FFT/Gerstner | O | Sin grandes masas de agua ni simulación de ondas. |
| 60. Terrain | O | Plataforma y arquitectura finitas; sin terreno/chunks/clipmaps. |
| 61. Terrain material | O | No hay biomas o mezcla por pendiente/humedad. |
| 62. Terrain macro variation | A | El principio de variación multiescala se aplica a acabados; no se crea terreno. |
| 63. Vegetation instancing | O | Sin plantas; estructuras repetidas se agrupan como geometría estática. |
| 64. Vegetación jerárquica | O | No existen categorías de vegetación ni sus LODs. |
| 65. Foliage shader | O | Sin hojas; no se añade translucencia vegetal. |
| 66. Viento | O | No hay sistema ambiental de viento. |
| 67. Viento GPU | O | Sin foliage ni desplazamiento de ramas en vertex shader. |
| 68. Grass interaction | O | No hay hierba, jugador locomotor ni campo de interacción. |
| 69. Impostors | O | Distancias y cantidad de objetos no requieren vegetación o actores impostores. |
| 70. LOD | O | No hay cadena LOD0–impostor por objeto; se conserva geometría acotada y se escala resolución. |
| 71. LOD crossfade | O | No hay cambios de LOD que mezclar. |
| 72. HLOD | O | Sin barrios, bosques o regiones lejanas; batches no se presentan como HLOD. |
| 73. Frustum culling | A | Culling del motor y bounds conservadores del rig; no suspensión de toda lógica invisible. |
| 74. Occlusion culling | O | No se construye HZB ni se descartan clusters en GPU. |
| 75. GPU-driven drawing | O | Sin buffers de visibles ni draw indirecto; escala actual usa batches y skinning. |
| 76. World streaming | O | Una escena autocontenida; no hay celdas de mundo. |
| 77. Streaming asíncrono | A | Inicio por etapas y preparación asíncrona GPU; generación procedural sigue en hilo principal. |
| 78. Web Workers | O | No se añade protocolo Worker para el dominio acotado; el coste inicial requiere medición propia. |
| 79. OffscreenCanvas | O | Se conserva UI y render coordinados en hilo principal; no render worker. |
| 80. WASM | O | No hay física/navegación o procesado masivo que justifique otra dependencia. |
| 81. Physics | O | Escena coreografiada; no motor de cuerpos rígidos ni contactos dinámicos. |
| 82. Fixed timestep | A | Reloj único y delta limitado para animación; no integrador físico fijo de 60 Hz. |
| 83. Character skinning | I | Tres SkinnedMesh; vértices deformados por GPU, no por JavaScript. |
| 84. Animation blending | A | Respiración, trabajo, mirada, preparación e IK; sin estados de locomoción ni biblioteca de clips. |
| 85. Motion matching | O | Tres tareas estacionarias; no base de poses ni búsqueda por trayectoria. |
| 86. Foot IK | A | IK analítica y objetivos sobre plataforma plana; sin raycasts de terreno. |
| 87. Skin shading | O | Figuras de maqueta; sin SSS, wrapped diffuse o piel humana de primer plano. |
| 88. Eyes | O | Ópticas emisivas de EVA conservadas; sin esclerótica, iris y córnea humanos. |
| 89. Hair | O | Sin pelo de primer plano, cards ni strands. |
| 90. Transparency | A | Superficies principales opacas; alpha limitado en señales/polvo; sin OIT general. |
| 91. Particles | A | Hasta 66 puntos en un buffer fijo, transformados como conjunto; sin compute particles. |
| 92. Particulado contextual | A | Sólo polvo discreto del hangar; no lluvia, nieve, insectos o humo añadidos. |
| 93. Rain | O | Interior sin lluvia; no volumen de gotas alrededor de cámara. |
| 94. Rain collision | O | Sin gotas ni splash que resolver. |
| 95. Decals | A | Señales y marcas existentes más desgaste de material; sin sistema nuevo de proyección/impactos. |
| 96. Microdetail | A | Mapas pequeños y mipmaps; el filtrado integra detalle lejano, sin fade de distancia dedicado. |
| 97. Procedural variation | A | Semillas por acabado/cartas y respuesta geométrica; no atributos por instancia para miles de entidades. |
| 98. No random uniforme | A | Desgaste ligado a curvatura/orientación y función del material; no simulación de historia ambiental. |
| 99. Asset grounding | A | Pies por IK, sombras, AO y detalle de plataforma; sin terreno/vegetación para fundido. |

### §100–149 · cámara, pipeline y presupuesto

| Sección y tema | Estado | Disposición contextual |
|---|---|---|
| 100. Camera | A | Ventana off-axis calibrable en centímetros y perspectiva de órbita; sin modelo completo de sensor/apertura. |
| 101. Camera inertia | A | Damping exponencial y OrbitControls amortiguado; sin simulación completa de masa/resorte. |
| 102. Head bob | O | No hay locomoción; no se añade oscilación artificial a la exploración. |
| 103. Camera collision | A | Límites de posición/distancia/ángulo y shell oculto en inspección; no colisión geométrica general. |
| 104. DOF | O | Se conserva legibilidad de maqueta y controles; Foto no incorpora desenfoque por profundidad. |
| 105. Motion blur | O | No hay velocity buffer; no se usa blur para disimular animación. |
| 106. Bloom | I | Umbral de luminancia sobre HDR; intensidad acotada por ambiente/activación y perfil. |
| 107. Lens effects | O | Sin flare, suciedad de lente o aberración cromática nuevos. |
| 108. Color grading | A | ACES y transformación de salida; sin LUT ni pase independiente de grading. |
| 109. Film grain | O | No se añade grano de pantalla a la imagen. |
| 110. Screen-space pipeline | A | Sombras, PBR, AO opcional, bloom, salida y AA espacial; DOM independiente. Sin pases ausentes renombrados. |
| 111. Depth prepass | A | Profundidad/datos necesarios del pase de escena y GTAO; sin prepass general para overdraw/HZB. |
| 112. Depth pyramid | O | No hay HZB ni consumidores SSR/SSGI/culling. |
| 113. Temporal reuse | O | Sin historial de AO, GI, reflejos o volumetría; sólo recursos estáticos reutilizados. |
| 114. Checkerboard/interleaved | O | No hay render intercalado ni reconstrucción temporal. |
| 115. Blue noise | O | Sin sistema propio de muestreo blue noise con acumulación. Ruido procedural de material tiene otra función. |
| 116. Acumulación temporal | O | AA y AO espaciales; no se acredita acumulación a través de frames. |
| 117. Shader LOD | O | Sin variantes near/mid/far; mipmaps y perfiles reducen otros costes. |
| 118. Light LOD | A | Muchas luminarias visibles son emisivas y sólo algunas tienen luces reales; sin selección dinámica por distancia. |
| 119. Shadow LOD | A | Una sombra principal y resolución por perfil; sin clases de distancia de shadow casters. |
| 120. Animation LOD | A | Sólo tres rigs; pausa/ocultación detienen trabajo, sin frecuencias 60/30/15 Hz por distancia. |
| 121. Physics LOD | O | No se introduce física que necesite niveles de simulación. |
| 122. CPU budget | V | Instrumentar trabajo JS y pacing; presupuestos orientativos no son tiempos alcanzados. |
| 123. Modo 30 FPS | A | Perfiles superiores usan referencia de 33,3 ms para adaptación; no limitador fijo ni FPS garantizados. |
| 124. Modo 120 FPS | O | No se crea perfil 120 FPS ni objetivo 8,33 ms verificado. |
| 125. Main thread | A | Buffers reutilizados y telemetría periódica; generación inicial y pequeñas asignaciones siguen en el hilo principal. |
| 126. Zero-garbage hot path | A | Reuso de poses, vectores y anillos; no se afirma eliminación total de asignaciones por frame. |
| 127. Object pooling | A | Polvo y métricas preasignados; no pool genérico de entidades/eventos. |
| 128. Structure of arrays | A | Typed arrays para geometría, polvo y métricas; no ECS masivo en SoA. |
| 129. ECS | O | Módulos de responsabilidades concretas; dominio pequeño sin framework ECS. |
| 130. Spatial index | O | No hay navegación, streaming ni interacción masiva que requiera octree/quadtree/hash. |
| 131. BVH | O | Objetivos de IK analíticos y controles acotados; sin raycasts de malla masivos. |
| 132. Shader compilation | A | compileAsync y warmup inicial; no se promete ausencia de compilaciones al estrenar cada combinación de efectos. |
| 133. Pipeline cache | A | Reuso de recursos y caché del motor; no caché persistente propia de bind groups/pipelines. |
| 134. Startup | A | Progreso por etapas y preparación de shaders; no contador de assets externos ni tiempo inicial certificado. |
| 135. Service Worker | O | HTML autocontenido, sin PWA ni registro de Service Worker requerido. |
| 136. Offline | I | Código, shaders y recursos locales incluidos; funcionamiento offline sujeto a prueba de archivo final. |
| 137. Single HTML | I | Un index.html compilado conserva el producto; fuentes modulares permiten mantenerlo. |
| 138. Three.js | A | WebGPURenderer/WebGLRenderer, TSL/Composer y skinning; no se añaden todos los addons enumerados. |
| 139. Babylon.js | O | Proyecto Three.js; no migración ni segunda biblioteca de escena. |
| 140. Motor custom | O | No hay motor propio que sustituir; se conserva el existente. |
| 141. No sobrecargar frameworks | A | Una dependencia de ejecución fijada; bundle dual final de 2.049.453 bytes, con aumento declarado. |
| 142. Carga inicial | A | Etapas de escena, iluminación y shaders; no mundo lejano ni assets críticos transmitidos por separado. |
| 143. Progressive quality | A | Perfil inicial conservador y resolución adaptable; sin sustitución progresiva de geometría/texturas. |
| 144. Stream texture mips | O | Mapas locales pequeños completos; sin infraestructura de streaming de mipmaps. |
| 145. Network budget | A | Sin peticiones de runtime; payload único de 2.049.453 bytes, no compresión HTTP presupuesta. |
| 146. Mobile | A | Píxeles/efectos limitados y una sombra; compatibilidad/performance real necesitan evidencia de dispositivo. |
| 147. Thermal throttling | V | Histéresis observa carga sostenida; no se declara una prueba térmica realizada. |
| 148. Pixel ratio | I | Mínimo entre DPR, límite de perfil, presupuesto de píxeles y dimensión de textura, con escala adaptable. |
| 149. UI | A | Transiciones DOM gestionadas y datos resumidos periódicamente; no se declara cero escrituras DOM por frame. |

### §150–200 · interacción, validación y cierre

| Sección y tema | Estado | Disposición contextual |
|---|---|---|
| 150. Input | A | Mouse, teclado y táctil conservados; rostro opcional. Sin gamepad ni controles de locomoción. |
| 151. Pointer Lock | O | Ventana/órbita/recorrido no requieren primera persona ni captura permanente del puntero. |
| 152. Fullscreen | I | Inmersión y fullscreen mediante acción voluntaria; fallback de inmersión dentro de página. |
| 153. Realismo de movimiento | A | Gestos por tarea, damping y apoyo del rig; no simulación física completa de cada objeto. |
| 154. Microanimaciones | A | Respiración, miradas, manos, emisivos y polvo; no cloth o cable dynamics nuevos. |
| 155. Mundo vivo | A | Tres operarios y señales dan actividad al hangar; sin población/tráfico/aves de exterior. |
| 156. Densidad perceptual | A | Geometría cercana, detalle de material y arquitectura agrupada; no simulación de distritos lejanos. |
| 157. Foveación perceptual | A | Presupuesto artístico concentrado en busto/plataforma; sin eye tracking, VRS o resolución radial. |
| 158. Imperfección | A | Bevels y variación causal de acabado; sin deformar aleatoriamente toda la geometría. |
| 159. Causalidad | A | Retención en concavidades, pulido expuesto y mecanizado direccional; historia de uso no simulada. |
| 160. Realismo sistémico | A | Activación enlaza actuación, luces y bloom; sin cadena de lluvia/humedad/reflejos. |
| 161. Validación estática | V | Comparar exposición, materiales, escala y contacto; no atribuir comparación fotográfica no documentada. |
| 162. Validación en movimiento | V | Barrido lateral y órbita para aliasing, sombras, reflejos y rig; registrar observaciones. |
| 163. Prueba de amanecer | A | Sustituir cielo/sol por revisión de luz rasante en el interior; no modo horario de amanecer. |
| 164. Prueba de mediodía | A | Ambiente Estudio como revisión de lectura y AO; no simulación física de sol al mediodía. |
| 165. Prueba de noche | V | Ambiente Cine para emisivos, negros, exposición y aliasing. |
| 166. Prueba de lluvia | O | No hay sistema de lluvia seleccionado ni cambios climáticos que verificar. |
| 167. Interior/exterior | O | No existe ese recorrido; se comprueban cambios de ambiente y de cámara dentro del producto. |
| 168. Análisis anti-CGI | V | Revisar bordes, uniformidad, apoyo, AO, bloom, rigidez y aliasing pertinentes al diorama. |
| 169. Frame time | I | Anillos con distribución de frame/CPU y GPU si hay datos; p95/p99/picos no se confunden con FPS medios. |
| 170. Profiling | A | Diagnóstico de backend, timings, draws, triángulos, recursos y estado; sin auditoría total de VRAM/instancias visibles. |
| 171. Debug views | O | No hay selector completo de albedo/normals/depth/velocities/cascadas/LOD/clusters; la guía espacial no lo sustituye. |
| 172. Performance heatmap | O | No se incorpora mapa de coste por región de pantalla. |
| 173. Quality scaling | I | Parámetros explícitos para resolución, sombras, AA, bloom, AO y polvo; efectos ausentes no se enumeran como activos. |
| 174. No hardcodear Ultra | I | Inicio conservador, cinco perfiles, límites y degradación por carga. |
| 175. Objetivo desktop | V | Resolución/FPS son referencias; se requieren mediciones de GPU física para acreditar objetivos. |
| 176. Objetivo mobile | A | Materiales mantenidos, ambiente estático, una sombra y post limitado; sin LOD agresivo/instancing nuevo. |
| 177. Photo mode | A | Pausa y captura espacial limitada; sin DOF ni mayores muestras de reflejos/volumetría. |
| 178. Frame accumulation Foto | O | Se exporta un fotograma; sin acumulación multi-frame con jitter. |
| 179. Superresolución temporal Foto | O | Sin reproyección ni muestras subpíxel temporales; no se llama temporal a la exportación espacial. |
| 180. Referencia path tracing | O | No se añade modo experimental de ground truth ni se considera requisito del producto. |
| 181. Sin hardware RT | I | Ninguna ruta requiere RT de hardware, RTX o API propietaria. |
| 182. Sustitución perceptual | A | PMREM, luces acotadas, PCF, AO espacial y detalle material; sustituciones explícitas con sus límites. |
| 183. Regla 90/10 | A | Criterio cualitativo de selección; no se afirma haber medido 90 % de calidad a 10 % de coste. |
| 184. Priorización | A | Beneficio/coste cualitativo en matriz; no ratios numéricos inventados. |
| 185. Plan por etapas | A | Roadmap documentado y adaptado; no se implementan etapas de mundo exterior o temporales omitidas. |
| 186. Matriz de decisión | I | Matriz explícita de técnicas elegidas y omisiones materiales, con costes estimados y rutas reales. |
| 187. Análisis A–H | I | Diagnóstico previo en implementation-plan y contexto conservado en este documento. |
| 188. Implementación | V | Fuentes modificadas realmente; verificación por bloque y regresiones deben constar en el registro de evidencia. |
| 189. Conservar funcionalidad | V | Revisar controles, UI, almacenamiento, captura, cámara/sonido, carga y responsive. |
| 190. Evitar rewrite innecesario | A | Fuentes recuperadas y modularizadas; geometría, identidad y flujos existentes conservados y extendidos. |
| 191. Criterio AAA web | V | Calidad estática, movimiento, materiales y pacing requieren juicio/evidencia; no etiqueta de equivalencia garantizada. |
| 192. Principio maestro | A | Arquitectura proporcional al diorama; no reproducción literal de un motor de mundo abierto. |
| 193. Regla de densidad | A | Silueta geométrica, microdetalle por mapas y recinto acotado; sin representación lejana nueva. |
| 194. Regla de coste | A | Presupuesto de píxeles/efectos y omisiones justificadas; no tiempos GPU supuestos. |
| 195. Regla de movimiento | V | Toda mejora visual debe observarse con cámara en movimiento; una captura aislada no basta. |
| 196. Regla de estabilidad | A | Detalle determinista, mipmaps, AA espacial e histéresis; artefactos restantes se evalúan en movimiento. |
| 197. Regla de realismo | V | Priorizar rigidez, uniformidad, luz/contacto y repetición; reconocer límites de geometría y assets procedurales. |
| 198. Regla WebGPU | A | Renderer moderno y deformación GPU; compute no se añade sin un problema masivo que resolver. |
| 199. Regla JavaScript | A | Coordinación y cálculo de pocos rigs; skinning GPU. Generación inicial CPU; sin Worker/WASM masivo. |
| 200. Objetivo final | V | Cierre por indicadores perceptuales y funcionales con evidencia; no por cantidad de efectos ni cobertura nominal. |

La misión de preservar contenido y evitar assets/shaders propietarios se aplica manteniendo la base del proyecto y recursos generados localmente. El modo autónomo se concreta en el roadmap, la selección de esta matriz, cambios reales y revisión de regresiones. Ninguno de estos registros convierte una omisión, un criterio pendiente o una limitación del entorno en una prueba aprobada.
