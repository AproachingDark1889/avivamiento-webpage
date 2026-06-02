-- ============================================================================
-- MIGRACIÃ“N FASE 3: RevocaciÃ³n de DML (UPDATE) en public.orders
-- ============================================================================
-- DescripciÃ³n:
-- Se revoca el privilegio UPDATE directo sobre la tabla orders para los roles
-- pÃºblicos (anon, authenticated). A partir de este momento, cualquier mutaciÃ³n
-- de estado debe canalizarse de manera exclusiva a travÃ©s de los RPC blindados
-- (ej. update_kitchen_status), garantizando atomicidad y validaciÃ³n centralizada.
-- ============================================================================

REVOKE UPDATE ON public.orders FROM anon, authenticated;
