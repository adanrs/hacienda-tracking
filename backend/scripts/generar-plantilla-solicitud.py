"""Genera backend/plantillas/solicitud-deshuese.xlsx a partir del libro real de la planta.

Uso (una vez, o cuando la planta cambie su hoja):
    python scripts/generar-plantilla-solicitud.py <Solicitud_de_Deshuese_y_Porcionado.xlsx>

Toma la hoja más reciente («Deshuese 160524»), borra las demás (y sus imágenes: el libro original
pesa 31 MB por fotos) y LIMPIA los datos de ejemplo de las canales (arete, sexo, pesos, consecutivo,
marmoleo y las medias 0/1/2 por corte que no son fórmula). Conserva formato, celdas combinadas,
anchos y TODAS las fórmulas (peso deshuese = canal × 84 %, merma, rendimientos, BCH, cuadro Pearson).
El mapeo celda por celda está documentado en docs/importadores/solicitud-deshuese.md.
"""
import sys
import openpyxl

HOJA = 'Deshuese 160524'
COLS_CANAL = ['G', 'I', 'K', 'M', 'O']
FILAS_ENCABEZADO = [3, 4, 5, 6, 7, 8, 9, 10, 12]
FILAS_CORTES = range(18, 72)
DESTINO = 'plantillas/solicitud-deshuese.xlsx'

wb = openpyxl.load_workbook(sys.argv[1])
for ws in list(wb.worksheets):
    if ws.title != HOJA:
        wb.remove(ws)
ws = wb[HOJA]
ws.title = 'Deshuese'

def es_formula(v):
    return isinstance(v, str) and v.startswith('=')

for col in COLS_CANAL:
    for fila in FILAS_ENCABEZADO:
        c = ws[f'{col}{fila}']
        if not es_formula(c.value):
            c.value = None
    for fila in FILAS_CORTES:
        c = ws[f'{col}{fila}']
        # Medias de ejemplo (0/1/2) fuera; las fórmulas (=2-G18, =G44…) se quedan.
        if isinstance(c.value, (int, float)):
            c.value = None
# Ejemplos del bloque de paquetería (aretes, fechas y resultados de otra corrida).
for ref in ['U3', 'V3', 'W3', 'U4', 'V4', 'W4', 'U5', 'V5', 'W5', 'W12', 'X12', 'Y12', 'Z12',
            'X14', 'Y14', 'Z14', 'AD14', 'AE14', 'AJ14']:
    ws[ref].value = None
wb.save(DESTINO)
print('Plantilla escrita en', DESTINO)
