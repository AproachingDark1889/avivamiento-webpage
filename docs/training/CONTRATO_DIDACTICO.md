# Contrato didáctico de los nueve procedimientos

Versión 2. Fecha: 14 de septiembre de 2026 (America/Mexico_City).
Revisión autorizada por Fran: caja independiente de Sofía, habilitada por Marcos desde Gestión de Usuarios antes del módulo 9. Se mantiene el rescate del líder y todos los invariantes financieros. La versión anterior se preserva en los entregables de Fases 0–2 y de preparación de Fase 3.
Implementación ejecutable: `scripts/portal/contracts.mjs`: 9 módulos, 12 segmentos, 36 hitos obligatorios. El nuevo segmento `9/reopen` atribuye a Sofía la reapertura; Marcos no puede abrir una caja independiente haciéndose pasar por ella.
Estado de ejecución: consultar el informe final de preparación y su resultado de ensayo; la aprobación del contrato no autoriza grabación.

## Qué enseñamos y qué no prometemos

La capacitación enseña tareas comprobables, no una etiqueta de “blindaje total”. El pastor dirige; los líderes administran su departamento; los cajeros cobran y realizan el pre-cierre permitido; Cocina recibe y entrega comandas. Un permiso de navegación no reemplaza las restricciones de PostgreSQL.

La frase editorial general es: **Servir con claridad: cada operación, cada responsabilidad y cada resultado tienen un lugar.**

No se incorporan aquí progreso adaptativo, certificados, cambios al README principal ni rediseño del portal. Los textos siguientes son un guion propuesto para revisión de Fran, no subtítulos ya publicados.

## Permisos y restricciones comprobados en fuente

- `app/stores/auth.ts:59`: POS para cashier/leader/pastor/super_admin. KDS para kitchen/leader/pastor/super_admin. Administración de productos y usuarios para liderazgo, no para cajero o cocina.
- `supabase/migrations/20260609000100_harden_products_and_staff_sessions.sql:1`: políticas de escritura de productos con organización, propietario departamental y rol permitido. No se alteraron para producir escenas.
- `supabase/migrations/20260602000100_cash_sessions_mvp.sql:125`: contexto derivado del perfil; el propietario departamental es el propio usuario de liderazgo o el owner_id del personal. Una caja independiente requiere un cajero habilitado; una compartida corresponde al departamento.
- En la misma migración, `:548`: el cajero puede pre-cerrar su independiente o la compartida que abrió. No cualquier cajero de una compartida. Liderazgo autorizado puede intervenir según organización/departamento.
- En la misma migración, `:646`: aprobación de cierre para pastor/super_admin o líder del departamento; un cajero no obtiene aprobación final por poder abrir la pantalla de corte.
- `supabase/migrations/20260901000100_financial_invariants_and_error_contract.sql:247`: lectura del precio del producto en la base de datos con org/departamento; `:280`: cambio calculado por el servidor; `:287`: orden y partidas vinculadas a sesión.
- `app/pages/page/POS/kds.vue:434`: entrega mediante `update_kitchen_status`, con estado operativo `completed`. La venta directa usa `auto_fulfilled`; no son sinónimos.

Estas son propiedades del checkout local revisado. No demuestran qué migraciones están aplicadas en la instancia Docker ni en un despliegue remoto.

## Personajes e identidades

Congregación ficticia propuesta: **Comunidad Cristiana Monte de Sion**. Su nombre visible no se usará como clave para limpieza.

| Personaje ficticio | Identidad operativa |
|---|---|
| Pastor David Ramos | Pastor y registro inicial |
| Líder Daniel Soto | Recursos y Librería; venta directa |
| Líder Marcos Peña | Cafetería; contingencia de su departamento |
| Líder Samuel Castro | Comedor; personal, catálogo y aprobación |
| Cajera Sofía Mendoza | Cafetería; caja del escenario $50 + $45 |
| Cajero Isaac Díaz | Comedor; venta con comanda y pre-cierre |
| Cocinero Andrés Cruz | Cocina; recepción y despacho |

Los nombres son personajes, no datos de personas reales. Los correos técnicos conservarán un sufijo único de ejecución. Para la captura local se propone un dominio reservado como `training.avivacheck.invalid`, con entrega verificada únicamente a Inbucket. El dominio por sí solo no demuestra aislamiento. La campaña heredada todavía contiene direcciones `demo.avivacheck.org`; no se ejecutará hasta verificar el destino de Auth/correo y preparar las identidades locales.

Los IDs reales de organización, perfiles, productos, órdenes y sesiones se registrarán al confirmarlos. El alias `entityKey` permite marcar una escena antes de conocer su ID definitivo; el recibo final debe resolverlo a `entityId`. Dos segmentos de una misma caja no pueden cambiar silenciosamente de entidad.

## Guion cerrado por módulo

| Módulo y actor | Precondiciones y entidad | Inicio → acciones obligatorias → resultado | Texto propuesto |
|---|---|---|---|
| 1. Congregación — Pastor David | Identidad ficticia nueva; organización aún inexistente. Entidad: organización. | Formulario de registro → configuración inicial → comprobar perfil de pastor, org_id y departamento inicial. Hitos: registration, configuration, organization_verified. | “Comenzamos por la congregación: una identidad clara y un espacio propio para organizar el servicio.” |
| 2. Personal — Líder Samuel | Pastor ya creó el liderazgo. Entidad: perfil nuevo de su departamento. | Formulario de personal → selección de rol y asignación → comprobar perfil, org_id y owner_id. staff_form, role_assignment, profile_verified. | “Asignar una función es también delimitar una responsabilidad.” |
| 3. Catálogo — Líder Samuel | Permiso departamental. Producto demostrativo: Taco de Guisado, $55. Entidad: producto. | Formulario → precio guardado → comprobar precio persistido y catálogo visible. product_form, price_saved, catalog_verified. | “El precio se administra una vez y el servidor lo utiliza al cobrar.” |
| 4. Apertura — Cajero Isaac | Sin sesión bloqueante en su modalidad. Principal: compartida abierta por Isaac. Entidad: sesión. | Formulario → fondo inicial → comprobar ID, org/departamento, modalidad y estado open. opening_form, opening_cash, session_open_verified. | “El fondo inicial queda separado de las ventas del turno.” |
| 5. Cobro — Cajero Isaac | Misma caja abierta; autoentrega desactivada para demostrar KDS. Entidad: orden. | Carrito Taco $55 → recibido $100 → comprobar total $55, cambio $45, orden paid, sesión y partidas. cart, payment, order_and_change_verified. | “El cajero recibe el efectivo; la base de datos confirma el importe y el cambio.” |
| 6. Cocina — Andrés | Orden exacta del módulo 5 en pending; mismo departamento. Entidad: esa orden. | Comanda visible → ENTREGAR → comprobar transición a completed y vista de entregadas. order_received, dispatch, operational_result_verified. | “La cocina ve lo que debe preparar y deja constancia de lo que entrega.” |
| 7. Venta directa — Líder Daniel | Caja de Librería abierta; autoentrega autorizada sin sesión bloqueante al configurarla. Entidad: orden. | Comprobar autorización de autoentrega → Biblia RVR 1960 $150, recibido $200 → orden paid/auto_fulfilled y cambio $50, sin comanda pendiente. auto_fulfillment_enabled, direct_payment, auto_fulfilled_verified. | “Una entrega directa queda registrada, sin convertirla en una tarea de cocina.” |
| 8. Cierre ordinario — Isaac y después Samuel | Sesión exacta del Comedor; Isaac es quien abrió la compartida. Entidad: misma sesión en ambos segmentos. | Contar → pre-cerrar → pending_validation; cambiar al líder → revisar sumas → aprobar → closed. counting, ordinary_preclose, pending_verified; review_totals, ordinary_approval, closed_verified. | “El cajero cuenta y presenta; el liderazgo revisa y valida. Son dos responsabilidades.” |
| 9. Contingencia — Sofía, Marcos y regreso de Sofía | Previamente Marcos habilita Caja independiente: ON en Gestión de Usuarios, con RPC y perfil verificados. Sesión nueva independiente de Sofía en Cafetería, sin ventas previas; misma sesión en abandono y rescate, `cashier_id = opened_by = Sofía`. | Fondo $50 → Café Americano $45, recibido $100 y cambio $55 → retiro simulado; Marcos abre diálogo específico → justificación y conteo $95 → pre-cierre → aprobación → misma sesión cerrada/diff $0; Sofía vuelve y abre otra independiente con ID distinto. Segmentos: abandon (opening_50, sale_45, departure); rescue (contingency_dialog, justification_and_95, contingency_preclose, contingency_approval, same_session_closed); reopen (new_session_unblocked). | “Si un voluntario debe retirarse, el liderazgo puede recuperar el turno con motivo y conteo explícitos.” |

Una navegación a `about:blank` representa retiro simulado, **no** una caída de red demostrada. Rechazos/cancelaciones KDS y carreras concurrentes pertenecen a otras pruebas; no se usarán escenas de ellas como reemplazo de una entrega exitosa.

Los módulos 4 y 8 usan una caja compartida del Comedor: fondo $100, venta $55 y conteo $155. El módulo 9 usa independiente. No son modalidades intercambiables: el recibo v2 rechaza `shared`, habilitación no comprobada en UI o discrepancia entre `cashier_id` y `opened_by`. La grabación futura debe respetar los tres contextos/segmentos de ese módulo.

## Invariante financiero exacto de contingencia

En el esquema revisado **no existe `cash_movements`**. El cálculo de cierre usa órdenes con `financial_status = 'paid'` vinculadas al `cash_session_id`. La migración considera efectivo cuando payment_method es cash o NULL; el escenario didáctico exige cash explícito.

Para la sesión S:

```
fondo(S)                      = 5000 centavos
mode(S)                       = independent
cashier_id(S) = opened_by(S)   = id de Sofía
preclosed_by(S) = approved_by(S) = id de Marcos
suma de órdenes pagadas cash  = 4500 centavos
expected_cash(S)              = 9500 centavos
cash_counted(S)               = 9500 centavos
difference(S)                 = 0
status(S)                     = closed
id(nueva sesión abierta)      != S
cashier_id(nueva sesión)      = id de Sofía
```

Con recibido $100 en la venta de $45, el cambio es $55 y el ingreso neto $45. No se suman los $100 como venta y no se resta el cambio una segunda vez del total. El test debe comprobar las partidas de esa orden y la misma sesión, no cualquier caja cerrada del departamento.

## Contrato de evidencia visual

- Cada segmento tiene grupo de traza explícito y cada hito un subgrupo emparejado before/after.
- Se registran runId, actorId, contexto, página, módulo, segmento y entidad. Un actor no se infiere por posición de archivo.
- Debe existir al menos un screencast-frame dentro de cada hito. Un screenshot aislado no sustituye automáticamente ese requisito.
- Las comprobaciones finales consultarán el resultado real dentro del entorno autorizado, no confiarán solo en una animación optimista de la UI.
- El pipeline conserva todos los frames observados del intervalo. No rellena a 160, no elimina repeticiones sin declararlas y no usa porcentajes arbitrarios de la traza.
- Aprobar el contrato y el raster no acredita legibilidad ni cobertura humana completa: Fran conserva la revisión visual antes de integrar cualquier candidato.
