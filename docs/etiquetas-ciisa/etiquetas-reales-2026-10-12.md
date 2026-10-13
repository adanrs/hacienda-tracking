# Etiquetas CIISA reales — validación del decodificador (12-oct-2026)

> Fuente: fotos que mandó Wagyu Cross el 12-oct-2026 y reglas que dio el cliente ese mismo día.
> Decodificador: [`backend/src/lib/etiquetas.js`](../../backend/src/lib/etiquetas.js).
> Casos de prueba: `backend/test/etiquetas.test.js`, sección «Etiquetas reales».

Los valores esperados de cada caso se tomaron del **texto impreso** de la etiqueta, no del código de barras. Así el test compara lo que el decodificador entiende del código con lo que la etiqueta dice en claro.

## 1. Resultado por etiqueta

| Etiqueta | Código de barras | Tipo | Resultado |
|---|---|---|---|
| Primal ZAMU «BCH CARNES ROJAS» ([foto](fotos/primal-zamu-bch-22229.jpg)) | `2222911132027221207232410` (25) | primal | **Decodifica bien.** Solo deja la advertencia de fecha ambigua (día 07), que el texto «DEC-07-2023» resuelve. |
| Caja master «SERV. MAN. RIBEYE STEAK» ([foto](fotos/caja-ribeye-26613.jpg)) | `2661300599XXX231225003111` (25) | caja | **Decodifica bien**, sin errores ni advertencias. |
| Caja master «Torta de Hamburguesa Gourmet» ([foto](fotos/caja-tortas-26649.jpg)) | `2664901321XXX290125003911` (25) | caja | **Decodifica bien**, sin errores ni advertencias. |
| Paquete «FB NEW YORK STEAK» ([foto](fotos/paquete-new-york-26338.jpg)) | `0PG087263382311240702026F111` (28, verificado carácter por carácter en la foto) | paquete | **Los campos decodifican bien.** Hubo que corregir el arete con relleno (§2.1). La validación marca `genetica_cruzada`, y está bien que lo haga (§2.3). |

### Desglose

**Primal (fecha MMDDAA):** `22229 | 11132 | 02722 | 120723 | 24 | 10`

| Campo | Código | Impreso | ✓ |
|---|---|---|---|
| Código Arreo | 22229 | Code 22229 (catálogo: BCH carnes rojas / CH-Chuck) | ✓ |
| Box | 11132 | Box 11132 | ✓ |
| Peso | 027.22 kg | 27.22 KGS / 60.00 LBS | ✓ |
| Fecha empaque | 07-dic-2023 | Empaque/Packing DEC-07-2023 | ✓ |
| Lote (n.º deshuese) | 24 | Lot 1207232**4** | ✓ |
| Sufijo | 10 | — (no se imprime) | sin significado |

**Caja master (fecha DDMMAA):** `26613 | 00599 | XXX | 231225 | 0031 | 11` y `26649 | 01321 | XXX | 290125 | 0039 | 11`

| Campo | Ribeye | Tortas | Impreso |
|---|---|---|---|
| Código | 26613 (F1, Ribeye Steak) | 26649 (PVA, Tortas gourmet) | ✓ ambos |
| Peso | 5.99 kg | 13.21 kg | ✓ ambos |
| Fecha (deshuese) | 23-dic-2025 | 29-ene-2025 | Ribeye: «Fecha de producción 23/12/2025»; Tortas: «Consumir antes 29/01/2026» = fecha + 12 meses |
| Lote | 0031 → 31 | 0039 → 39 | «Lote 2312250031», «Lote 2901250039» ✓ |
| XXX / sufijo | XXX / 11 | XXX / 11 | sin significado |

**Paquete:** `0PG087 | 26338 | 231124 | 07 | 02026 | F1 | 11`

| Campo | Código | Impreso | ✓ |
|---|---|---|---|
| Arete | `0PG087` | Lote: **PG087** … | con relleno (§2.1) |
| Código | 26338 (FB, New York Steak) | Código 26338, «FB NEW YORK STEAK» | ✓ |
| Fecha | 23-nov-2024 | Consumir antes de 23/11/25 (= fecha + 1 año) | ✓ es la fecha de producción |
| N.º deshuese | 07 | Lote: PG087 2211240**7** | ✓ |
| Peso | 2026 g | 2.026 Kg | ✓ |
| Contenido racial | **F1** | título **FB** | ✗ cruzado (§2.3) |
| Marmoleo | 11 | — | según el cliente |

## 2. Qué estaba mal o qué contradice lo documentado

### 2.1 Arete con relleno de ceros (corregido en el decodificador)
El paquete trae `0PG087`, pero el lote legible y el arete del animal son `PG087`. El campo es fijo de 6 posiciones y los aretes más cortos se rellenan con `0` a la izquierda. Los aretes de la tabla del Reporte Diario confirman que hay aretes de 5 caracteres (`72ELF`, `26FLB`, `49NKB`, `32ELV`) y de 6 (`347FLH`, `238FL2`).

- **Antes:** el decodificador devolvía solo `arete: '0PG087'`, y una búsqueda contra `animales.numero_trazabilidad` no lo encontraba.
- **Ahora:** además devuelve `areteSinRelleno: 'PG087'` y la advertencia `arete_con_relleno`. Quita **un solo** cero, porque el relleno es de una posición: `00G087` da `0G087`, no `G087`. No avisa con el formato con guion (`NNNN-L`, como `0103-M` del doc v10), cuyo 0 es propio del arete. No corrige solo, porque un arete real también puede empezar por 0. La búsqueda en el registro decide, con el mismo criterio que ya se usa para el arete invertido.
- `validarArete` sigue validando el **campo de 6 posiciones** del código. No sirve para validar el arete digitado del animal, que puede tener 5 caracteres.

### 2.2 La fecha del paquete no es la del deshuese (contradice la regla del cliente)
El cliente describió el paquete como «arete > código > fecha DDMMAA > n.º deshuese > gramos». La etiqueta real muestra dos fechas distintas:
- Código de barras: **23/11/24**, y «Consumir antes de 23/11/25». Es la fecha de **producción/empaque**, como dice el doc v10 §4.2 D.
- Lote legible: «PG087 **221124**07». Es la fecha del **deshuese**, un día antes.

En cambio, la caja y el primal sí llevan la fecha del deshuese en el lote. Para que nadie cruce paquete y caja por «fecha + lote» con la fecha equivocada, el decodificador ahora expone:
- `fechaDeshuese` = fecha del lote en **caja** y **primal**.
- `fechaDeshuese: null` en el **paquete**. Ahí el arete identifica al animal directamente.

⚠ **Impacto en el diseño v10, invariante 3** («el código del paquete corresponde a la caja: artículo + fecha + lote»): si la caja lleva la fecha del deshuese y el paquete la de producción, la comparación literal de fechas falla cuando ambos días no coinciden. Hay que comparar artículo + n.º de deshuese + arete, o tolerar la diferencia de fechas. Queda como pregunta A15.

### 2.3 Contenido racial F1 en un producto FB (hallazgo, no error del decodificador)
`26338` es New York **FB** según el catálogo C1, y el título impreso dice «FB NEW YORK STEAK». Aun así, el campo racial del código dice **F1**. Es el mismo tipo de cruce que documenta §11.3 (Denver 26632 y Picanha 26606), en la dirección contraria. El decodificador lo marca como error `genetica_cruzada`, que es justo su función. Falta que CIISA confirme cuál de los dos datos está mal (pregunta A16).

### 2.4 Confirmado sin cambios
- Estructura y anchos de los tres formatos (28 / 25 / 25), peso en centésimas (caja, primal) y en gramos (paquete).
- Caja: lote de 4 dígitos = `00` + n.º de deshuese. Esto responde la pregunta **A3** del diseño v10: es el mismo número con relleno, no año + lote.
- Primal: fecha MMDDAA (mes primero). La caja y el paquete usan DDMMAA.
- El «XXX» real son letras, así que las cajas no caen en `ambigua`.

## 3. Lo que sigue sin significado claro (para CIISA)

| Campo | Lo que se observa | Pregunta |
|---|---|---|
| «XXX» de la caja (pos. 11–13) | Literal `XXX` en las 3 cajas conocidas (2 reales + ejemplo v10) | ¿Es un campo sin usar (relleno) o algo que alguna vez cambia? (A1) |
| Sufijo de la caja (pos. 24–25) | `11` en las 3 cajas | ¿Constante, dígito de control, o marmoleo/«11» como en el paquete? (A2) |
| Sufijo del primal (pos. 24–25) | `10` en los 2 primales (real + ejemplo v10) | ¿Constante o dígito de control? (A2) |
| `F1` + `11` final del paquete | El cliente dice F1/FB = contenido racial y 11 = marmoleo | Confirmar si el F1 de un producto FB es un error de impresión de CIISA (A16) |
| N.º de deshuese 24 / 31 / 07 | Según el cliente es la **posición** del animal en el deshuese del día. El mismo número en dos fechas no es el mismo animal | Las 4 etiquetas son de fechas distintas (2023–2025), así que no se pueden cruzar con la tabla posición → arete del 21/09/26 |

## 4. Documentos CIISA de la misma tanda (contexto, no son etiquetas)

- **Traslado de inventario en custodia n.º 1824** (24-04-2026): 107 EQTB Tempisque → **08 Paquetería-Materia prima**, «CORTES FINOS LOTE 35 / RES 5094», 5 líneas visibles (22140, 22219, 22224, 22228, 40141; 33.72 kg). El pie dice 20.00 unidades / 147.80 kg, que **no cuadra** con las 5 líneas visibles. Probablemente la foto no muestra todas las líneas; hay que confirmarlo con el documento completo. Aparece una bodega **08** que no está en el mapeo v10 (A9), y «RES 5094» puede ser el n.º de canal que pide A12.
- **Ajuste de salida en custodia n.º 353** (26-03-2024): 107 EQTB Tempisque. 25000 BCH WAGYU 14 CAJ 381.08 kg + 25002 TRIMMING WAGYU 9 CAJ 244.98 kg = 23 / 626.06 (cuadra). Observación: «AUTORIZA JUAN CARLOS GILLEN, PRODUCTO PARA ZAMU». Confirma el uso de Observaciones como referencia de orden (`documentos_ciisa.orden_ref`).
- La foto `3B3F8539…` es otra toma de la caja Ribeye (no del Ajuste 353). El Ajuste es la foto `3BBCB9F4…`.
