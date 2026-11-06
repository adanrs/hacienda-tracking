# Credenciales del sistema — plantilla (sin valores reales)

> Este archivo es solo la plantilla. Las credenciales reales NO van en el repo: van en el
> `.env` del servidor (`/opt/kiwi/.env` en kiwi-cloud) o en el gestor de contraseñas.
> Si hace falta una copia local, guardarla como `CREDENCIALES.md` (está en `.gitignore`).

## Usuarios iniciales (los crea el seed)

| Usuario         | Contraseña                                   | Rol      |
|-----------------|----------------------------------------------|----------|
| admin.tempisque | `ADMIN_PASSWORD` (si falta, el seed genera una al azar y la muestra una vez) | admin    |
| operador.campo  | `OPER_PASSWORD` (ídem)                       | operador |
| integracion.tienda | — (no inicia sesión; lo crea initDB)      | servicio |

## Roles

- **admin**: acceso total, incluida la gestión de usuarios.
- **operador**: registra y edita datos.
- **viewer**: solo lectura (la API rechaza POST/PUT/DELETE).
- **servicio**: usuario técnico de la integración con la tienda. No recibe JWT; solo actúa por
  `/api/integracion/tienda/*` con firma HMAC.

## Variables de entorno del backend

```env
# Obligatoria: sin ella el backend no arranca. Generar con: openssl rand -hex 32
JWT_SECRET=<64 caracteres hex>
ADMIN_PASSWORD=<solo para el seed inicial>
OPER_PASSWORD=<solo para el seed inicial>

# Integración con la tienda (docs/integracion-tienda/README.md)
INTEGRACION_TIENDA_MODO=apagado            # apagado | sombra | encendido
INTEGRACION_TIENDA_SECRET=<openssl rand -hex 32>
# Rotación: INTEGRACION_TIENDA_SECRET=tienda-v2:<nuevo>,tienda-v1:<viejo>
```
