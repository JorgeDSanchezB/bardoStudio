/**
 * Fase 6 — informe PDF auditable: construye el JSON del contrato y lo envía
 * a /api/report (que invoca scripts/report-pdf.py con ReportLab).
 */

/** Registro de un archivo exportado (Fase 6). */
export interface ExportInfo {
  tipo: "mezcla" | "voz" | "musica";
  nombre: string;
  bytes: number;
  durSec: number;
  rmsDb: number;
  picoDb: number;
  creadoEn: number;
}

/** Contrato del informe (debe coincidir con scripts/report-pdf.py). */
export interface InformePDF {
  proyecto: {
    nombre: string;
    archivo: string;
    duracionSec: number;
    formato: string;
    fecha: string;
  };
  resumen: { generadoEn: string; herramienta: string };
  dramaturgia: {
    escenas: number;
    mediaTension: number;
    picoTension: number;
    corregidas: number;
    motorEmocion: string;
    bloques: number;
    frases: number;
    caracteres: number;
  };
  curva: Array<{
    n: number;
    inicio: number;
    fin: number;
    tension: number;
    animo: string;
    corregido: boolean;
  }>;
  musica: {
    nCambiosPista: number;
    pistasUsadas: string[];
    asignaciones: Array<{
      escenaN: number;
      inicio: number;
      fin: number;
      animo: string;
      tension: number;
      pistaId: string;
      titulo: string;
      origen: string;
    }>;
  };
  mezcla: {
    nivelMusicaDb: number;
    rangoDinamicoDb: number;
    profundidadDuckingDb: number;
    ataqueMs: number;
    liberacionMs: number;
    crossfadeSeg: number;
    hincharSilenciosDb: number;
    bloques: number;
    tiempoConMusicaSeg: number;
  };
  edicion: { ediciones: number; detalle: string };
  exportacion: {
    formato: string;
    normalizado: boolean;
    bytes: number;
    rmsDb: number;
    picoDb: number;
    stems: boolean;
    colaFinalSeg: number;
  };
  auditoria: Array<{ fase: number; titulo: string; aprobadaEn: string | null }>;
}

/** Pide el PDF al backend (spawn de scripts/report-pdf.py). */
export async function generarInformePDF(
  informe: InformePDF
): Promise<{ blob: Blob; bytes: number }> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(informe),
  });
  if (!res.ok) {
    let detalle = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detalle = j.error;
    } catch {
      /* respuesta no JSON */
    }
    throw new Error(`No se pudo generar el PDF: ${detalle}`);
  }
  const blob = await res.blob();
  if (blob.size < 1000) throw new Error("El PDF generado está vacío.");
  return { blob, bytes: blob.size };
}

/** Descarga un Blob con un nombre de archivo. */
export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
