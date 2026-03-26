# Credenciales del Sistema - Hacienda Tempisque

## Usuarios por defecto (creados con seed)

| Usuario           | Password            | Rol       | Permisos                              |
|-------------------|---------------------|-----------|---------------------------------------|
| admin.tempisque   | HT$2026!Adm1n#Tmp  | admin     | CRUD completo + gestion de usuarios   |
| operador.campo    | HT$2026!0per#Tmp    | operador  | CRUD de animales, pesajes, salud, etc |

## Roles del sistema

- **admin**: Acceso total. Puede crear/editar/eliminar usuarios y todos los datos.
- **operador**: Puede registrar y editar datos de animales, pesajes, salud, movimientos y reproduccion.
- **viewer**: Solo lectura. Puede ver el dashboard y consultar datos pero no modificar nada.

## Puertos

| Servicio  | Puerto | URL Local                  |
|-----------|--------|----------------------------|
| Frontend  | 8000   | http://localhost:8000      |
| Backend   | 8001   | http://localhost:8001/api  |

## Variables de entorno (produccion)

```env
JWT_SECRET=<cambiar-a-un-secret-seguro-de-64-chars>
ADMIN_PASSWORD=<password-del-admin-en-produccion>
OPER_PASSWORD=<password-del-operador-en-produccion>
NODE_ENV=production
```

## JWT

- Token expira en 24 horas
- Bcrypt rounds: 12
- Secret key configurable via `JWT_SECRET`

## IMPORTANTE

1. Cambiar TODAS las credenciales antes de pasar a produccion en Azure
2. Configurar `JWT_SECRET` como variable de entorno en Azure Container Apps
3. Las passwords deben tener minimo 8 caracteres, mayusculas, numeros y simbolos
