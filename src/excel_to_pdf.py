"""
excel_to_pdf.py
Converts gelato_flavors.xlsx (with filled ORDINE values) into a
clean landscape A4 order PDF — same layout as the reference sheet.

Usage:
    python src/excel_to_pdf.py [input.xlsx] [output.pdf]

Defaults:
    input  = gelato_flavors.xlsx
    output = output/shocapp_da_ordinare.pdf

Install once:
    pip install openpyxl reportlab
"""

import sys
import os
import datetime
import openpyxl
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEMPLATE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'gelato_flavors.xlsx')
OUT      = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'output', 'shocapp_da_ordinare.pdf')

os.makedirs(os.path.dirname(OUT), exist_ok=True)

# ── Load workbook ─────────────────────────────────────────────────────────────
wb = openpyxl.load_workbook(TEMPLATE, data_only=True)
ws = wb['Flavors']
rows = list(ws.iter_rows(values_only=True))

cats = [
    {'name': 'Gelato',     'fc': 0, 'oc': 1},
    {'name': 'Creme',      'fc': 2, 'oc': 3},
    {'name': 'Cioccolati', 'fc': 4, 'oc': 5},
    {'name': 'Sorbetti',   'fc': 6, 'oc': 7},
]

for cat in cats:
    cat['items'] = []
    for row in rows[1:]:
        v = row[cat['fc']]
        if v and str(v).strip() not in ('ORDINE', 'TOTAL:', 'Varie'):
            qty = row[cat['oc']]
            cat['items'].append({
                'flavor': str(v).strip(),
                'qty': int(qty) if qty else None,
            })

max_items = max(len(c['items']) for c in cats)

# ── Styles ────────────────────────────────────────────────────────────────────
navy      = colors.HexColor('#1a1a2e')
light_blue= colors.HexColor('#e8f4f8')
alt_row   = colors.HexColor('#f9f9f9')
qty_box   = colors.HexColor('#fffde7')
border_c  = colors.HexColor('#c8d6df')
total_bg  = colors.HexColor('#fef3cd')
red_qty   = colors.HexColor('#c0392b')

def sty(name, **kw):
    return ParagraphStyle(name, **kw)

title_s  = sty('t',  fontSize=13, fontName='Helvetica-Bold',  textColor=colors.white,            alignment=TA_CENTER)
cat_s    = sty('c',  fontSize=8,  fontName='Helvetica-Bold',  textColor=navy,                    alignment=TA_CENTER)
flavor_s = sty('f',  fontSize=7.5,fontName='Helvetica',       textColor=colors.HexColor('#2c3e50'))
qty_s    = sty('q',  fontSize=9,  fontName='Helvetica-Bold',  textColor=red_qty,                 alignment=TA_CENTER)
hq_s     = sty('hq', fontSize=7,  fontName='Helvetica-Bold',  textColor=navy,                    alignment=TA_CENTER)
tot_s    = sty('ts', fontSize=7.5,fontName='Helvetica-Bold',  textColor=navy)
totq_s   = sty('tq', fontSize=9,  fontName='Helvetica-Bold',  textColor=red_qty,                 alignment=TA_CENTER)
gt_s     = sty('gt', fontSize=11, fontName='Helvetica-Bold',  textColor=colors.white,            alignment=TA_CENTER)

# ── Page setup ────────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = landscape(A3)
COL_W_FLAVOR   = 72 * mm
COL_W_QTY      = 22 * mm
col_widths      = [COL_W_FLAVOR, COL_W_QTY] * 4

doc = SimpleDocTemplate(OUT, pagesize=landscape(A3),
    leftMargin=14*mm, rightMargin=14*mm, topMargin=12*mm, bottomMargin=12*mm)

story = []
today = datetime.date.today().strftime('%d/%m/%Y')

# Title
title_tbl = Table(
    [[Paragraph(f'FATA MORGANA  —  ORDINE SETTIMANALE  —  {today}', title_s)]],
    colWidths=[PAGE_W - 28*mm])
title_tbl.setStyle(TableStyle([
    ('BACKGROUND',    (0,0), (-1,-1), navy),
    ('TOPPADDING',    (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
]))
story += [title_tbl, Spacer(1, 4*mm)]

# Header row
hdr = []
for cat in cats:
    hdr += [Paragraph(cat['name'].upper(), cat_s), Paragraph('ORDINE', hq_s)]

tdata  = [hdr]
tstyle = [
    ('BACKGROUND',    (0, 0), (-1, 0),  light_blue),
    ('TOPPADDING',    (0, 0), (-1, -1), 3),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ('LEFTPADDING',   (0, 0), (-1, -1), 3),
    ('RIGHTPADDING',  (0, 0), (-1, -1), 2),
    ('GRID',          (0, 0), (-1, -1), 0.3, border_c),
    ('ROWHEIGHT',     (0, 0), (-1, -1), 7*mm),
]

totals = [0] * 4

for i in range(max_items):
    row = []
    for ci, cat in enumerate(cats):
        if i < len(cat['items']):
            item = cat['items'][i]
            qty  = item['qty']
            if qty:
                totals[ci] += qty
            row += [
                Paragraph(item['flavor'], flavor_s),
                Paragraph(str(qty) if qty else '', qty_s),
            ]
        else:
            row += ['', '']
    tdata.append(row)

    bg = alt_row if i % 2 == 0 else colors.white
    tstyle.append(('BACKGROUND', (0, i+1), (-1, i+1), bg))
    for ci in range(4):
        tstyle.append(('BACKGROUND', (ci*2+1, i+1), (ci*2+1, i+1), qty_box))

# Total row
total_row = []
for ci in range(4):
    total_row += [
        Paragraph('TOTALE', tot_s),
        Paragraph(str(totals[ci]) if totals[ci] else '', totq_s),
    ]
tdata.append(total_row)
tri = len(tdata) - 1
tstyle.append(('BACKGROUND', (0, tri), (-1, tri), total_bg))

t = Table(tdata, colWidths=col_widths, repeatRows=1)
t.setStyle(TableStyle(tstyle))
story.append(t)

grand = sum(totals)
if grand:
    story.append(Spacer(1, 3*mm))
    gt = Table(
        [[Paragraph(f'TOTALE VASCHETTE DA ORDINARE: {grand}', gt_s)]],
        colWidths=[PAGE_W - 28*mm])
    gt.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,-1), navy),
        ('TOPPADDING',    (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(gt)

doc.build(story)
print(f'PDF salvato: {OUT}')
