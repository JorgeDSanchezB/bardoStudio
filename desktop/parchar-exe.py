#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bardo Studio · parchar-exe.py
═════════════════════════════
Sustituye los iconos RT_ICON de un ejecutable de Windows (p. ej. el
electron.exe empaquetado como app) por los de un .ico, reconstruyendo el
directorio de recursos con LIEF. No requiere Windows ni wine.

Mantiene ids y dimensiones del exe (RT_GROUP_ICON queda válido):
  · tamaños ≤ 48 px → DIB clásico (cabecera 40 + píxeles BGRA + máscara)
  · 256 px          → PNG embebido (formato moderno de RT_ICON)

Uso:
    python3 parchar-exe.py <app.exe> <icono.png|icono.ico>
Salida: 0 = parcheado · 1 = no se pudo · 2 = uso incorrecto
"""
from __future__ import annotations

import struct
import sys

TAMANOS_EXE = (16, 32, 48, 256)


def png_bytes(img) -> bytes:
    """PNG en memoria (para la entrada de 256 px)."""
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def dib_electron(img) -> bytes:
    """
    DIB RT_ICON al estilo del exe de Electron (32 bpp):
      BITMAPINFOHEADER(40) + BGRA de abajo a arriba + máscara de
      w*h bytes (0xFF transparente, 0x00 opaco). Windows tolera la
      máscara expandida y respeta el canal alfa.
    """
    ancho, alto = img.size
    px = img.convert("RGBA").load()
    filas = []
    for y in range(alto - 1, -1, -1):  # BMP: de abajo a arriba
        fila = bytearray()
        for x in range(ancho):
            r, g, b, a = px[x, y]
            fila += bytes((b, g, r, a))
        filas.append(bytes(fila))
    cabecera = struct.pack(
        "<IiiHHIIiiII",
        40,          # biSize
        ancho,       # biWidth
        alto * 2,    # biHeight (xor + máscara)
        1,           # biPlanes
        32,          # biBitCount
        0,           # biCompression (BI_RGB)
        ancho * alto * 4 + ancho * alto,  # biSizeImage
        0, 0, 0, 0,
    )
    # máscara expandida byte a byte (0 = opaco con alfa; 1 = transparente)
    mascara = bytearray()
    for y in range(alto - 1, -1, -1):
        for x in range(ancho):
            _, _, _, a = px[x, y]
            mascara.append(0xFF if a < 128 else 0x00)
    return cabecera + b"".join(fila for fila in filas) + bytes(mascara)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    ruta_exe, ruta_icono = sys.argv[1], sys.argv[2]

    from PIL import Image
    import lief

    base = Image.open(ruta_icono).convert("RGBA")

    exe = lief.parse(ruta_exe)
    if exe is None:
        print("parchar-exe: no pude leer el exe")
        return 1

    # localizar los nodos de datos RT_ICON: /raíz/<RT_ICON=3>/<id>
    nodos = {}
    for tipo in exe.resources.childs:
        if tipo.id != 3:  # RT_ICON
            continue
        for icono in tipo.childs:
            for hoja in icono.childs:
                if hoja.is_data:
                    nodos[icono.id] = hoja

    if not nodos:
        print("parchar-exe: el exe no tiene RT_ICON")
        return 1

    # dimensiones reales de cada id (desde el contenido actual)
    info = {}
    for id_nodo, hoja in nodos.items():
        crudo = bytes(hoja.content)
        if crudo[:4] == b"\x89PNG":
            from io import BytesIO

            with Image.open(BytesIO(crudo)) as im:
                info[id_nodo] = im.size
        else:
            ancho = struct.unpack_from("<i", crudo, 4)[0]
            alto = struct.unpack_from("<i", crudo, 8)[0] // 2
            info[id_nodo] = (ancho, alto)

    sustituidos = 0
    for id_nodo, (ancho, alto) in info.items():
        if (ancho, alto) not in ((t, t) for t in TAMANOS_EXE):
            print(f"  · icono {ancho}x{alto} (id {id_nodo}): tamaño no gestionado, se conserva")
            continue
        img = base.resize((ancho, alto), Image.LANCZOS)
        datos = png_bytes(img) if ancho == 256 else dib_electron(img)
        nodos[id_nodo].content = datos
        sustituidos += 1
        print(f"  · {ancho}x{alto} (id {id_nodo}): sustituido ({len(datos)} bytes)")

    if sustituidos == 0:
        print("parchar-exe: ningún icono sustituido")
        return 1

    exe.write(ruta_exe)
    print(f"parchar-exe: {sustituidos} icono(s) escritos en {ruta_exe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
