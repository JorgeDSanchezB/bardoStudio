#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bardo Studio — informe PDF auditable de musicalización (ReportLab).

Uso:
    /home/z/.venv/bin/python3 scripts/report-pdf.py <entrada.json> <salida.pdf>

Éxito  -> stdout "REPORT OK <bytes> <ruta>" y exit 0.
Fallo  -> stderr "ERROR: ..." y exit 1.

Contrato de entrada (todos los campos toleran null o ausencia; ver
scripts/report-sample.json): proyecto, resumen, dramaturgia, curva[],
musica, mezcla, edicion, exportacion, auditoria[].

Diseño: A4 vertical, márgenes de 2 cm, Helvetica incorporada, títulos en
zinc-900, acentos ámbar #f59e0b, rejilla fina #d4d4d8, cabeceras #fafaf9.
Sin emojis; fechas y números en formato español.
"""

import datetime
import json
import math
import os
import sys
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import (Circle, Drawing, Line, PolyLine,
                                        Rect, String)
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (BaseDocTemplate, Frame, HRFlowable,
                                KeepTogether, NextPageTemplate, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

# --------------------------------------------------------------------------
# Geometría, paleta y constantes
# --------------------------------------------------------------------------
PAGE_W, PAGE_H = A4
MARGEN = 2.0 * cm
ANCHO = PAGE_W - 2.0 * MARGEN          # ancho útil ~481.9 pt
BANDA_H = 68.0                         # franja ámbar de portada

AMBER = HexColor('#f59e0b')
AMBER_OSCURO = HexColor('#b45309')
AMBER_HEX = '#f59e0b'
ZINC900 = HexColor('#18181b')
ZINC700 = HexColor('#3f3f46')
ZINC500 = HexColor('#71717a')
ZINC400 = HexColor('#a1a1aa')
REJILLA = HexColor('#d4d4d8')
CABECERA_BG = HexColor('#fafaf9')
ZEBRA = HexColor('#fbfbfa')
ESMERALDA = HexColor('#10b981')
ESMERALDA_TXT = '#047857'

ANIMO_COLORES = {
    'calma': '#2dd4bf',
    'misterio': '#a78bfa',
    'tension': '#fb923c',
    'tensión': '#fb923c',
    'batalla': '#f87171',
    'victoria': '#fbbf24',
    'neutro': '#a1a1aa',
}
ANIMO_ETIQUETAS = {
    'calma': 'Calma',
    'misterio': 'Misterio',
    'tension': 'Tensión',
    'tensión': 'Tensión',
    'batalla': 'Batalla',
    'victoria': 'Victoria',
    'neutro': 'Neutro',
}
FASES = {
    1: 'Ingestión y análisis',
    2: 'Transcripción y tensión',
    2.5: 'Efectos de sonido',
    3: 'Gestión de música',
    4: 'Mezcla automática',
    5: 'Editor de mezcla',
    6: 'Exportación y reporte',
}
MOTORES = {
    'llm+heuristica': 'LLM + heurística',
    'heuristica+llm': 'heurística + LLM',
    'llm': 'LLM',
    'heuristica': 'heurística',
    'energia': 'energía',
}
ORIGENES = {'auto': 'Automática', 'manual': 'Manual'}

MAX_ESCENAS = 60    # filas visibles en la tabla de escenas
MAX_AGRUPAR = 20    # máx. filas de asignación para fusionar celdas de pista


# --------------------------------------------------------------------------
# Utilidades de datos (tolerantes a null, tipos incorrectos o ausencia)
# --------------------------------------------------------------------------
def as_dict(v):
    return v if isinstance(v, dict) else {}


def as_list(v):
    return v if isinstance(v, list) else []


def text(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def num(v):
    """Número tolerantemente: int/float (no bool), o cadena numérica."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            f = float(s.replace(',', '.'))
        except ValueError:
            return None
        return None if (math.isnan(f) or math.isinf(f)) else f
    return None


def parse_dt(v):
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        pass
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return None


# --------------------------------------------------------------------------
# Formateadores (español)
# --------------------------------------------------------------------------
def mmss(t):
    """Segundos -> 'MM:SS' (o 'H:MM:SS' a partir de una hora)."""
    if t is None:
        return '—'
    t = max(0, int(round(t)))
    h, resto = divmod(t, 3600)
    m, s = divmod(resto, 60)
    return '%d:%02d:%02d' % (h, m, s) if h else '%02d:%02d' % (m, s)


def fmt_dur(sec):
    """Segundos -> '2h 56m 08s' / '2m 50s' / '3 s'."""
    if sec is None:
        return '—'
    sec = max(0, int(round(sec)))
    h, resto = divmod(sec, 3600)
    m, s = divmod(resto, 60)
    if h:
        return '%dh %02dm %02ds' % (h, m, s)
    if m:
        return '%dm %02ds' % (m, s)
    return '%d s' % s


def fmt_es(v, dec=1):
    """Número -> texto español ('49', '-18', '29,7')."""
    if v is None:
        return '—'
    if isinstance(v, int):
        return str(v)
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return ('%.*f' % (dec, v)).replace('.', ',')


def fmt_int(v):
    """Entero con separador de miles español: 31187520 -> '31.187.520'."""
    return '{:,}'.format(int(v)).replace(',', '.')


def fmt_fecha(dt, corto=False):
    if dt is None:
        return None
    try:
        return dt.strftime('%d/%m/%Y' if corto else '%d/%m/%Y %H:%M')
    except Exception:
        return None


def pretty_motor(v):
    t = text(v)
    if not t:
        return None
    return MOTORES.get(t.lower(), t)


def color_animo(clave):
    return ANIMO_COLORES.get(clave, '#a1a1aa')


def etiqueta_animo(clave, bruta):
    return ANIMO_ETIQUETAS.get(clave) or (bruta if bruta else '—')


# --------------------------------------------------------------------------
# Estilos
# --------------------------------------------------------------------------
def make_styles():
    s = {}
    s['portada_titulo'] = ParagraphStyle(
        'portada_titulo', fontName='Helvetica-Bold', fontSize=19, leading=24,
        textColor=ZINC900)
    s['portada_proyecto'] = ParagraphStyle(
        'portada_proyecto', fontName='Helvetica', fontSize=11.5, leading=15,
        textColor=HexColor('#52525b'))
    s['meta_etiqueta'] = ParagraphStyle(
        'meta_etiqueta', fontName='Helvetica-Bold', fontSize=7, leading=10,
        textColor=ZINC500)
    s['meta_valor'] = ParagraphStyle(
        'meta_valor', fontName='Helvetica', fontSize=9.5, leading=13,
        textColor=ZINC700)
    s['seccion'] = ParagraphStyle(
        'seccion', fontName='Helvetica-Bold', fontSize=13, leading=17,
        textColor=ZINC900, spaceBefore=16, spaceAfter=3, keepWithNext=1)
    s['cuerpo'] = ParagraphStyle(
        'cuerpo', fontName='Helvetica', fontSize=9.5, leading=15.5,
        textColor=ZINC700)
    s['nota'] = ParagraphStyle(
        'nota', fontName='Helvetica-Oblique', fontSize=8, leading=11.5,
        textColor=ZINC500, spaceBefore=3)
    s['leyenda'] = ParagraphStyle(
        'leyenda', fontName='Helvetica', fontSize=8.5, leading=13,
        textColor=HexColor('#52525b'), spaceBefore=4)
    s['vineta'] = ParagraphStyle(
        'vineta', fontName='Helvetica', fontSize=9.5, leading=14,
        textColor=ZINC700, leftIndent=16, bulletIndent=4, spaceBefore=1.5)
    s['tarjeta_valor'] = ParagraphStyle(
        'tarjeta_valor', fontName='Helvetica-Bold', fontSize=15, leading=18,
        textColor=ZINC900, alignment=TA_CENTER)
    s['tarjeta_etiqueta'] = ParagraphStyle(
        'tarjeta_etiqueta', fontName='Helvetica', fontSize=6.8, leading=9,
        textColor=ZINC500, alignment=TA_CENTER)
    s['th'] = ParagraphStyle(
        'th', fontName='Helvetica-Bold', fontSize=8, leading=11,
        textColor=ZINC700)
    s['thc'] = ParagraphStyle(
        'thc', fontName='Helvetica-Bold', fontSize=8, leading=11,
        textColor=ZINC700, alignment=TA_CENTER)
    s['td'] = ParagraphStyle(
        'td', fontName='Helvetica', fontSize=9, leading=12.5, textColor=ZINC700)
    s['tdc'] = ParagraphStyle(
        'tdc', fontName='Helvetica', fontSize=9, leading=12.5,
        textColor=ZINC700, alignment=TA_CENTER)
    s['td_nota'] = ParagraphStyle(
        'td_nota', fontName='Helvetica-Oblique', fontSize=8, leading=11,
        textColor=ZINC500, alignment=TA_CENTER)
    return s


def estilo_tabla():
    """Rejilla fina + cabecera #fafaf9, común a las tablas de datos."""
    return [
        ('GRID', (0, 0), (-1, -1), 0.5, REJILLA),
        ('BACKGROUND', (0, 0), (-1, 0), CABECERA_BG),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONT', (0, 0), (-1, -1), 'Helvetica', 9),
        ('TEXTCOLOR', (0, 0), (-1, -1), ZINC700),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]


def encabezado_seccion(num, titulo, st):
    p = Paragraph(
        '<font color="%s">%02d</font>&nbsp;&nbsp;%s' % (AMBER_HEX, num, escape(titulo)),
        st['seccion'])
    hr = HRFlowable(width='100%', thickness=0.7, color=REJILLA,
                    spaceBefore=1, spaceAfter=8)
    hr.keepWithNext = 1
    return [p, hr]


def dibujo_check():
    """Visto pequeño en esmeralda (Helvetica no incluye U+2714)."""
    d = Drawing(10, 10)
    d.add(PolyLine(points=[(1.5, 5.2), (4.0, 2.0), (8.4, 7.6)],
                   strokeColor=ESMERALDA, strokeWidth=1.8,
                   strokeLineCap=1, strokeLineJoin=1))
    return d


# --------------------------------------------------------------------------
# Portada (compacta: el contenido continúa en la misma página 1)
# --------------------------------------------------------------------------
def bloque_portada(data, st):
    proy = as_dict(data.get('proyecto'))
    resumen = as_dict(data.get('resumen'))
    dramaturgia = as_dict(data.get('dramaturgia'))

    nombre = text(proy.get('nombre')) or text(proy.get('archivo'))
    dur = num(proy.get('duracionSec'))
    formato = text(proy.get('formato'))
    motor = pretty_motor(dramaturgia.get('motorEmocion'))
    dt = parse_dt(resumen.get('generadoEn')) or parse_dt(proy.get('fecha'))
    fecha = fmt_fecha(dt)

    filas = [
        ('DURACIÓN', fmt_dur(dur) if dur is not None else '—'),
        ('FECHA DE GENERACIÓN', fecha if fecha else '—'),
        ('AUDIO', formato if formato else '—'),
        ('MOTOR DE EMOCIÓN', motor if motor else '—'),
    ]
    meta = Table(
        [[Paragraph(escape(k), st['meta_etiqueta']),
          Paragraph(escape(v), st['meta_valor'])] for k, v in filas],
        colWidths=[115, ANCHO - 115])
    meta.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 1.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
    ]))

    return [
        Spacer(1, 14),
        Paragraph('Informe de musicalización auditable', st['portada_titulo']),
        Paragraph(escape(nombre) if nombre else 'Proyecto sin nombre',
                  st['portada_proyecto']),
        Spacer(1, 10),
        meta,
        Spacer(1, 4),
        HRFlowable(width='100%', thickness=1.1, color=AMBER,
                   spaceBefore=5, spaceAfter=2),
    ]


# --------------------------------------------------------------------------
# 1 · Resumen ejecutivo (tarjetas de métricas de dramaturgia)
# --------------------------------------------------------------------------
def seccion_resumen(data, st):
    dr = as_dict(data.get('dramaturgia'))
    dur = num(as_dict(data.get('proyecto')).get('duracionSec'))

    valores = [
        (num(dr.get('escenas')), 'Escenas', fmt_int),
        (num(dr.get('mediaTension')), 'Tensión media (0-100)', fmt_es),
        (num(dr.get('picoTension')), 'Pico de tensión', fmt_es),
        (num(dr.get('corregidas')), 'Escenas corregidas', fmt_int),
        (num(dr.get('frases')), 'Frases transcritas', fmt_int),
        (num(dr.get('caracteres')), 'Caracteres', fmt_int),
        (num(dr.get('bloques')), 'Bloques de análisis (máx. 5 min)', fmt_int),
        (dur, 'Duración de la narración', fmt_dur),
    ]
    if all(v is None for v, _lbl, _f in valores):
        return None

    tarjetas = []
    for v, etiqueta, fmt in valores:
        texto = fmt(v) if v is not None else '—'
        tarjetas.append([Paragraph(escape(texto), st['tarjeta_valor']),
                         Paragraph(escape(etiqueta), st['tarjeta_etiqueta'])])

    filas = [tarjetas[i:i + 4] for i in range(0, len(tarjetas), 4)]
    t = Table(filas, colWidths=[ANCHO / 4.0] * 4)
    t.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, REJILLA),
        ('BACKGROUND', (0, 0), (-1, -1), CABECERA_BG),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    return [t]


# --------------------------------------------------------------------------
# 2 · Auditoría de fases (siempre presente; faltantes -> pendientes)
# --------------------------------------------------------------------------
def seccion_auditoria(data, st):
    estados = {}
    for e in as_list(data.get('auditoria')):
        if not isinstance(e, dict):
            continue
        f = num(e.get('fase'))
        if f is None:
            continue
        # claves de fase admitidas: 1, 2, 2.5, 3, 4, 5, 6
        if f in FASES:
            estados[f] = e

    filas = [[Paragraph('Fase', st['thc']),
              Paragraph('Título', st['th']),
              Paragraph('Estado', st['th'])]]
    for i in FASES:
        e = as_dict(estados.get(i))
        titulo = text(e.get('titulo')) or FASES[i]
        dt = parse_dt(e.get('aprobadaEn'))
        if dt is not None:
            fecha = fmt_fecha(dt, corto=True)
            txt = 'Aprobada' + ((' · %s' % fecha) if fecha else '')
            interna = Table(
                [[dibujo_check(),
                  Paragraph('<font color="%s">%s</font>' % (ESMERALDA_TXT, escape(txt)), st['td'])]],
                colWidths=[14, 178])
            interna.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ]))
            estado = interna
        else:
            estado = Paragraph('<font color="#a1a1aa">— pendiente</font>', st['td'])
        filas.append([Paragraph(str(i), st['tdc']),
                      Paragraph(escape(titulo), st['td']),
                      estado])

    t = Table(filas, colWidths=[42, 235, ANCHO - 277], repeatRows=1)
    t.setStyle(TableStyle(estilo_tabla()))
    return [t]


# --------------------------------------------------------------------------
# 2.5 · Efectos de sonido (SFX): resumen + tabla de clips de la mezcla
# --------------------------------------------------------------------------
def seccion_sfx(data, st):
    sx = as_dict(data.get('sfx'))
    if not sx:
        return None

    detectados = num(sx.get('detectados'))
    activos = num(sx.get('activos'))
    if (detectados is None or detectados <= 0) and not as_list(sx.get('clips')):
        return None

    frases = []
    if detectados is not None:
        frases.append('%s efectos detectados' % fmt_int(detectados))
        if activos is not None:
            frases.append('%s activos tras la auditoría' % fmt_int(activos))
    categorias = num(sx.get('categorias'))
    if categorias is not None:
        frases.append('%s categorías' % fmt_int(categorias))
    top = text(sx.get('palabraTop'))
    if top and top != '—':
        frases.append('palabra más frecuente «%s»' % escape(top))
    flujo = [Paragraph(
        'Detección por palabras clave sobre la transcripción: %s.' %
        ', '.join(frases), st['cuerpo'])]

    detalle = []
    nivel = num(sx.get('nivelDb'))
    if nivel is not None:
        detalle.append('nivel %s dB' % fmt_es(nivel))
    crossfade = num(sx.get('crossfadeSeg'))
    if crossfade is not None:
        detalle.append('fundidos de %s s' % fmt_es(crossfade))
    respeta = sx.get('respetarDucking')
    if respeta is not None:
        detalle.append('respeta el ducking de la voz (½ profundidad)' if respeta
                       else 'sin ducking')
    en_mezcla = num(sx.get('clipsEnMezcla'))
    if en_mezcla is not None:
        detalle.append('%s clips en la mezcla final' % fmt_int(en_mezcla))
    sil = num(sx.get('clipsSilenciados'))
    if sil is not None and sil > 0:
        detalle.append('%s silenciados' % fmt_int(sil))
    edi = num(sx.get('ediciones'))
    if edi is not None and edi > 0:
        detalle.append('%s ediciones manuales' % fmt_int(edi))
    if detalle:
        flujo.append(Paragraph('Integración en la mezcla: %s.' %
                               ', '.join(detalle), st['cuerpo']))

    # tabla de clips (el contrato envía como máximo 40; el resto se resume)
    filas = [[Paragraph('Seg.', st['thc']),
              Paragraph('Palabra', st['th']),
              Paragraph('Categoría', st['th']),
              Paragraph('Archivo', st['th']),
              Paragraph('Vol.', st['thc'])]]
    n_mostrados = 0
    for c in as_list(sx.get('clips')):
        if not isinstance(c, dict):
            continue
        inicio = num(c.get('inicio'))
        if inicio is None:
            continue
        vol = num(c.get('volumenDb'))
        palabra = text(c.get('palabra'))
        if not palabra:
            palabra = '(manual)' if text(c.get('origen')) == 'manual' else '—'
        filas.append([
            Paragraph(escape(mmss(inicio)), st['tdc']),
            Paragraph(escape(palabra), st['td']),
            Paragraph(escape(text(c.get('categoria')) or '—'), st['td']),
            Paragraph(escape(text(c.get('sfx')) or '—'), st['td']),
            Paragraph(escape('%s dB' % fmt_es(vol)) if vol is not None else '—',
                      st['tdc']),
        ])
        n_mostrados += 1

    if n_mostrados == 0:
        return flujo

    total = en_mezcla if en_mezcla is not None else n_mostrados
    if total > n_mostrados:
        filas.append([Paragraph('…', st['tdc']),
                      Paragraph('… y %d clips más' % (total - n_mostrados),
                                st['td']),
                      Paragraph('', st['td']),
                      Paragraph('', st['td']),
                      Paragraph('', st['tdc'])])

    t = Table(filas, colWidths=[46, 96, 96, 130, ANCHO - 368], repeatRows=1)
    t.setStyle(TableStyle(estilo_tabla()))
    flujo.append(Spacer(1, 6))
    flujo.append(t)
    return flujo


# --------------------------------------------------------------------------
# 3 · Curva de tensión (gráfico de línea con puntos por ánimo)
# --------------------------------------------------------------------------
def normalizar_curva(data):
    """Lista estable de escenas a partir de data['curva']."""
    filas = []
    for i, c in enumerate(as_list(data.get('curva'))):
        if not isinstance(c, dict):
            continue
        n = num(c.get('n'))
        animo = text(c.get('animo'))
        filas.append({
            'n': int(n) if n is not None else i + 1,
            'inicio': num(c.get('inicio')),
            'fin': num(c.get('fin')),
            'tension': num(c.get('tension')),
            'animo': animo,
            'corregido': bool(c.get('corregido')),
        })
    filas.sort(key=lambda f: (f['inicio'] if f['inicio'] is not None else 0.0, f['n']))
    return filas


def grafico_curva(puntos):
    """puntos: [(seg, tension, animo, corregido)] con valores numéricos."""
    w, h = ANCHO, 232.0
    d = Drawing(w, h)
    izq, der, arriba, abajo = 40.0, 14.0, 16.0, 36.0
    x0, x1 = izq, w - der
    y0, y1 = abajo, h - arriba
    pw, ph = x1 - x0, y1 - y0
    total = max([p[0] for p in puntos] + [0.0])
    total = max(total, 1.0)

    d.add(Rect(x0, y0, pw, ph, strokeColor=REJILLA, strokeWidth=0.6,
               fillColor=None))
    for v in (0, 25, 50, 75, 100):
        y = y0 + ph * (v / 100.0)
        if v == 0:
            d.add(Line(x0, y, x1, y, strokeColor=ZINC400, strokeWidth=0.9))
        else:
            d.add(Line(x0, y, x1, y, strokeColor=REJILLA, strokeWidth=0.5))
        d.add(String(x0 - 6, y - 2.5, str(v), fontName='Helvetica',
                     fontSize=7, fillColor=ZINC500, textAnchor='end'))
    d.add(String(x0, y1 + 5, 'Tensión (0-100)', fontName='Helvetica',
                 fontSize=7, fillColor=ZINC500, textAnchor='start'))

    paso = 3600
    for candidato in (5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600):
        if total <= candidato * 8:
            paso = candidato
            break
    t = 0.0
    while t <= total + 1e-9:
        x = x0 + pw * (t / total)
        d.add(Line(x, y0, x, y0 - 3, strokeColor=ZINC400, strokeWidth=0.7))
        ancla = 'middle'
        if x - x0 < 20:
            ancla = 'start'
        elif x1 - x < 20:
            ancla = 'end'
        d.add(String(x, y0 - 13, mmss(t), fontName='Helvetica', fontSize=7,
                     fillColor=ZINC500, textAnchor=ancla))
        t += paso
    d.add(String((x0 + x1) / 2.0, y0 - 25, 'Tiempo', fontName='Helvetica',
                 fontSize=7, fillColor=ZINC500, textAnchor='middle'))

    xy = []
    for seg, tens, _animo, _cor in puntos:
        x = x0 + pw * (min(max(seg, 0.0), total) / total)
        y = y0 + ph * (min(max(tens, 0.0), 100.0) / 100.0)
        xy.append((x, y))
    if len(xy) >= 2:
        d.add(PolyLine(points=xy, strokeColor=AMBER, strokeWidth=1.5,
                       strokeLineJoin=1, strokeLineCap=1))
    # primero los anillos (quedan por debajo del punto) y luego los puntos
    for (x, y), (_s, _t, _a, cor) in zip(xy, puntos):
        if cor:
            d.add(Circle(x, y, 4.8, fillColor=None, strokeColor=ZINC900,
                         strokeWidth=1.1))
    for (x, y), (_s, _t, animo, _c) in zip(xy, puntos):
        d.add(Circle(x, y, 3.2, fillColor=HexColor(color_animo(animo)),
                     strokeColor=None))
    return d


def leyenda_curva(st):
    partes = []
    for clave, etiqueta in [('calma', 'Calma'), ('misterio', 'Misterio'),
                            ('tension', 'Tensión'), ('batalla', 'Batalla'),
                            ('victoria', 'Victoria'), ('neutro', 'Neutro')]:
        partes.append('<font color="%s">•</font> %s'
                      % (ANIMO_COLORES[clave], etiqueta))
    return [
        Paragraph('&nbsp;&nbsp;&nbsp;'.join(partes), st['leyenda']),
        Paragraph('Los valores manuales (anillo) sustituyen al análisis automático.',
                  st['nota']),
    ]


def seccion_curva(data, st):
    filas = normalizar_curva(data)
    dr = as_dict(data.get('dramaturgia'))
    flow = []

    bits = []
    if filas:
        bits.append('%d escenas' % len(filas))
    media, pico = num(dr.get('mediaTension')), num(dr.get('picoTension'))
    if media is not None:
        bits.append('media %s' % fmt_es(media))
    if pico is not None:
        bits.append('pico %s' % fmt_es(pico))
    if bits:
        flow.append(Paragraph('Evolución de la tensión a lo largo de la narración (%s).'
                              % escape(', '.join(bits)), st['cuerpo']))

    puntos = []
    for f in filas:
        if f['inicio'] is None or f['fin'] is None or f['tension'] is None:
            continue
        puntos.append(((f['inicio'] + f['fin']) / 2.0, f['tension'],
                       (f['animo'] or '').lower(), f['corregido']))
    if puntos:
        flow.append(Spacer(1, 6))
        flow.append(grafico_curva(puntos))
        flow.extend(leyenda_curva(st))
    else:
        flow.append(Paragraph(
            'Sin datos de curva de tensión: la Fase 2 (transcripción y análisis) '
            'todavía no ha producido escenas analizadas.', st['cuerpo']))
    return flow


# --------------------------------------------------------------------------
# 4 · Tabla de escenas (paginada, cabecera repetida, máx. 60 filas)
# --------------------------------------------------------------------------
def seccion_escenas(data, st):
    filas = normalizar_curva(data)
    if not filas:
        return [Paragraph('Sin escenas que mostrar.', st['cuerpo'])]

    cabecera = [Paragraph('Nº', st['thc']), Paragraph('Inicio', st['thc']),
                Paragraph('Fin', st['thc']), Paragraph('Dur', st['thc']),
                Paragraph('Tensión', st['thc']), Paragraph('Ánimo', st['th'])]

    cuerpo = []
    hay_corregidas = False
    for f in filas[:MAX_ESCENAS]:
        ini, fin = f['inicio'], f['fin']
        dur = (fin - ini) if (ini is not None and fin is not None and fin >= ini) else None
        if f['tension'] is None:
            tens = Paragraph('—', st['tdc'])
        elif f['corregido']:
            hay_corregidas = True
            tens = Paragraph('<b>%s*</b>' % fmt_es(f['tension']), st['tdc'])
        else:
            tens = Paragraph(fmt_es(f['tension']), st['tdc'])
        clave = (f['animo'] or '').lower()
        animo = Paragraph('<font color="%s">•</font>&nbsp;%s'
                          % (color_animo(clave), escape(etiqueta_animo(clave, f['animo']))),
                          st['td'])
        cuerpo.append([
            str(f['n']),
            mmss(ini), mmss(fin), mmss(dur),
            tens, animo,
        ])

    cmds = estilo_tabla() + [
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, ZEBRA]),
        ('FONT', (1, 1), (3, -1), 'Courier', 8.5),
        ('ALIGN', (0, 1), (4, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
    ]

    if len(filas) > MAX_ESCENAS:
        resto = len(filas) - MAX_ESCENAS
        fila_extra = len(cuerpo) + 1
        cuerpo.append([Paragraph('… y %d escenas más' % resto, st['td_nota'])]
                      + [''] * 5)
        cmds += [('SPAN', (0, fila_extra), (5, fila_extra)),
                 ('BACKGROUND', (0, fila_extra), (5, fila_extra), CABECERA_BG)]

    t = Table([cabecera] + cuerpo,
              colWidths=[32, 72, 72, 62, 58, ANCHO - 296], repeatRows=1)
    t.setStyle(TableStyle(cmds))

    flow = [t]
    if hay_corregidas:
        flow.append(Paragraph('* Tensión corregida manualmente; sustituye al valor automático.',
                              st['nota']))
    return flow


# --------------------------------------------------------------------------
# 5 · Asignación musical (párrafo + viñetas + tabla agrupada por pista)
# --------------------------------------------------------------------------
def tabla_asignaciones(asign, st):
    cabecera = [Paragraph('Escena', st['thc']), Paragraph('Rango', st['thc']),
                Paragraph('Ánimo', st['th']), Paragraph('Tensión', st['thc']),
                Paragraph('Pista', st['th']), Paragraph('Origen', st['thc'])]

    cuerpo, pistas_fila, origenes_fila = [], [], []
    for a in asign:
        n = num(a.get('escenaN'))
        ini, fin = num(a.get('inicio')), num(a.get('fin'))
        rango = ('%s – %s' % (mmss(ini), mmss(fin))
                 if (ini is not None and fin is not None) else '—')
        tens = num(a.get('tension'))
        animo_txt = text(a.get('animo'))
        clave = (animo_txt or '').lower()
        pid = text(a.get('pistaId'))
        titulo = text(a.get('titulo'))
        if titulo and pid:
            pista_html = ('%s<br/><font face="Courier" size="6.5" color="#71717a">%s</font>'
                          % (escape(titulo), escape(pid)))
        elif titulo:
            pista_html = escape(titulo)
        elif pid:
            pista_html = ('<font face="Courier" size="7.5" color="#3f3f46">%s</font>'
                          % escape(pid))
        else:
            pista_html = '—'
        origen_raw = a.get('origen')
        origen_l = origen_raw.strip().lower() if isinstance(origen_raw, str) else ''
        origen = ORIGENES.get(origen_l) or (text(origen_raw) or '—')
        cuerpo.append([
            str(int(n)) if n is not None else '—',
            rango,
            Paragraph('<font color="%s">•</font>&nbsp;%s'
                      % (color_animo(clave),
                         escape(etiqueta_animo(clave, animo_txt))), st['td']),
            Paragraph(fmt_es(tens) if tens is not None else '—', st['tdc']),
            Paragraph(pista_html, st['td']),
            Paragraph(escape(origen), st['tdc']),
        ])
        pistas_fila.append(pid)
        origenes_fila.append((pid, origen_l or None))

    cmds = estilo_tabla() + [
        ('FONT', (1, 1), (1, -1), 'Courier', 8.5),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    # separador más marcado al cambiar de pista (seguro ante saltos de página)
    for i in range(1, len(pistas_fila)):
        if pistas_fila[i] is not None and pistas_fila[i] != pistas_fila[i - 1]:
            cmds.append(('LINEABOVE', (0, i + 1), (5, i + 1), 0.9, ZINC400))

    # fusión vertical de celda Pista/Origen solo en tablas cortas (sin riesgo
    # de partir un SPAN entre páginas)
    if len(cuerpo) <= MAX_AGRUPAR:
        i = 0
        while i < len(pistas_fila):
            j = i
            while (j + 1 < len(pistas_fila) and pistas_fila[i] is not None
                   and pistas_fila[j + 1] == pistas_fila[i]):
                j += 1
            if j > i:
                cmds.append(('SPAN', (4, i + 1), (4, j + 1)))
            i = j + 1
        i = 0
        while i < len(origenes_fila):
            j = i
            while (j + 1 < len(origenes_fila) and origenes_fila[i][0] is not None
                   and origenes_fila[j + 1] == origenes_fila[i]):
                j += 1
            if j > i:
                cmds.append(('SPAN', (5, i + 1), (5, j + 1)))
            i = j + 1

    t = Table([cabecera] + cuerpo,
              colWidths=[46, 96, 74, 46, 142, ANCHO - 404], repeatRows=1)
    t.setStyle(TableStyle(cmds))
    if len(cuerpo) <= MAX_AGRUPAR:
        return KeepTogether([t])
    return t


def seccion_musica(data, st):
    mu = as_dict(data.get('musica'))
    asign = [a for a in as_list(mu.get('asignaciones')) if isinstance(a, dict)]
    pistas = [p for p in as_list(mu.get('pistasUsadas')) if text(p)]
    n_cambios = num(mu.get('nCambiosPista'))
    if not (asign or pistas or n_cambios is not None):
        return None

    flow = []
    if n_cambios is not None:
        flow.append(Paragraph(
            'La banda sonora cambia de pista %s veces a lo largo de la narración.'
            % fmt_es(n_cambios), st['cuerpo']))
    if pistas:
        usos, titulos = {}, {}
        for a in asign:
            pid = text(a.get('pistaId'))
            if not pid:
                continue
            usos[pid] = usos.get(pid, 0) + 1
            if pid not in titulos:
                titulos[pid] = text(a.get('titulo'))
        flow.append(Paragraph('Pistas utilizadas (%d):' % len(pistas), st['cuerpo']))
        for pid in pistas:
            titulo, k = titulos.get(pid), usos.get(pid, 0)
            if titulo:
                html = ('<b>%s</b> · <font face="Courier" size="7" color="#71717a">%s</font>'
                        % (escape(titulo), escape(pid)))
            else:
                html = ('<font face="Courier" size="8" color="#3f3f46">%s</font>'
                        % escape(pid))
            if k:
                html += (' <font color="#71717a">— usada en %d escena%s</font>'
                         % (k, 's' if k != 1 else ''))
            flow.append(Paragraph(html, st['vineta'], bulletText='•'))
    if asign:
        flow.append(Spacer(1, 4))
        flow.append(tabla_asignaciones(asign, st))
    return flow


# --------------------------------------------------------------------------
# 6 · Parámetros de mezcla (clave-valor traducido) + ediciones
# --------------------------------------------------------------------------
def seccion_mezcla(data, st):
    mez = as_dict(data.get('mezcla'))
    edi = as_dict(data.get('edicion'))
    defs = [
        ('nivelMusicaDb', 'Nivel de música', 'db'),
        ('rangoDinamicoDb', 'Rango dinámico', 'db'),
        ('profundidadDuckingDb', 'Profundidad de ducking', 'db'),
        ('ataqueMs', 'Ataque', 'ms'),
        ('liberacionMs', 'Liberación', 'ms'),
        ('crossfadeSeg', 'Crossfade', 's'),
        ('hincharSilenciosDb', 'Hinchar en silencios', 'db'),
        ('bloques', 'Bloques', ''),
        ('tiempoConMusicaSeg', 'Tiempo con música', 'dur'),
    ]
    valores = {k: num(mez.get(k)) for k, _l, _t in defs}
    detalle = text(edi.get('detalle'))
    n_edi = num(edi.get('ediciones'))
    if all(v is None for v in valores.values()) and not detalle and n_edi is None:
        return None

    filas = [[Paragraph('Parámetro', st['th']), Paragraph('Valor', st['th'])]]
    for clave, etiqueta, tipo in defs:
        v = valores[clave]
        if v is None:
            valor = '—'
        elif tipo == 'db':
            valor = '%s dB' % fmt_es(v)
        elif tipo == 'ms':
            valor = '%s ms' % fmt_es(v)
        elif tipo == 's':
            valor = '%s s' % fmt_es(v)
        elif tipo == 'dur':
            valor = fmt_dur(v)
        else:
            valor = fmt_es(v)
        filas.append([Paragraph('<b>%s</b>' % escape(etiqueta), st['td']),
                      Paragraph(escape(valor), st['td'])])
    if detalle:
        filas.append([Paragraph('<b>Ediciones</b>', st['td']),
                      Paragraph(escape(detalle), st['td'])])
    elif n_edi is not None:
        filas.append([Paragraph('<b>Ediciones</b>', st['td']),
                      Paragraph(escape('%s ediciones' % fmt_int(n_edi)), st['td'])])

    t = Table(filas, colWidths=[190, ANCHO - 190], repeatRows=1)
    t.setStyle(TableStyle(estilo_tabla()))
    return [t]


# --------------------------------------------------------------------------
# 7 · Exportación (párrafo narrativo)
# --------------------------------------------------------------------------
def seccion_exportacion(data, st):
    ex = as_dict(data.get('exportacion'))
    if not ex:
        return None
    frases = []
    formato = text(ex.get('formato'))
    if formato:
        frases.append('Formato de exportación: %s.' % escape(formato))
    norm = ex.get('normalizado')
    if norm is not None:
        frases.append('La mezcla final %s.' % ('se normalizó en picos' if norm
                                               else 'no se normalizó'))
    rms, pico = num(ex.get('rmsDb')), num(ex.get('picoDb'))
    if rms is not None or pico is not None:
        niveles = []
        if rms is not None:
            niveles.append('RMS de %s dB' % fmt_es(rms))
        if pico is not None:
            niveles.append('pico de %s dB' % fmt_es(pico))
        frases.append('Niveles medidos: %s.' % ' y '.join(niveles))
    b = num(ex.get('bytes'))
    if b is not None and b > 0:
        frases.append('Tamaño del archivo: %s MB (%s bytes).'
                      % (fmt_es(b / 1048576.0), fmt_int(b)))
    stems = ex.get('stems')
    if stems is not None:
        frases.append('Incluye stems por pista para remezclar.' if stems
                      else 'Sin stems exportados.')
    cola = num(ex.get('colaFinalSeg'))
    if cola is not None:
        frases.append('Cola final de silencio: %s.' % fmt_dur(cola))
    if not frases:
        return None
    return [Paragraph(' '.join(frases), st['cuerpo'])]


# --------------------------------------------------------------------------
# Documento: plantillas de página, franja de portada y pie global
# --------------------------------------------------------------------------
def pie_pagina(cv, num_pagina):
    cv.saveState()
    cv.setStrokeColor(HexColor('#e4e4e7'))
    cv.setLineWidth(0.4)
    cv.line(MARGEN, 38, PAGE_W - MARGEN, 38)
    cv.setFont('Helvetica', 7)
    cv.setFillColor(ZINC500)
    cv.drawString(MARGEN, 27,
                  'Bardo Studio · informe generado localmente · datos auditables')
    cv.drawRightString(PAGE_W - MARGEN, 27, 'Página %d' % num_pagina)
    cv.restoreState()


def al_empezar_portada(cv, doc):
    cv.saveState()
    cv.setFillColor(AMBER)
    cv.rect(0, PAGE_H - BANDA_H, PAGE_W, BANDA_H, stroke=0, fill=1)
    cv.setFillColor(AMBER_OSCURO)
    cv.rect(0, PAGE_H - BANDA_H, PAGE_W, 3, stroke=0, fill=1)
    cv.setFillColor(white)
    cv.setFont('Helvetica', 7)
    cv.drawRightString(PAGE_W - MARGEN, PAGE_H - BANDA_H + 31.5,
                       'PIPELINE LOCAL · 7 FASES')
    to = cv.beginText(MARGEN, PAGE_H - BANDA_H + 28)
    to.setFont('Helvetica-Bold', 16)
    to.setCharSpace(2.2)
    to.textOut('BARDO STUDIO')
    cv.drawText(to)
    cv.restoreState()
    pie_pagina(cv, doc.page)


def al_empezar_cuerpo(cv, doc):
    pie_pagina(cv, doc.page)


def construir_historia(data, st):
    historia = []
    historia.extend(bloque_portada(data, st))
    historia.append(NextPageTemplate('cuerpo'))

    secciones = []
    s = seccion_resumen(data, st)
    if s:
        secciones.append(('Resumen ejecutivo', s))
    secciones.append(('Auditoría de fases', seccion_auditoria(data, st)))
    secciones.append(('Curva de tensión', seccion_curva(data, st)))
    secciones.append(('Escenas y tensión', seccion_escenas(data, st)))
    s = seccion_sfx(data, st)
    if s:
        secciones.append(('Efectos de sonido', s))
    s = seccion_musica(data, st)
    if s:
        secciones.append(('Asignación musical', s))
    s = seccion_mezcla(data, st)
    if s:
        secciones.append(('Parámetros de mezcla', s))
    s = seccion_exportacion(data, st)
    if s:
        secciones.append(('Exportación', s))

    for i, (titulo, contenido) in enumerate(secciones, 1):
        historia.extend(encabezado_seccion(i, titulo, st))
        historia.extend(contenido)
    return historia


def generar_pdf(data, ruta_salida):
    st = make_styles()
    proy = as_dict(data.get('proyecto'))
    nombre = text(proy.get('nombre')) or text(proy.get('archivo'))
    titulo = 'Informe de musicalización auditable'
    if nombre:
        titulo += ' — %s' % nombre

    doc = BaseDocTemplate(
        ruta_salida, pagesize=A4, title=titulo, author='Bardo Studio',
        subject='Informe auditable del pipeline de musicalización',
        creator='Bardo Studio · ReportLab', pageCompression=0)

    marco_portada = Frame(MARGEN, MARGEN, ANCHO,
                          PAGE_H - MARGEN - BANDA_H - 14, id='portada',
                          leftPadding=0, rightPadding=0,
                          topPadding=0, bottomPadding=0)
    marco_cuerpo = Frame(MARGEN, MARGEN, ANCHO, PAGE_H - 2 * MARGEN,
                         id='cuerpo', leftPadding=0, rightPadding=0,
                         topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id='portada', frames=[marco_portada],
                     onPage=al_empezar_portada),
        PageTemplate(id='cuerpo', frames=[marco_cuerpo],
                     onPage=al_empezar_cuerpo),
    ])
    try:
        doc.build(construir_historia(data, st))
    except Exception:
        try:
            if os.path.exists(ruta_salida):
                os.remove(ruta_salida)
        except OSError:
            pass
        raise


def main(argv):
    if len(argv) != 3:
        print('Uso: report-pdf.py <entrada.json> <salida.pdf>', file=sys.stderr)
        return 1
    ruta_entrada, ruta_salida = argv[1], argv[2]
    if not os.path.isfile(ruta_entrada):
        print('ERROR: no existe el archivo de entrada: %s' % ruta_entrada,
              file=sys.stderr)
        return 1
    try:
        with open(ruta_entrada, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        print('ERROR: no se pudo leer el JSON de entrada (%s): %s'
              % (ruta_entrada, e), file=sys.stderr)
        return 1
    if not isinstance(data, dict):
        print('ERROR: el JSON de entrada debe ser un objeto {...} con el '
              'contrato del informe.', file=sys.stderr)
        return 1
    try:
        generar_pdf(data, ruta_salida)
    except Exception as e:
        print('ERROR: fallo al generar el PDF: %s: %s'
              % (type(e).__name__, e), file=sys.stderr)
        return 1
    print('REPORT OK %d %s' % (os.path.getsize(ruta_salida), ruta_salida))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
