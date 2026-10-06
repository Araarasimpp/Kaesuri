# Cuadres sin cerrar (Kaesuri) — misma solución que Home ALS

## 1. Base de datos
Supabase (proyecto Kaesuri) → SQL Editor → pega todo `1-ejecutar-en-supabase.sql` → Run.
Si Supabase avisa de "operaciones destructivas", es por el `drop function` de la versión vieja
de `cerrar_cuadre`: es esperado, dale "Run query".

## 2. App
Copia la carpeta `cuadres-sin-cerrar` dentro de `kaesuri/` y ejecuta:
```
node cuadres-sin-cerrar/2-aplicar-app.mjs
```
Luego `ionic serve`, commit y push. Originales en `cuadres-sin-cerrar/respaldo/`.

## Qué cambia
- En **Cuadres** (admin y despachador) aparece arriba la sección **Sin cerrar**, en vivo:
  por domiciliario y día, lo entregado que aún no está en un cuadre (efectivo, transferencia,
  domicilios, cuánto debe entregar y cuántos pedidos lleva en ruta).
- Botón **Cerrar cuadre** para cerrarlo en nombre del domiciliario.
- Cada noche a las **11:50 p. m.** se cierran solos los que queden abiertos.
- Cada cuadre muestra quién lo cerró si no fue el domiciliario ("Cerró Nicolás" / "Cierre automático").
- Aviso cuando hay cuadres pendientes de otros días y botones **Hoy** / **Todas las fechas**.
- El domiciliario recibe aviso cuando le cierran el cuadre.
- Si el domiciliario cierra con días atrasados, se crea un cuadre por cada día.
