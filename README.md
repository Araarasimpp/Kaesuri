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

Una persona puede tener varios roles (por ejemplo vendedor y domiciliario): el admin los marca en
Usuarios. Entra al área de su rol con más permisos y cambia de área con el botón de las flechas.
En la base, `profiles.roles` guarda todos y `tiene_rol(...)` es lo que revisan las políticas RLS y las
funciones; `profiles.role` queda como rol principal (lo calcula la base).

## Datos

Todo vive en Supabase (proyecto Kaesuri): pedidos, productos, perfiles, cuadres, notificaciones y
auditoría. La seguridad la dan las políticas RLS y las funciones de la base (`crear_pedido`,
`entregar_pedido`, `cerrar_cuadre`…). La llave de `src/environments/` es la pública.

- `supabase/sql/`: los cambios de base de datos, uno por tema. Ya están aplicados en Supabase y se
  guardan como registro.
- `supabase/functions/`: funciones de Supabase (`enviar-push`, `jasta-puente`).

## Con Jasta

Quien reparte para los dos negocios (con el mismo correo en las dos apps) ve los pedidos de ambos en
una sola ruta, en cualquiera de las dos apps, y entrega cada uno en el sistema que corresponde. Los
cuadres siguen separados por negocio ("Por cuadrar Variedades JYB" y "Por cuadrar Jasta"), porque el
efectivo va a cajas distintas.

- Pedidos de Variedades JYB en la app de Jasta: función `jasta-puente` de este proyecto y funciones
  `jasta_*` de la base (`supabase/sql/entregas_desde_jasta*.sql`).
- Pedidos de Jasta en esta app: función `kaesuri-puente` y funciones `kaesuri_*` del proyecto de Jasta
  (están en el repositorio de Jasta). Aquí los usa `JastaService`.
- Cada lado avisa al instante al otro cuando cambia un pedido o un cuadre del domiciliario.

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
