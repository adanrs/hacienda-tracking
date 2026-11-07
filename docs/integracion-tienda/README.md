# Integración tienda ↔ ganadería — contrato (v1, fase 1)

Lado ganadería (`hacienda-tracking`). El diseño completo, aprobado el 05-nov-2026, está en
`integracion-tienda-ganaderia.md` (entregas de Wagyu Cross). Este documento describe lo que
**ya está implementado** en el backend y cómo lo consume la tienda (`wagyu-demo`).

Reglas de fondo:

- Ganadería es la fuente de la identidad y la trazabilidad de la pieza. La tienda es la fuente
  del estado comercial dentro de WC-01.
- La tienda es el **único cliente**. Empuja eventos (`POST /eventos`) y consulta lo despachado
  (`GET /despachos`). Ganadería nunca llama a la tienda.
- La llave común es la **etiqueta**: `codigo` (código crudo normalizado: mayúsculas, sin espacios)
  más `copia` (entero, 1 por omisión). Nunca se cruzan ids autoincrementales.

## 1. Red y exposición

- La tienda llama por la red docker interna `kiwi_internal`:
  `GANADERIA_API_URL=http://kiwi-hacienda-backend:8001/api/integracion/tienda`.
- Cualquier petición a estas rutas que traiga `cf-ray`, `cf-connecting-ip`, `cf-ipcountry`,
  `cf-visitor` o `cdn-loop: cloudflare` recibe **404**: llegó desde internet por el túnel. Este
  chequeo va antes que todos los demás.
- Recomendado además: una regla en el túnel o el WAF de Cloudflare que bloquee
  `/api/integracion/*` en el hostname público del backend.

## 2. Autenticación (HMAC-SHA256)

Encabezados obligatorios en cada petición:

| Encabezado | Valor |
|---|---|
| `X-Integracion-Clave` | Id de la clave, p. ej. `tienda-v1` |
| `X-Integracion-Fecha` | Epoch en milisegundos (13 dígitos). Se rechaza si difiere más de ±5 min de la hora del servidor |
| `X-Integracion-Firma` | `hex(HMAC-SHA256(secreto, fecha + "\n" + MÉTODO + "\n" + ruta_con_query + "\n" + sha256hex(cuerpo_crudo)))` |
| `Idempotency-Key` | Opcional en `POST /eventos`. Si viene, tiene que ser igual a `clave` |

- `ruta_con_query` es la ruta **completa** que recibe ganadería, con el prefijo
  `/api/integracion/tienda` y la query tal como se envía (sin reordenar). Por ejemplo,
  `/api/integracion/tienda/despachos?limite=50&cursor=…`.
- `cuerpo_crudo` son los bytes exactos enviados (cadena vacía en un `GET`). Ganadería verifica la
  firma antes de parsear el JSON.
- Vectores de prueba: `backend/test/fixtures/integracion-firma-vectores.json`. La tienda tiene
  que reproducirlos byte a byte en su propia suite (mismo archivo en los dos repos).
- Variable: `INTEGRACION_TIENDA_SECRETO`, el nombre del diseño. `INTEGRACION_TIENDA_SECRET` se
  acepta como alias, con un aviso en el log.
- **Rotación**: `INTEGRACION_TIENDA_SECRETO` acepta un secreto solo (id `tienda-v1`) o una lista
  `tienda-v2:<nuevo>,tienda-v1:<viejo>`. Primero se agrega la clave nueva en ganadería, después se
  cambia la tienda a `tienda-v2` y al final se quita la vieja. Cada secreto debe tener al menos 32
  caracteres (`openssl rand -hex 32`). Un secreto más corto se descarta y se avisa en el log, sin
  mostrar su valor.

Respuestas de autenticación:

| Código | Cuerpo | Cuándo |
|---|---|---|
| 404 | `{error:'No encontrado'}` | Viene por Cloudflare |
| 503 | `{error:'integracion_apagada'}` | `INTEGRACION_TIENDA_MODO=apagado`, vacío o con un valor desconocido |
| 503 | `{error:'integracion_sin_configurar'}` | Falta el secreto o es inválido |
| 503 | `{error:'integracion_sin_usuario_servicio'}` | No existe el usuario `integracion.tienda` con rol `servicio` |
| 401 | `{error:'firma_invalida', motivo}` | `motivo`: `encabezados`, `clave_desconocida`, `fecha_fuera_de_ventana` o `firma` |

La tienda trata el 401 como **reintentable con alerta**, no como error permanente: casi siempre es
un secreto mal configurado y no conviene descartar eventos por eso.

## 3. Interruptor

`INTEGRACION_TIENDA_MODO` (en el `.env` del backend; se lee en cada petición):

| Modo | Efecto |
|---|---|
| `apagado` (por omisión) | Todo responde 503 |
| `sombra` | `GET` normales. `POST /eventos` valida, revisa las etiquetas en modo solo lectura, registra el evento en `integracion_eventos` y responde. **No mueve inventario** |
| `pruebas` | Como `encendido`, pero solo con datos PRUEBA: `GET /despachos` muestra solo órdenes `es_prueba = 1`, y `traslado.recibido` se aplica solo si la orden es de prueba (si no, 422 `solo_pruebas`). Los demás tipos se registran como en sombra |
| `encendido` | `GET` normales. `traslado.recibido` se aplica (procesador de la fase 2, `lib/integracion/procesadorTraslado.js`). Los demás tipos responden 503 `procesadores_no_disponibles` mientras no exista su procesador. Así ningún evento queda guardado como «visto» sin haberse aplicado |

Un evento guardado en modo sombra **no cuenta como aplicado** (`integracion_eventos.estado =
'registrado'`, `modo = 'sombra'`). Cuando lleguen los procesadores, un reenvío de esa clave en modo
encendido tiene que aplicarse (y no devolver el resultado de la sombra).

## 4. Endpoints (prefijo `/api/integracion/tienda`)

### `GET /salud`

`200 {contrato:'1', ahora:<ISO>, modo}`. Ping firmado para comprobar la red, el secreto y el modo.

### `GET /despachos?cursor=<opaco>&limite=<1..200, 50 por omisión>`

Órdenes de salida **despachadas** con bodega de destino **WC-01**, en orden de despacho.

```json
{
  "despachos": [{
    "numero": "OS-20261105-001",
    "estado": "en_transito",
    "origen": { "codigo": "107", "nombre": "EQTB Tempisque (custodia en CIISA)", "codigo_ciisa": "107" },
    "destino": { "codigo": "WC-01", "texto": "Tienda" },
    "fecha": "…", "despachado_en": "…", "notas": null,
    "lineas": [{
      "tipo": "caja", "codigo": "CJ-…", "descripcion": "NEW YORK", "cantidad": 1, "kg": 10.5,
      "etiquetas": [
        { "codigo": "34GKAE266322309243300416F101", "copia": 1, "kg": 0.416, "formato": "ciisa_paquete",
          "codigo_articulo": "26632", "arete": "34GKAE", "trazabilidad": "con_arete", "kg_etiqueta": 0.416, "cruce": "F1", "bms": 1 },
        { "codigo": "STK-0001", "copia": 1, "kg": 0.9, "formato": "interno" }
      ]
    }]
  }],
  "siguiente_cursor": "eyJ0Ijoi…",
  "hay_mas": false
}
```

**Paquetes sin trazabilidad.** Cuando la planta no sabe de qué animal viene el producto, rellena el arete
del código de barras con «xxx» (cualquier combinación de mayúsculas) o con ceros («000000», típico de las
hamburguesas). En ese caso la etiqueta llega con `"arete": null` y `"trazabilidad": "sin_trazabilidad"`
(nunca con el texto literal «XXXXXX»); con arete, `"trazabilidad": "con_arete"`. La tienda debe aceptar
`arete` nulo.

- Las `etiquetas` de una caja son sus stickers. `formato: ciisa_paquete` significa que el código
  se decodifica como etiqueta CIISA de 28 sin errores, y en ese caso se agregan los campos
  decodificados. `interno` es el sticker propio de la app.
- La tienda guarda `siguiente_cursor` y lo manda en la próxima consulta. Si no hay novedades, el
  cursor vuelve igual. El cursor es opaco: no hay que interpretarlo.
- Un despacho se publica 5 s después de confirmado. Esa pausa evita que dos transacciones que
  terminan en otro orden dejen uno por detrás del cursor.
- **La tienda tiene que deduplicar por `numero` (upsert).** Cuando ya está al día (el cursor que
  manda se emitió con `hay_mas = false`), la consulta siguiente relee los últimos 60 s antes del
  cursor. Así se recupera un despacho cuya transacción confirmó tarde con un `despachada_en`
  anterior. Entre páginas de una misma consulta no se relee nada, así que no hay bucles.
- `despachada_en` se escribe como última sentencia del despacho, justo antes del commit. La orden
  se lee con `SELECT … FOR UPDATE`: con un doble clic o dos usuarios, el segundo recibe 409 y no se
  duplican ni `despachada_en` ni `movimientos_bodega`.
- Una orden despachada o cancelada ya no se modifica: `PUT` responde 409.
- Límite de esta fase: una orden que se cancela **después** de despachada deja de aparecer, pero
  la tienda no recibe un aviso explícito. Las órdenes de traslado v10 (fase 2) traen el estado
  `cancelada`.
- `despachado_en` y `fecha` siguen la convención de zona horaria del resto de la app (DATETIME de
  MySQL leído como hora local del contenedor).

Para que una orden aparezca, en **Órdenes de salida** se elige «Bodega de destino = WC-01» y se
despacha.

**Bodegas v10 en el flujo viejo** (decisión del 05-nov, vale hasta el corte v10): 12, 107 y WC-01
no aparecen en los selectores de Custodia, Maduración/Porcionado, Deshuese ni Órdenes de entrada.
En Órdenes de salida no aparecen como origen y, como destino, solo aparece WC-01. El backend lo
valida igual (`lib/bodegasV10.js`): en custodia (`/recibir`, `/mover`) y en órdenes de entrada
rechaza una bodega v10, y en órdenes de salida el origen no puede ser v10, el destino solo puede
ser una `BOD-*` o WC-01, y origen y destino tienen que ser distintos. Una bodega es v10 cuando
tiene `naturaleza`.

### `POST /eventos`

Sobre (v1):

```json
{
  "v": 1,
  "clave": "baja.aplicada:17",
  "tipo": "baja.aplicada",
  "ocurrido_en": "2026-11-05T15:20:11-06:00",
  "origen": { "app": "tienda", "usuario": "panel · admin", "ip": null },
  "datos": { }
}
```

Tipos que se aceptan en esta fase y su clave obligatoria:

| `tipo` | `clave` | `datos` (mínimo) |
|---|---|---|
| `venta.salida` | `venta.salida:<pedido>` | `pedido`, `canal` (`web`\|`planta`), `salida_en`, `piezas[{codigo, copia, kg}]` y/o `unidades[{codigo_articulo, cantidad}]`, `montos?`, `cliente?`, `fe?` |
| `venta.anulada` | `venta.anulada:<pedido>:<n>` | `pedido`, `piezas[{codigo, copia}]`, `motivo` |
| `baja.aplicada` | `baja.aplicada:<baja_id>` | `baja_id`, `motivo_tienda` (`descarte`\|`mercadeo`\|`toma_fisica`\|`devuelta_planta`\|`otro`; con `otro`, `nota` es obligatoria), `motivo_ganaderia?`, `piezas[{codigo, copia, kg}]`, `aprobada_por` |
| `traslado.recibido` | `traslado.recibido:<recepcion_id>` | `numero_orden` (o `null`), `recepcion_id`, `cerrada_en`, `cajas[{codigo, copia, kg_etiqueta, paquetes?[{codigo, copia, kg, …}]}]`, `diferencias[{tipo, accion?, motivo?, …}]` |

Los demás tipos del diseño (`solicitud.creada`, `traslado.diferencia_resuelta`, `toma.aplicada`,
`devolucion.*`) responden 422 hasta su fase. Máximo 2000 piezas por evento y 1 MB por cuerpo.

Respuestas:

| Código | Cuerpo | Qué hace la tienda |
|---|---|---|
| 200 | `{clave, resultado:'registrado', modo:'sombra', aplicado:false, avisos:[…]}` | Lo marca como enviado |
| 200 + `Idempotency-Replayed: true` | El mismo resultado guardado | Lo marca como enviado (era un reenvío) |
| 409 | `{error:'clave_con_otro_contenido'}` | Error permanente (no se reintenta) |
| 422 | `{error:'evento_invalido'\|'json_invalido', errores:[…]}` | Error permanente |
| 503 / 5xx | | Reintenta con espera |

**Idempotencia**: `integracion_eventos.clave` es UNIQUE y guarda el `sha256` del cuerpo crudo.
Si llega la misma clave con el mismo cuerpo, se devuelve el resultado guardado y no se escribe
nada. Si llega la misma clave con otro cuerpo, la respuesta es 409. Si llegan dos envíos
simultáneos, el UNIQUE decide: el segundo espera al primero y recibe el resultado guardado. La
tienda reenvía siempre **el mismo texto** del payload (lo guarda en su outbox), nunca lo vuelve a
serializar.

**Avisos en sombra** (no fallan el evento; la diferencia sale después en la conciliación):

| Aviso | Cuándo |
|---|---|
| `formato_invalido` | El código no se decodifica como paquete CIISA de 28 |
| `peso_distinto_etiqueta` | El `kg` del evento no coincide con los gramos de la etiqueta. Indica que los dos decodificadores se desincronizaron |
| `etiqueta_desconocida` | Ganadería no tiene la etiqueta (`etiquetas`). Es lo normal hasta la fase 2 |
| `estado_no_cuadra` | Ganadería tiene la etiqueta, pero fuera de WC-01 o en un estado distinto al que supone el evento |
| `etiqueta_ya_existe` | En `traslado.recibido`, un paquete que ganadería ya tenía |
| `motivo_no_coincide` | En una baja, la tienda mandó un `motivo_ganaderia` distinto del mapeo de ganadería, que es el que vale |

Mapeo de bajas (ganadería decide):

| `motivo_tienda` | Estado + `motivo_salida` en ganadería |
|---|---|
| `descarte` | `descartada` + `descarte` |
| `mercadeo` | `vendida` + `mercadeo` |
| `toma_fisica` | `descartada` + `ajuste` |
| `devuelta_planta` | `devuelta` (flujo de devolución a planta) |
| `otro` | `descartada` + `ajuste`, con nota obligatoria |

## 5. Base de datos (aditiva, en `initDB()`)

`backend/src/models/nucleoV10.js` crea, con la definición **completa** de
`docs/nucleo-inventario-v10/propuesta.sql`:

- **Bodegas v10**: las columnas `naturaleza`, `ambito_inventario`, `empresa_custodio`,
  `empresa_propietaria`, `codigo_ciisa`, `cuenta_inventario_wc` y `es_legacy`; `tipo` pasa a
  NULL-able. Se agregan las filas `12` (Paquetería CIISA), `107` (custodia virtual) y `WC-01`
  (física, la tienda). Las 5 `BOD-*` no se tocan.
- **Tablas**: `consecutivos`, `formatos_etiqueta` (con la semilla), `etiquetas` (+ `copia` y
  `tienda_pieza_id`, UNIQUE `(codigo_crudo, copia)`), `movimientos_etiqueta` (+ `documento_tipo`
  `integracion_tienda` y `planta`) e `integracion_eventos`.
- **FK diferidas**: `etiquetas → lotes_deshuese`, `etiquetas → dat` y
  `movimientos_etiqueta → log_autorizaciones` se agregan solas en el primer arranque en que exista
  la tabla destino.
- **Triggers append-only** del kardex: initDB los intenta crear. Con binlog activo, MySQL exige
  SUPER, y si falla queda en el log `[initDB:v10] trigger trg_me_no_*`. En ese caso hay que correr
  como root `backend/migraciones/2026-11-05-triggers-movimientos-etiqueta.sql` (el archivo explica
  cómo).
- **Órdenes de salida**: se agregan `bodega_destino_id` (FK a bodegas) y `despachada_en
  DATETIME(3)`, que es el cursor. Las órdenes despachadas antes del cambio toman su `updated_at`.
- **Usuario de servicio** `integracion.tienda`, con rol `servicio`. Su contraseña es un hash de
  bytes al azar, `/api/auth/login` lo rechaza y desde la app no se puede editar.
- `test/nucleo-v10-esquema.test.js` falla si las definiciones se apartan de `propuesta.sql`.

## 6. Consecutivo de órdenes

Antes, `OS-AAAAMMDD-NNN` y `OE-AAAAMMDD-NNN` salían de «cantidad del día + 1». Con dos usuarios a
la vez, el segundo chocaba con el UNIQUE, y después de borrar una orden se repetía un número.
Ahora salen de `consecutivos` (`serie = 'OS-MMDD'`, `anio`) con
`UPDATE … SET ultimo = LAST_INSERT_ID(ultimo + 1)`, dentro de la misma transacción que crea la
orden. Un rollback no consume número. El **día** del número es el de Costa Rica
(`America/Costa_Rica`), sea cual sea el TZ del contenedor: una orden de las 21:00 de CR es de ese
día aunque en UTC ya sea el siguiente. Las demás fechas se guardan igual que antes. El día del despliegue el contador arranca en el mayor número
ya emitido ese día. Lo prueban `test/consecutivos.test.js` y `test/mysql-integracion.test.js`
(30 órdenes concurrentes contra MySQL real).

## 7. Pruebas

```sh
cd backend && npm test                     # unitarias + rutas con pool falso
# Con MySQL real (docker):
docker run -d --name ht-mysql-test -e MYSQL_ROOT_PASSWORD=rootlocal -e MYSQL_DATABASE=hacienda_tracking \
  -e MYSQL_USER=hacienda_admin -e MYSQL_PASSWORD=hacienda_pass -p 33061:3306 mysql:8.0
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 npm test
```

## 8. Despliegue (orden)

1. Definir en `/opt/kiwi/.env` y mapear en el servicio `hacienda-backend` de
   `/opt/kiwi/docker-compose.yml`: `JWT_SECRET` (ya existe), `INTEGRACION_TIENDA_MODO=apagado` y
   `INTEGRACION_TIENDA_SECRETO` (nuevo, también en el servicio `wagyu`).
2. Mergear. El auto-deploy reconstruye el backend e initDB migra. Revisar el log del contenedor:
   si aparece `[initDB:v10] trigger …`, correr el SQL de `backend/migraciones/` como root.
3. Cuando la tienda tenga su fase 1, pasar a `sombra` y revisar `integracion_eventos` y los avisos
   durante una semana.
4. `pruebas` para recorrer el flujo con los datos PRUEBA. `encendido` cuando se quiera que los
   traslados reales queden registrados. La recepción ya tiene procesador; ventas, bajas y tomas
   todavía no.

## Traslados planta → tienda: recepción por caja (Juan Carlos, 06-nov-2026)

- Son unos **1 por semana** y los piden Carolina, Michelle o Juan Carlos (usuarios de la tienda).
- La planta **pistolea la caja completa sin abrirla** (en su propio sistema): no hay escaneo por pieza en
  origen. Por eso la recepción en la tienda es **por caja**: en `traslado.recibido` cada caja puede venir
  sin `paquetes` (la lista es opcional), y los paquetes se dan de alta cuando la tienda abre la caja.
- Si el peso no cuadra o los productos no coinciden, la tienda **devuelve en el mismo transporte** o
  **avisa a la planta**. En el evento va en cada diferencia: `accion` = `devolver_mismo_transporte` |
  `avisar_planta`, con `motivo` obligatorio cuando viene `accion` (opcional para los eventos de antes).
- La caja trae su **BMS** en los 2 últimos dígitos del código (0–12): la tienda lo lee con el mismo
  decodificador (`wagyu-demo/src/lib/etiqueta.ts`).
- La tienda ya tiene la pantalla «Traslados por recibir» (`wagyu-demo`, `docs/integracion-ganaderia.md`).

### Cómo se pide y cómo vuelve (06-nov-2026)

1. **Inventario de la planta**: en el último snapshot se marcan cajas de INV GENERAL (con código de
   barras) y se usa «Pedir a la tienda…». `POST /api/traslados-tienda` crea la orden de salida
   107 → WC-01. Cada ítem guarda una copia de la línea (código CIISA, artículo, kg, lote, BMS y
   arete) en `ordenes_salida_items`. Una línea solo puede estar en una orden viva, y un código que ya
   está en otra orden viva genera un aviso. La regla de bodegas admite 107 → WC-01
   (`lib/bodegasV10.js`); el resto sigue igual.
2. **Traslados a la tienda** (`/traslados-tienda/:id`): la lista para la planta se imprime, se copia
   o se manda por WhatsApp. Cuando la planta carga las cajas, se usa «Despachar» (el mismo
   `POST /api/ordenes-salida/:id/despachar`).
3. La orden despachada aparece en `GET /despachos` con líneas `{tipo:'caja', formato:'ciisa_caja',
   codigo, codigo_articulo, kg, lote, fecha, bms, arete}` y `prueba: true|false`. Ganadería no
   necesita cola de salida: «publicar» el traslado es despacharlo. La tienda es el único cliente.
4. La tienda recibe por caja y manda `traslado.recibido` con:
   - `cajas[{codigo, copia, kg_etiqueta, kg_recibido?}]`: lo que llegó a la puerta;
   - `diferencias[{tipo: caja_faltante | caja_no_solicitada | peso_no_cuadra, codigo, esperado?,
     recibido?, accion, motivo}]`.
5. En `encendido` o `pruebas` el procesador cruza ese evento contra los ítems de la orden. El
   resultado queda en `recepciones_tienda` y `recepciones_tienda_cajas`, con una de estas
   categorías por caja: recibida, otro_peso, faltante o sobrante, y su acción y motivo. También se
   actualizan `ordenes_salida.recepcion_estado`, `recepcion_en` y `recepcion_por` (quién cerró en la
   tienda). Todo va en la misma transacción que `integracion_eventos`.
   - Si llega la misma clave con el mismo cuerpo, se devuelve el resultado guardado.
   - Si llega la misma clave con otro cuerpo, se responde 409.
   - Si el evento se registró en sombra, se aplica al llegar en encendido.
   - Sin cajas (no llegó ninguna) también vale, siempre que traiga las diferencias.
   - No se aplica, y no se guarda nada, si la orden no va a WC-01 (422 `orden_no_es_traslado_tienda`),
     si no está despachada (409 `orden_no_despachada`) o si ya tiene una recepción con otra
     `recepcion_id` (409 `orden_ya_recibida`). En `pruebas`, una orden real da 422 `solo_pruebas`.
   - **Cursor en `pruebas`**: `/despachos` solo devuelve órdenes PRUEBA, así que el cursor que
     devuelve salta las reales. La tienda guarda un cursor aparte por modo
     (`despachos_cursor_pruebas`) y al encender sigue con el real intacto.
   - Una orden despachada o con recepción no se borra (`DELETE` → 409): se anula.
   - 107 → WC-01 solo se arma desde `/api/traslados-tienda`; el POST/PUT genérico de órdenes de
     salida sigue rechazando la 107 como origen. Un PUT que no cambia bodegas (anular, notas) no
     revalida.
   - La carga PRUEBA del seed queda con `inventario_planta_cargas.es_prueba = 1`: no es «el último
     snapshot» real (ni en la pantalla, ni al pedir cajas, ni en la comparación del importador).
6. Todavía no se mueve el kardex por etiqueta (`etiquetas` / `movimientos_etiqueta`): la 107 vive
   en el snapshot semanal de la planta.

### Datos de prueba de punta a punta

- `backend/src/seeds/prueba-flujo.js` es idempotente. Crea el animal PRUEBA con su guía, sacrificio,
  marmoleo, solicitud de deshuese, deshuese, reporte de producción (Lote CC 9999) y 4 cajas en
  la 107 (snapshot «PRUEBA-flujo-completo.xlsx»). Todo queda marcado PRUEBA.
- `backend/src/seeds/borrar-prueba-flujo.js` lo borra por esos marcadores y borra también las
  órdenes `es_prueba = 1` con sus recepciones y sus eventos.
- Local: `DB_HOST=127.0.0.1 DB_PORT=33061 node src/seeds/prueba-flujo.js`.
- Producción: no se corre sin decisión. El comando es
  `docker exec -e PRUEBA_CONFIRMAR=1 <contenedor-backend> node src/seeds/prueba-flujo.js`. Sin
  `PRUEBA_CONFIRMAR=1` y con `NODE_ENV=production` aborta.
