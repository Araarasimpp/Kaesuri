# Cuadres atrasados del domiciliario

Desde `kaesuri/`:

```
node cuadres-atrasados/aplicar.mjs
```

La pantalla de Cuadres del domiciliario muestra todos sus pedidos entregados sin cuadrar,
no solo los de hoy, y el botón pasa a decir "Cerrar cuadre". Funciona junto con el cambio
a `cerrar_cuadre` que ya quedó aplicado en Supabase (ver `cambios-supabase-aplicados.sql`).
Los originales quedan en `cuadres-atrasados/respaldo/<fecha>/`.
