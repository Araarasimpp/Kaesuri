-- Cambios YA APLICADOS en Supabase (proyecto Kaesuri) el 3 oct 2026.
-- Se guardan aquí como registro; NO hace falta volver a ejecutarlos.

-- 1) cerrar_cuadre ahora incluye los pedidos entregados sin cuadrar de días anteriores
--    (antes solo los del día p_fecha; los atrasados quedaban por fuera para siempre).
--    Cambio: se quitó la condición "entregado_at >= inicio del día".

-- 2) Seguridad
--    • trigger trg_proteger_perfil (función proteger_perfil): solo un admin puede cambiar
--      role / activo / id de un perfil desde la app.
--    • trigger trg_proteger_pedido_domiciliario (función proteger_pedido_domiciliario):
--      el domiciliario solo puede cambiar estado (en_ruta/entregado), entregado_at,
--      metodo_pago y comprobante_url, y nada si el pedido ya está en un cuadre.
--    • se eliminó la política "pedido_items: vendedor/admin insert": los productos de un
--      pedido solo entran por la función crear_pedido (valida stock y precios).

-- 3) Datos: se crearon cuadres pendientes para los pedidos #49 y #51 (Yeison, 1 oct),
--    #53 (Yeison, 2 oct) y #59 (Santiago, 2 oct).
