# Kaesuri · Variedades JYB

App de pedidos de Variedades JYB: ventas, alistamiento, despacho a domiciliarios, entregas con recaudo
y cuadres. Hecha con Ionic + Angular sobre Supabase.

## Roles

| Rol | Qué hace |
|---|---|
| Admin | Ve y cambia todo: pedidos, productos, usuarios, cuadres, reportes, actividad y configuración |
| Vendedor | Crea pedidos y ve los suyos |
| Despachador | Alista pedidos, los despacha con un domiciliario y confirma cuadres |
| Domiciliario | Ve sus pedidos en ruta, los entrega con el método de pago y entrega su cuadre |

## Datos

Todo vive en Supabase (proyecto Kaesuri): pedidos, productos, perfiles, cuadres, notificaciones y
auditoría. La seguridad la dan las políticas RLS y las funciones de la base (`crear_pedido`,
`entregar_pedido`, `cerrar_cuadre`…). La llave de `src/environments/` es la pública.

- `supabase/sql/`: los cambios de base de datos, uno por tema. Ya están aplicados en Supabase y se
  guardan como registro.
- `supabase/functions/`: funciones de Supabase (`enviar-push`, `jasta-puente`).

## Con Jasta

El domiciliario que también reparte para Jasta (con el mismo correo en las dos apps) ve sus pedidos de
Variedades JYB en "Mis entregas" de Jasta y los entrega desde allá. Lo hace la función `jasta-puente`
con las funciones `jasta_*` de la base (ver `supabase/sql/entregas_desde_jasta*.sql`). Los cuadres
siguen separados por negocio.

## Probar en tu computador

Necesitas Node 22 o más reciente.

```bash
git clone https://github.com/Araarasimpp/Kaesuri.git
cd Kaesuri
npm install
npm start          # http://localhost:4200
npm run build      # genera www/
```

Cada PR y cada cambio en `main` se compila en GitHub (`.github/workflows/compilar.yml`).
Vercel publica la app.
