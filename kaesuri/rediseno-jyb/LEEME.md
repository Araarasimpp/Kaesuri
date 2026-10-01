# Rediseño Variedades JYB (estilo estándar)

## Cómo aplicarlo
1. Copia la carpeta `rediseno-jyb` dentro de `kaesuri/` (al lado de `src/`).
2. Desde `kaesuri/` ejecuta:
   ```
   node rediseno-jyb/aplicar-rediseno.mjs
   ```
3. Prueba con `ionic serve` y revisa cada rol.
4. Si algo no te gusta, los originales quedan en `rediseno-jyb/respaldo/<fecha>/`.
5. No subas la carpeta `rediseno-jyb` al repo (bórrala cuando termines).

## Qué cambia
- **Tema** (`src/theme/kaesuri-theme.scss`): fondo gris claro, tarjetas blancas, un solo
  color de acción (verde `#0f7b5f`), chips de estado fijos y modo oscuro ajustado.
- **Menú lateral** (admin y despachador): blanco, con el logo real (`assets/icon/logo.png`).
- **Barra inferior en celular**: blanca, con el botón "+" en verde.
- **Login y registro**: tarjeta centrada con el logo grande. Se quitó el campo de
  teléfono que estaba repetido en el registro.
- **Pedidos** (admin y despachador): cada pedido muestra sus productos con foto
  (toca la foto para verla en grande), contador por estado, búsqueda por cliente o producto.
- **Rótulo**: ahora toma nombre, teléfonos, redes y garantía de **Configuración**
  (tabla `configuracion`) en vez de estar escrito en el código. El logo del rótulo
  pasó de 64 px a 120 px.
- **Configuración**: vista previa del rótulo en vivo mientras escribes y botón
  "Imprimir rótulo de prueba".
- **Resto de páginas**: se adaptan solas al nuevo tema (botones verdes, chips, focos).

## Archivo nuevo
- `src/app/shared/rotulo.service.ts`: arma e imprime los rótulos. Lo usan pedidos
  (admin y despachador) y Configuración.

## Si el despachador no ve los datos del negocio en el rótulo
El rótulo lee la tabla `configuracion`. Si tu política RLS solo deja leerla al admin,
el despachador imprimirá con los datos de respaldo. Para que lea los reales:
```sql
create policy "leer configuracion autenticados" on public.configuracion
  for select to authenticated using (true);
```
