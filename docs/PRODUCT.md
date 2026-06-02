# PRODUCT.md â€” Arquitectura de Negocio AvivaCheck POS

## VisiÃ³n General

AvivaCheck es un sistema POS multi-tenant diseÃ±ado para iglesias y organizaciones.
Cada organizaciÃ³n opera de forma completamente aislada (datos, usuarios, productos, Ã³rdenes)
mediante Row-Level Security (RLS) nativo de PostgreSQL.

---

## JerarquÃ­a de Roles

```
super_admin (admin@genesis.com)
  â””â”€â”€ pastor (dueÃ±o de iglesia â€” crea su org al registrarse)
        â””â”€â”€ leader (lÃ­der de departamento â€” opera como sub-tenant)
              â”œâ”€â”€ cashier (punto de venta)
              â””â”€â”€ kitchen (pantalla de cocina / KDS)
```

| Rol | Puede crear | Herencia de org | Accesos |
|-----|------------|-----------------|---------|
| `super_admin` | `pastor`, `leader` | N/A â€” org fija | Todo |
| `pastor` | `leader`, `cashier`, `kitchen` | Crea org nueva al registrarse | Todo dentro de su org |
| `leader` | `cashier`, `kitchen` | Hereda org del creador (o crea departamento propio vÃ­a RPC) | POS, KDS, Productos, Usuarios, Reportes |
| `cashier` | â€” | Hereda org del lÃ­der | POS, Corte de Caja |
| `kitchen` | â€” | Hereda org del lÃ­der | KDS |

---

## Departamentos como Sub-Tenants

Cada **lÃ­der** funciona como un departamento independiente:
- Tiene su propio catÃ¡logo de productos
- Tiene su propio catÃ¡logo de usuarios (cajeros + cocina)
- Sus Ã³rdenes son visibles SOLO en su KDS
- `owner_id` en `profiles` vincula al creador jerÃ¡rquico

### Ejemplo: Iglesia con 2 departamentos

```
Iglesia Avivamiento (org: Terminal Alpha)
â”œâ”€â”€ Departamento CafeterÃ­a (Leader: lÃ­der de cafeterÃ­a)
â”‚   â”œâ”€â”€ Productos: CafÃ© Americano, Pan Dulce, Agua Natural
â”‚   â”œâ”€â”€ Cajero: cajero.alpha@test.com
â”‚   â””â”€â”€ Cocina: cocina.alpha@test.com
â”‚
â””â”€â”€ Departamento Biblioteca (Leader: Lider@Biblioteca.com)
    â”œâ”€â”€ Productos: Biblia RVR, Cuaderno, Pluma Gel
    â”œâ”€â”€ Cajero: cajero.beta@test.com
    â””â”€â”€ Cocina: cocina.beta@test.com
```

> **Nota:** En la BD actual, Biblioteca opera como una organizaciÃ³n separada
> (`Iglesia Beta`) para garantizar aislamiento RLS total. Conceptualmente es
> un departamento de la misma iglesia, pero tÃ©cnicamente es un tenant aislado.

---

## Flujo de Venta (Checkout)

```mermaid
sequenceDiagram
    participant C as Cajero (Frontend)
    participant RPC as process_checkout (PostgreSQL)
    participant DB as Base de Datos
    participant KDS as Cocina (WebSocket)

    C->>RPC: sb.rpc('process_checkout', { items, payment, auto_accept })
    RPC->>DB: Validar auth.uid() + org_id
    RPC->>DB: Validar cada producto (exists + active + same org)
    RPC->>DB: Calcular total desde precios en DB (zero trust)
    RPC->>DB: INSERT orders (status: pending|completed)
    RPC->>DB: INSERT order_items (precios verificados)
    RPC-->>C: { success, order_id, total, status }
    DB-->>KDS: Realtime INSERT event (filtrado por org_id)
    KDS->>KDS: Renderizar orden en pantalla
```

### Regla de precio: Zero Trust

> **NUNCA se confÃ­a en el precio enviado por el frontend.**
> El RPC `process_checkout` busca el precio de cada producto directamente
> en la tabla `products` WHERE `org_id = user.org_id AND active = true`.
> Si el producto no existe, estÃ¡ inactivo, o pertenece a otra org â†’ EXCEPTION.

---

## Auto-Accept (Auto-Entrega)

### Â¿QuÃ© es?

El flag `auto_accept_orders` en el perfil de un cajero determina si sus ventas
pasan por la cocina (KDS) o se completan automÃ¡ticamente.

### Estado actual en el cÃ³digo

| Capa | Implementado | UbicaciÃ³n |
|------|-------------|-----------|
| **Columna en BD** | âœ… | `profiles.auto_accept_orders` (boolean, default false) |
| **RPC process_checkout** | âœ… | LÃ­nea 173: `v_status := CASE WHEN p_auto_accept THEN 'completed' ELSE 'pending' END` |
| **Frontend POS Store** | âœ… | `pos.ts` lÃ­nea 115: `const autoAccept = auth.profile?.auto_accept_orders === true` |
| **Frontend POS Store** | âœ… | `pos.ts` lÃ­nea 127: `p_auto_accept: autoAccept` (se pasa al RPC) |
| **UI Toggle en Usuarios** | âœ… | `users.vue` lÃ­nea 136-155: switch toggle para roles `cashier` y `leader` |
| **Toggle API** | âœ… | `users.vue` lÃ­nea 362-382: `toggleAutoAccept()` update directo en profiles |

### Flujo con auto_accept = true

```
Cajero vende â†’ process_checkout(p_auto_accept: true)
  â†’ INSERT orders con status = 'completed'
  â†’ Orden NUNCA aparece en KDS (completed â‰  pending)
  â†’ Venta registrada directamente como completada
```

### Flujo con auto_accept = false (default)

```
Cajero vende â†’ process_checkout(p_auto_accept: false)
  â†’ INSERT orders con status = 'pending'
  â†’ WebSocket notifica al KDS del mismo org_id
  â†’ Cocina ve la orden â†’ marca como 'completed' o 'rejected'
```

### Departamento de Biblioteca

El departamento de Biblioteca **SÃ puede usar auto-entrega** activando
`auto_accept_orders = true` en el perfil de su cajero. Esto tiene sentido
operativo porque la venta de libros no requiere preparaciÃ³n en cocina.

**Estado actual:** El toggle existe y funciona, pero solo estÃ¡ disponible
para roles `cashier` y `leader` en la UI de gestiÃ³n de usuarios.
El lÃ­der del departamento debe activarlo manualmente.

---

## Aislamiento Multi-Tenant

### RLS (Row-Level Security)

Toda tabla crÃ­tica tiene polÃ­ticas RLS que filtran por `org_id`:

| Tabla | Filtro RLS |
|-------|-----------|
| `profiles` | `org_id = get_my_org()` OR `owner_id = auth.uid()` OR `super_admin` |
| `products` | `org_id = get_my_org()` |
| `orders` | `org_id = get_my_org()` |
| `order_items` | via JOIN con `orders.org_id` |
| `cash_closures` | `org_id = get_my_org()` |

### WebSocket KDS

El canal de Realtime se suscribe con filtro explÃ­cito:

```javascript
// kds.vue lÃ­nea 492-497
channel(`kds:orders:${orgId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    table: 'orders',
    filter: `org_id=eq.${orgId}`  // â† filtro de tenant
  })
```

### Blindajes activos

- **P1:** Atomicidad checkout via `process_checkout` RPC (SECURITY DEFINER)
- **P2:** Zero Trust pricing â€” precios calculados exclusivamente en PostgreSQL
- **P3:** WebSocket KDS filtrado por `org_id` + watcher Pinia anti-race-condition
- **P4:** RLS multi-tenant nativo â€” tenant hijacking matemÃ¡ticamente imposible

---

## Estructura de Base de Datos

### Tablas principales

| Tabla | PropÃ³sito | Columna tenant |
|-------|-----------|---------------|
| `organizations` | Tenant raÃ­z | `id` (PK) |
| `profiles` | Usuarios | `org_id` â†’ organizations |
| `products` | CatÃ¡logo | `org_id` â†’ organizations |
| `orders` | Ventas | `org_id` â†’ organizations |
| `order_items` | Detalle de venta | `org_id` + FK a orders |
| `cash_closures` | Cortes de caja | `org_id` â†’ organizations |

### RPCs (SECURITY DEFINER)

| RPC | PropÃ³sito |
|-----|-----------|
| `process_checkout` | Checkout atÃ³mico ACID â€” valida precios, org, stock |
| `provision_user_profile` | Asigna org/role al crear usuario via UI (4 args) |
| `create_new_user_rpc` | Crea usuario + auth directo (inserta en auth.users) |
| `setup_new_tenant` | Signup: crea org + actualiza profile del pastor |
| `delete_user_cascade` | EliminaciÃ³n recursiva de usuario + subordinados |

---

## Stack TÃ©cnico

| Capa | TecnologÃ­a |
|------|-----------|
| Frontend | Nuxt 3 + Vue 3 + Pinia + Vuetify |
| Backend | Supabase (PostgreSQL 15 + Realtime + Auth) |
| Auth | Supabase Auth con RLS multi-tenant |
| Testing | Playwright (chaos isolation specs) |
| Puerto local | `localhost:3002` |
| Proyecto Supabase | `uvzntzuhhdaopudmxqme` |
