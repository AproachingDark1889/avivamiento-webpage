# Propuesta: conciliacion operativa de cierre de caja

## Contexto

La auditoria actual separa dos verdades importantes:

- El cierre financiero base esta razonablemente blindado.
- El cierre operativo todavia esta ciego.

Hoy el backend calcula el cierre desde `pre_close_cash_session` usando las ordenes de la sesion:

```text
orders.cash_session_id = cash_session actual
orders.financial_status = 'paid'
```

Eso permite responder bien:

```text
Cuanto dinero deberia existir en esta caja?
```

Pero no permite responder con suficiente control:

```text
Esa venta debio contar?
Quien vendio cada producto?
La cocina rechazo o cancelo algo?
Hubo devolucion?
Debe anularse, corregirse o reasignarse una venta?
Que venta explica la diferencia?
```

La solucion no debe ser excluir automaticamente ventas rechazadas por cocina. Una orden `kitchen_rejected` puede seguir siendo dinero real en caja si el cliente pago y aun no se hizo devolucion. La solucion correcta es convertir el cierre en una conciliacion: mostrar la venta, marcarla para revision y exigir una decision explicita del lider.

## Principio de diseno

El cierre debe separar tres dimensiones:

```text
1. Estado operativo
   pending
   completed
   kitchen_rejected
   kitchen_cancelled
   auto_fulfilled

2. Estado financiero
   paid
   refunded
   voided
   partially_refunded
   pending_refund

3. Estado de revision de cierre
   normal
   needs_review
   corrected
   excluded
   approved_with_note
   rejected_by_leader
```

AvivaCheck ya tiene parte de las primeras dos dimensiones. Falta la tercera: una capa de revision y decision del cierre.

## Objetivo de la solucion

Mantener la flexibilidad operativa:

```text
Todos pueden vender lo visible segun el modelo actual.
El sistema no bloquea preventivamente cada caso ambiguo.
El lider revisa, decide y deja evidencia al cierre.
```

Pero agregar control:

```text
Cada venta pagada aparece en el cierre.
Cada venta sospechosa queda marcada.
Cada correccion exige motivo.
Cada cambio queda en bitacora.
Los totales financieros se recalculan con reglas explicitas.
```

## Modelo propuesto

### 1. Mantener cash_session como unidad financiera

La `cash_session` sigue siendo la unidad de cierre:

```text
Caja general:
  mode = shared
  department_owner_id = lider/departamento
  cashier_id = null

Caja independiente:
  mode = independent
  department_owner_id = lider/departamento
  cashier_id = cajero
```

Cada orden sigue ligada a una caja por:

```text
orders.cash_session_id
```

Esto evita romper el cierre financiero actual.

### 2. Agregar una capa de conciliacion por venta

El cierre debe mostrar una tabla de ventas de la sesion:

```text
hora
vendedor real
productos
total
metodo de pago
financial_status
operational_status
review_status
motivo / notas
acciones disponibles
```

Ejemplo esperado:

```text
10:12 | Cajero A | Agua x3        | $45  | cash | paid | auto_fulfilled     | normal
10:18 | Cajero A | Hamburguesa x1 | $85  | cash | paid | auto_fulfilled     | needs_review
10:21 | Cajero B | Hamburguesa x2 | $170 | card | paid | completed          | normal
10:25 | Cajero B | Agua x1        | $15  | cash | paid | kitchen_cancelled  | needs_review
```

### 3. Marcar revision obligatoria sin decidir automaticamente

Regla recomendada:

```text
Si operational_status in ('kitchen_rejected', 'kitchen_cancelled'):
  review_status = needs_review
  la venta sigue contando si financial_status = paid
```

Esto evita el error de sacar dinero del cierre sin saber si hubo devolucion.

Tambien pueden marcarse como `needs_review`:

```text
ventas auto_fulfilled de productos o categorias sensibles
ventas hechas por un vendedor fuera de su funcion esperada
ventas con total inusual
ventas corregidas manualmente
ventas con devolucion pendiente
```

La marca de revision no bloquea por si sola. Obliga al lider a decidir antes de cerrar definitivamente.

## Acciones de cierre propuestas

### Aprobar venta

Uso:

```text
La venta fue correcta aunque parezca inusual.
```

Resultado:

```text
review_status = normal o approved_with_note
financial_status no cambia
la venta sigue contando
requiere nota si venia marcada como needs_review
```

### Marcar irregular

Uso:

```text
La venta ocurrio, pero el lider quiere dejar constancia.
```

Resultado:

```text
review_status = approved_with_note
financial_status sigue paid
la venta sigue contando
motivo obligatorio
```

### Anular venta

Uso:

```text
La venta no debe contar financieramente y no hubo dinero real que conservar.
```

Resultado:

```text
financial_status = voided
review_status = corrected
se excluye de ventas y efectivo esperado
motivo obligatorio
bitacora obligatoria
```

### Reembolsar venta

Uso:

```text
El cliente pago y se devolvio dinero.
```

Resultado:

```text
financial_status = refunded o partially_refunded
review_status = corrected
el efectivo esperado se ajusta por el monto devuelto
motivo obligatorio
registrar metodo y monto de devolucion
```

### Reasignar venta

Uso:

```text
La venta fue registrada por el vendedor o caja incorrecta.
```

Resultado posible:

```text
created_by corregido o vendedor_responsable asignado
cash_session_id corregido si aplica
review_status = corrected
motivo obligatorio
bitacora obligatoria
```

Esta accion debe ser restringida, porque puede afectar responsabilidad financiera.

### Aprobar caja con observacion

Uso:

```text
Hay diferencias o incidencias, pero el lider acepta el cierre.
```

Resultado:

```text
cash_session.status = closed
notes obligatorias si hay difference != 0 o ventas needs_review resueltas con observacion
approved_by y approved_at quedan guardados
```

### Devolver cierre a revision

Uso:

```text
El lider no acepta el cierre como esta.
```

Resultado recomendado:

```text
cash_session.status = rejected o returned_for_revision
motivo obligatorio
la caja no queda cerrada definitivamente
el cajero debe corregir o aclarar
```

Este estado no existe hoy y seria parte del cambio.

## Calculo financiero propuesto

El calculo actual:

```text
efectivo esperado = fondo inicial + ventas en efectivo pagadas
diferencia = efectivo contado - efectivo esperado
```

Debe evolucionar a:

```text
ventas pagadas en efectivo
- ventas anuladas
- devoluciones en efectivo
+ ajustes autorizados
= efectivo operativo esperado

efectivo contado - efectivo operativo esperado = diferencia final
```

Las ventas con tarjeta y transferencia deben mantenerse separadas:

```text
total_cash_sales
total_card_sales
total_transfer_sales
refunds_by_method
adjustments_by_method
```

## Cambios conceptuales de datos

No es propuesta de migracion exacta, sino modelo funcional minimo.

### Opcion A: columnas en orders

Agregar a `orders`:

```text
review_status
review_reason
reviewed_by
reviewed_at
refund_amount
voided_by
voided_at
void_reason
```

Ventaja:

```text
Mas simple para MVP.
```

Desventaja:

```text
Menos historial si una venta se corrige varias veces.
```

### Opcion B: tabla de revisiones/correcciones

Crear algo equivalente a:

```text
order_review_actions
```

Campos conceptuales:

```text
id
order_id
cash_session_id
action_type
previous_financial_status
new_financial_status
previous_review_status
new_review_status
amount_delta
reason
created_by
created_at
metadata
```

Ventaja:

```text
Audit trail real.
Permite multiples acciones sobre una misma venta.
Mejor para responsabilidad del lider.
```

Desventaja:

```text
Mas trabajo que columnas directas.
```

Recomendacion: usar Opcion B para acciones financieras y, si hace falta, cachear el estado actual en `orders`.

## UI propuesta para cashClosing

La pantalla de cierre deberia tener cuatro bloques:

### 1. Resumen financiero

```text
fondo inicial
ventas efectivo
ventas tarjeta
ventas transferencia
devoluciones
ajustes
efectivo esperado
efectivo contado
diferencia
```

### 2. Ventas de la caja

Tabla filtrable:

```text
Todas
Necesitan revision
KDS rechazadas/canceladas
Auto-completadas
Por vendedor
Por metodo de pago
Por producto/categoria
```

### 3. Panel de decision

Acciones por venta:

```text
aprobar
marcar irregular
anular
reembolsar
reasignar
agregar nota
```

### 4. Aprobacion de caja

Reglas:

```text
No permitir aprobar si hay ventas needs_review sin resolver.
Si hay diferencia != 0, exigir nota.
Si hubo correcciones, mostrar resumen antes de cerrar.
```

## Comportamiento por tipo de caja

### Caja general

El lider debe ver:

```text
todas las ventas de la cash_session shared
vendedor real de cada venta
productos de cada venta
ventas marcadas para revision
diferencias por metodo de pago
```

Esto resuelve el problema de varios cajeros vendiendo en la misma caja general.

### Caja independiente

El lider debe ver:

```text
la caja del cajero
ventas del cajero
incidencias operativas
devoluciones/anulaciones
diferencia de efectivo
```

La aprobacion debe ser individual por caja independiente.

## Fases recomendadas

### Fase 1: caracterizacion sin cambiar comportamiento

Crear tests que documenten el comportamiento actual:

```text
caja general con varios cajeros
caja independiente
kitchen_rejected sigue contando si paid
cash_session_id obligatorio
leader aprueba caja pendiente
no existe rechazo/correccion granular
```

### Fase 2: detalle read-only en cierre

Antes de permitir correcciones, mostrar:

```text
ventas individuales
productos
vendedor real
operational_status
financial_status
cash_session_id
flags de revision
```

Esta fase ya daria visibilidad inmediata sin tocar la contabilidad.

### Fase 3: revision obligatoria

Agregar:

```text
review_status
needs_review automatico para kitchen_rejected/kitchen_cancelled
notas obligatorias para aprobar incidencias
bloqueo de aprobacion si quedan ventas sin revisar
```

### Fase 4: acciones financieras controladas

Agregar:

```text
void
refund
partial_refund
ajustes autorizados
audit trail
recalculo del efectivo esperado corregido
```

### Fase 5: rechazo/devolucion de cierre

Agregar:

```text
returned_for_revision o rejected
motivo obligatorio
flujo para que el cajero/lider corrija y reenvie
```

## Que no conviene priorizar ahora

No conviene empezar por permisos preventivos por cajero/producto.

Razones:

```text
puede bloquear operaciones legitimas
requiere UI administrativa pesada
no resuelve devoluciones ni anulaciones
no resuelve kitchen_rejected pagado
no crea audit trail
```

Tampoco conviene empezar por excluir automaticamente estados de cocina:

```text
kitchen_rejected no siempre implica devolucion
kitchen_cancelled no siempre implica anulacion financiera
el dinero puede seguir en caja
```

## Veredicto

La direccion recomendada es:

```text
Mantener el calculo financiero actual como base.
Agregar conciliacion operativa granular en cashClosing.
No bloquear preventivamente como primera solucion.
No excluir automaticamente ventas rechazadas por cocina.
Exigir decision explicita del lider con motivo y bitacora.
```

La prioridad deberia ser:

```text
1. detalle de ventas en cierre
2. marcas needs_review
3. aprobacion con motivo
4. anulacion/reembolso controlado
5. audit trail
6. rechazo/devolucion de cierre
```

Esto convierte el cierre de caja de una suma agregada en una conciliacion real.
