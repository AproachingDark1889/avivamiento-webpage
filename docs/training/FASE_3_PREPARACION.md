# Fase 3 — preparación funcional y límite de rodaje

Actualizado el 17 de septiembre de 2026. Contrato didáctico v2 autorizado por Fran.

## Resultado

Los cuatro pendientes funcionales de preparación cuentan con evidencia local: recepción/limpieza de correo; adaptadores de los nueve procedimientos; rescate de la caja independiente de Sofía por Marcos; limpieza al terminar el ensayo.

Ensayo aprobado: `avc-training-8aa7684b-4dda-4379-94d5-08212d7cd406`, 14 de septiembre de 2026, 06:08:41.301–06:09:32.968 UTC, viewport 1366 × 768. Se completaron 36 hitos, 12 segmentos y 9 recibos. Siete contextos de usuario se cerraron y se retiraron selectivamente siete usuarios y una organización con sus registros de prueba.

Esto acredita el recorrido funcional observado, no una auditoría exhaustiva de seguridad/concurrencia, un despliegue remoto ni la calidad didáctica de futuros fotogramas. El ensayo no llamó a grabación de trace/video/screenshots y no generó aprobación para el extractor.

## Procedimientos y roles

| Módulo | Operación y actor ejercitado |
|---|---|
| 1 | Pastor David: alta de congregación y configuración inicial |
| 2 | Líder Samuel: creación de Isaac y asignación al departamento |
| 3 | Líder Samuel: producto Taco de Guisado, precio $55 |
| 4 | Isaac: caja compartida, fondo $100 |
| 5 | Isaac: cobro $55, recibido $100, cambio $45, orden/partida verificadas |
| 6 | Andrés: recepción en KDS y entrega de esa misma orden |
| 7 | Daniel: autoentrega autorizada, Biblia $150, recibido $200, cambio $50 |
| 8 | Isaac: conteo y pre-cierre $155; Samuel: revisión y aprobación |
| 9 | Marcos habilita caja independiente en Gestión de Usuarios; Sofía abre y vende, Marcos rescata y aprueba, Sofía vuelve a abrir |

## Invariante verificado del módulo 9

- `mode = independent`; `cashier_id = opened_by = Sofía`.
- Fondo $50; venta $45; recibido $100 y cambio $55; ingreso neto $45.
- Diálogo específico de contingencia por Marcos. Con justificación vacía se comprobó que el botón no estuviera habilitado.
- Efectivo esperado y contado $95; diferencia $0.
- `preclosed_by = approved_by = Marcos`; la sesión cerrada es la misma que abrió Sofía.
- Sofía abrió después otra sesión independiente con un ID distinto, comprobado en PostgreSQL.
- No se modificó el componente de cierre ni se reemplazó el rescate por un pre-cierre ordinario.

## Reproducción y seguridad

Solo con autorización de ejecución y servicios locales activos:

```powershell
node scripts/rehearse_portal_local.mjs --local-ui-rehearsal
```

Es una prueba que crea y elimina datos efímeros locales; no es una consulta de solo lectura. Exige base compatible y vacía, correo local con autoconfirmación y aplicación local. No importa el spec heredado ni su configuración de entorno. Falla si detecta solicitudes externas, limpieza incompleta o discrepancias de identidad. Las credenciales efímeras permanecen en memoria y no se publican en resultados.

El parámetro no autoriza grabación. No ejecutar automáticamente tras leer este documento.

## Evidencia y estado temporal

- Correo: microprueba `avc-phase3-smoke-1c86d837-6e73-4a28-800d-6978b3f414a6`; conciliación del mensaje anterior `avc-phase3-mail-reconciliation-a254e2a8-e4d2-4169-97a1-5f2d980cc0cd`.
- Ensayo fallido conservado: `avc-training-df96871a-abf1-4007-9abe-fe8ce34c6021`. Se corrigió únicamente el adaptador para pulsar Abrir Caja; la limpieza de ese intento también fue aprobada.
- Ensayo completo: `avc-training-8aa7684b-4dda-4379-94d5-08212d7cd406`. Sus ocho fuentes principales y sus copias conservan sus SHA-256 al revisar el 17 de septiembre.
- Último estado de datos comprobado por ese ensayo: las ocho tablas contadas en cero y Mailpit con cero mensajes.
- Comprobación del 17 de septiembre: inicialmente Docker no estaba disponible. Fran abrió Docker Desktop durante la revisión; después se consultó PostgreSQL local en modo de solo lectura: las ocho tablas verificadas están vacías, hay 14 versiones de migraciones y Mailpit devuelve cero mensajes. No se observó listener de Nuxt en 3002. Astra no arrancó servicios ni repitió el ensayo para elaborar este informe.

Los resultados consolidados se preservan fuera de `test-results`, en la carpeta de entregables de Codex `outputs/phase3-final-2026-09-17`, con manifiesto de integridad. Los informes anteriores mantienen sus fechas y resultados originales.

## Límite operativo

**Rodaje maestro y sustitución de fotogramas: no autorizados, no ejecutados.** Antes de una futura ejecución autorizada deberá arrancarse Nuxt en modo local y revalidarse servicios y limpieza de la base. También deberá conectarse el ciclo de vida de la grabación (trazas/contextos/páginas/resultado real del runner) y validarse su cobertura de imágenes. No convertir un ensayo sin imágenes en una aprobación de traza.

La autorización de rodaje no implica automáticamente autorización de publicación o sustitución del portal. La revisión visual de Fran sigue siendo necesaria.
