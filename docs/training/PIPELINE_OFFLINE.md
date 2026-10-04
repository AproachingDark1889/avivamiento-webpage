# Pipeline de evidencia — fases 0 a 3

Actualización documental: 17 de septiembre de 2026. Las fases 0–2 implementaron utilidades y aceptación offline, sin mutaciones de la base. Posteriormente, con autorización para la Fase 3, se preparó Supabase local, se comprobó el correo y se ejecutaron los nueve procedimientos reales mediante un ensayo sin grabación. El contrato vigente es v2: 9 módulos, 12 segmentos y 36 hitos; el módulo 9 utiliza caja independiente de Sofía y rescate por Marcos.

Resultado de referencia: `test-results/avc-training-8aa7684b-4dda-4379-94d5-08212d7cd406/rehearsal-result.json`, aprobado el 14 de septiembre de 2026 a las 06:09:32.968 UTC. No es una traza ni una aprobación de material visual. **No se ha ejecutado el rodaje maestro, sustituido frames, hecho commit o publicado este trabajo.** Consultar `FASE_3_PREPARACION.md` para el alcance y los límites actuales.

## Componentes

| Archivo | Responsabilidad |
|---|---|
| scripts/portal/contracts.mjs | Nueve módulos; segmentos, roles, hitos y formato AVC1 |
| scripts/portal/capture.mjs | Orquestación secuencial por adaptadores, grupos de traza y recibos; no inicia servicios |
| scripts/portal/real-adapters.mjs | Acciones de la UI real y validación previa de destino/argumentos de RPC locales |
| scripts/portal/training-adapters.mjs | Conexión de los 36 hitos a los siete actores; precondiciones y recibos de los nueve módulos |
| scripts/portal/training-data.mjs | Aserciones PostgreSQL por ID/org, cálculos en centavos y limpieza delimitada al ensayo |
| scripts/portal/local-mail.mjs | Recepción y eliminación selectiva por destinatario e ID en Mailpit local |
| scripts/rehearse_portal_local.mjs | Ensayo funcional local sin trace, video ni screenshots; nunca genera aprobación de extracción |
| scripts/portal/validation.mjs | Aprobación vinculada a resultado/test/traza, parser before/after y selección explícita |
| scripts/portal/archive.py | Extracción limitada a eventos e imágenes, con límites y validación de nombres ZIP originales y normalizados |
| scripts/portal/images.py | Verificación y carga de raster mediante Pillow; SHA-256 de archivo y de RGBA decodificado |
| scripts/portal/jpeg_strict.py | Segunda decodificación JPEG con OpenCV; el padre rechaza advertencias nativas de corrupción |
| scripts/portal/lifecycle.mjs | Intentar todos los finalizadores; restricciones de identidad/organización para limpieza |
| scripts/portal/session-guard.mjs | Abortar un RPC dirigido a una sesión diferente antes de enviarlo |
| scripts/portal/activation-sandbox.mjs | Ensayar renombrado/restauración exclusivamente en carpetas temporales creadas por la función |
| scripts/extract_portal_frames.mjs | Crear un candidato nuevo y su procedencia; sin comando de promoción |
| scripts/run_portal_offline_tests.mjs | Enumeración compatible con Windows y conservación del resultado TAP/JSON |
| tests/portal-pipeline | Pruebas deterministas, fixtures sintéticos y funciones TypeScript aisladas con dobles |

No se importa el spec vivo ni sus archivos de entorno en la suite offline. Los tests que comprueban funciones del spec extraen su AST, eliminan tipos e inyectan exclusivamente dependencias simuladas.

## Reproducir aceptación fuera de línea

Dependencias observadas: Node 20.19.0; Python 3.12; Pillow 10.3.0; OpenCV 4.12.0; NumPy instalado con OpenCV; Babel disponible entre las dependencias locales. No se instalaron paquetes ni se accedió a Internet.

Desde la raíz del repositorio:

```powershell
npm run test:portal:offline
```

Si Python no está en PATH, el lanzador acepta `AVC_PYTHON` con la ruta de un intérprete que tenga Pillow/OpenCV/NumPy. No se trata de una credencial.

Cada ejecución guarda `results.tap` y `summary.json` en un directorio único `test-results/portal-offline-<UTC>`. Un fallo produce salida no cero. No se interpreta “0 tests” como éxito. Las ejecuciones fallidas se conservan para revisión.

Los tests crean imágenes y archivos ZIP ficticios en un directorio temporal nuevo; comprueban el directorio resuelto antes de retirarlo. También ensayan recuperación mediante archivos reales de prueba. Estos archivos no contienen ventas ni datos de una congregación.

## Contrato para el rodaje posterior — no ejecutado

`buildTrainingAdapters()` suministra las acciones UI y comprobaciones PostgreSQL de los 36 hitos. El runner `rehearse_portal_local.mjs` los ejecutó mediante `rehearseTraining()` sobre Nuxt/Supabase locales. `rehearseTraining()` y `captureTraining()` comparten la misma secuencia; solo la segunda activa grupos de traza y screenshots.

**Los adaptadores están ejercitados de extremo a extremo en el ensayo local. El modo de grabación no ha sido ejercitado sobre una nueva traza real ni existe un resultado visual aprobado.** La reapertura independiente pertenece al segmento `9/reopen`, operado por Sofía, distinto del rescate de Marcos. La habilitación de esa modalidad ocurre previamente mediante Gestión de Usuarios, RPC y lectura del perfil; no mediante un UPDATE administrativo para preparar la escena.

El ejecutor debe:

1. Verificar destino local de frontend, Auth, REST, Realtime y correo, y las migraciones requeridas. No usar valores remotos de fallback.
2. Crear identidades ficticias únicas y registrar IDs confirmados. La limpieza usa ese inventario; no nombres comerciales.
3. Iniciar trazas con screenshots; enlazar actor con contextFile/pageId reales. Los grupos AVC1 se implementan con `context.tracing.group()` y `groupEnd()`.
4. Ejecutar cada acción con su aserción. Si no hay frame dentro de un hito, la extracción rechaza el material; deberá recapturarse ese tramo.
5. Obtener recibos de los nueve módulos y el estado de limpieza. Cerrar la traza antes de calcular su hash.
6. Desde el resultado final de Playwright (testId, status y retry), llamar `makeApproval()`. Guardar sus dos objetos: `approval` y `runnerResult`. No generar aprobación para pruebas omitidas, interrumpidas, reintentadas o con limpieza fallida.

Los hashes y recibos enlazan integridad/procedencia, **no son una firma ni una protección contra un operador que fabrique ambos JSON**. El ensayo conserva eventos, recibos, limpieza y copias/hash de los ocho archivos principales ejecutados. No produce `approval` ni `runnerResult` para el extractor. El cierre de trazas, la asignación real contextFile/pageId y la vinculación al resultado del runner de grabación deberán prepararse y verificarse en la etapa de rodaje autorizada; no se ha fabricado una aprobación de material histórico.

## Extracción posterior — solo candidato

Una vez autorizado y completado un rodaje válido:

```powershell
node scripts/extract_portal_frames.mjs --trace RUTA_TRACE --approval RUTA_APROBACION --result RUTA_RESULTADO --name ID_VERSION_UNICO
```

`--python RUTA_INTERPRETE` es opcional. Las rutas de entrada deberán ser explícitas y privadas. No se busca “la última traza” ni se acepta `.last-run.json` como prueba suficiente.

Salida única: `artifacts/training-candidates/ID_VERSION_UNICO/`. El programa rechaza nombres inválidos, destinos existentes y aliases/symlinks de las rutas de salida comprobadas. Copia la traza a un directorio temporal propio antes de validar su hash. Solo después de seleccionar y decodificar crea el candidato. Si falla la escritura, retira únicamente ese candidato nuevo. No escribe en `docs/portal/assets/frames`.

Cada frame conserva recurso de origen, SHA-256 completo, firma RGBA, dimensiones, actor, contexto, entidad, instante y pertenencia a hitos. No se redimensiona ni recomprime en esta fase. Se declaran conteo, duplicados y frames planos. Cantidad y duración son asuntos separados: conservar marcas temporales no equivale a tener un reproductor ya integrado.

El material se etiqueta `CANDIDATE_REQUIRES_VISUAL_REVIEW`. No hay flag `--promote`. La activación real del portal no está implementada/permitida en este lote: solamente se ensaya su recuperación en sandbox. Dos renombrados tienen una ventana sin ruta activa y no se describen como una operación indivisible.

## Límites de la aceptación

- Los casos sintéticos cubren errores seleccionados, no todos los formatos/ataques posibles.
- Los metadatos de Docker no prueban transacciones ni correo. Estos últimos tienen evidencia separada del ensayo/microprueba. Los controles de URL local del cliente no son una certificación del firewall de la máquina.
- La comprobación de código no acredita esquemas desplegados o permisos reales en Supabase.
- El material original puede ser decodificable y conservar hashes sin estar editorialmente completo. Se requiere revisión visual posterior.
- No se midieron bytes de navegación, caché ni consumo celular. El tamaño de los archivos no representa consumo por visita.
- La campaña heredada de estrés no se usó para este ensayo. Su escena histórica de rescate de caja compartida no sustituye el módulo 9 v2 y no debe ejecutarse como runner didáctico. No se alteró esa campaña para ocultar la discrepancia.
