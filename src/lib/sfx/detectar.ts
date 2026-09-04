/**
 * Detección de eventos SFX a partir de la transcripción con timestamps
 * (Fase 2 → Fase 2.5). Función PURA y determinista: no toca el store ni la
 * red, por lo que puede correr en un Web Worker (ver detectar-worker.ts).
 *
 * Reglas de matching (requisito):
 *  - case-insensitive y sin acentos ("Relámpago" ≡ "relampago")
 *  - plurales/derivados por flexión ("truenos" → "trueno", "thunders" →
 *    "thunder"); las variantes explícitas (gerundios, femeninos…) viven en
 *    la lista de palabras de cada categoría
 *  - la posición temporal se estima repartiendo la duración del segmento
 *    proporcionalmente a los caracteres de cada palabra
 *  - anti-ametralladora: dos eventos de la misma categoría más cerca que
 *    defectos.minSeparacionSeg se funden en el primero
 */

import type { SfxCategoria, SfxConfig, SfxDef, SfxEvento, SfxResumen } from "./tipos";

export interface EntradaDeteccionSfx {
  segmentos: Array<{ inicio: number; fin: number; texto: string }>;
  duracionSec: number;
}

/** minúsculas + sin acentos + solo [a-z0-9] */
export function normalizarPalabra(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** token → candidatos base (él mismo y sus des-flexiones castellanas/inglesas) */
function variantesToken(tok: string): string[] {
  const out = [tok];
  if (tok.length > 4 && tok.endsWith("es")) out.push(tok.slice(0, -2));
  if (tok.length > 3 && tok.endsWith("s")) out.push(tok.slice(0, -1));
  return out;
}

interface IndiceEntrada {
  categoria: SfxCategoria;
  /** 1 = palabra exacta; 0.9 = flexión (plural) */
  confidencia: number;
}

/** índice palabra-normalizada → categoría (primera categoría que la reclama) */
function construirIndice(config: SfxConfig): Map<string, IndiceEntrada> {
  const indice = new Map<string, IndiceEntrada>();
  const activas = config.categorias.filter((c) => c.activo !== false);
  for (const cat of activas) {
    for (const palabra of cat.palabras) {
      const norm = normalizarPalabra(palabra);
      if (norm.length < 3) continue;
      if (!indice.has(norm)) indice.set(norm, { categoria: cat, confidencia: 1 });
      // plurales de la propia palabra (si la lista solo trae el singular)
      for (const plural of [norm + "s", norm + "es"]) {
        if (!indice.has(plural))
          indice.set(plural, { categoria: cat, confidencia: 0.9 });
      }
    }
  }
  return indice;
}

let contadorAuto = 0;

/**
 * Detecta eventos SFX en la transcripción. Devuelve los eventos ORDENADOS
 * por tiempo + un resumen para la puerta de auditoría.
 */
export function detectarSfx(
  entrada: EntradaDeteccionSfx,
  config: SfxConfig,
  biblioteca: SfxDef[]
): { eventos: SfxEvento[]; resumen: SfxResumen } {
  const indice = construirIndice(config);
  const durPorSfx = new Map(biblioteca.map((b) => [b.id, b.durSec]));
  const defectos = config.defectos;
  const eventos: SfxEvento[] = [];
  const porCategoria = new Map<string, number>();
  const frecuencia = new Map<string, number>();

  const tokenRe = /[A-Za-zÀ-ÿ0-9]+/g;

  for (const seg of entrada.segmentos) {
    if (!seg.texto) continue;
    const durSeg = Math.max(0.01, seg.fin - seg.inicio);
    const largo = seg.texto.length;
    let m: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(seg.texto)) !== null) {
      const crudo = m[0];
      const norm = normalizarPalabra(crudo);
      if (norm.length < 3) continue;

      let hit: IndiceEntrada | undefined;
      for (const variante of variantesToken(norm)) {
        hit = indice.get(variante);
        if (hit) break;
      }
      if (!hit) continue;

      // posición estimada: proporcional al offset de caracteres del token
      const offsetChars = m.index / Math.max(1, largo);
      const t = seg.inicio + offsetChars * durSeg;
      const inicio = Math.max(0, Math.min(entrada.duracionSec, Math.round(t * 10) / 10));

      // anti-ametralladora: fundir repeticiones de la misma categoría
      const previo = porCategoria.get(hit.categoria.categoria);
      if (previo !== undefined && inicio - previo < defectos.minSeparacionSeg) {
        frecuencia.set(crudo.toLowerCase(), (frecuencia.get(crudo.toLowerCase()) ?? 0) + 1);
        continue;
      }
      if (eventos.length >= defectos.maxEventos) break;

      const sfxId = hit.categoria.sfxId;
      const dur = durPorSfx.get(sfxId) ?? 1.0;
      eventos.push({
        id: `sfx-auto-${++contadorAuto}-${Math.round(t * 10) % 100000}`,
        palabra: crudo.slice(0, 40),
        categoria: hit.categoria.categoria,
        sfxId,
        inicio,
        durSec: dur,
        volumenDb: hit.categoria.volumenDb ?? defectos.nivelDb,
        confidencia: hit.confidencia,
        origen: "auto",
        activo: true,
      });
      porCategoria.set(hit.categoria.categoria, inicio);
      frecuencia.set(crudo.toLowerCase(), (frecuencia.get(crudo.toLowerCase()) ?? 0) + 1);
    }
    if (eventos.length >= defectos.maxEventos) break;
  }

  eventos.sort((a, b) => a.inicio - b.inicio);

  let palabraTop = "—";
  let max = 0;
  for (const [pal, n] of frecuencia) {
    if (n > max) {
      max = n;
      palabraTop = pal;
    }
  }

  const resumen: SfxResumen = {
    detectados: eventos.length,
    activos: eventos.filter((e) => e.activo).length,
    categorias: porCategoria.size,
    palabraTop,
  };
  return { eventos, resumen };
}
