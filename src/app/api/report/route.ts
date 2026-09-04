import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * POST /api/report — genera el informe PDF auditable invocando
 * scripts/report-pdf.py (ReportLab) con el JSON del cliente.
 * Todo local: no hay llamadas externas.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PYTHON = "/home/z/.venv/bin/python3";
const TIMEOUT_MS = 90_000;

function ejecutarPy(
  entrada: string,
  salida: string
): Promise<{ codigo: number; stdout: string; stderr: string }> {
  return new Promise((resolver, reject) => {
    const proc = spawn(PYTHON, ["/home/z/my-project/scripts/report-pdf.py", entrada, salida], {
      cwd: "/home/z/my-project",
    });
    let stdout = "";
    let stderr = "";
    const temporizador = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("El generador del PDF agotó el tiempo (90 s)."));
    }, TIMEOUT_MS);
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (e) => {
      clearTimeout(temporizador);
      reject(e);
    });
    proc.on("close", (codigo) => {
      clearTimeout(temporizador);
      resolver({ codigo: codigo ?? -1, stdout, stderr });
    });
  });
}

export async function POST(req: NextRequest) {
  const dir = "/tmp/bardo-report";
  const id = randomUUID();
  const entrada = path.join(dir, `${id}.json`);
  const salida = path.join(dir, `${id}.pdf`);
  try {
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      return NextResponse.json(
        { error: "El cuerpo debe ser JSON válido." },
        { status: 400 }
      );
    }
    if (!cuerpo || typeof cuerpo !== "object") {
      return NextResponse.json(
        { error: "El cuerpo debe ser un objeto JSON." },
        { status: 400 }
      );
    }
    // límite defensivo: curva/asignaciones enormes (3+ h) siguen siendo < 5 MB
    const texto = JSON.stringify(cuerpo);
    if (texto.length > 8_000_000) {
      return NextResponse.json(
        { error: "El informe es demasiado grande." },
        { status: 413 }
      );
    }
    await mkdir(dir, { recursive: true });
    await writeFile(entrada, texto, "utf8");

    const r = await ejecutarPy(entrada, salida);
    if (r.codigo !== 0) {
      throw new Error(
        r.stderr.trim().split("\n").slice(-3).join(" ") || "report-pdf.py falló"
      );
    }
    const pdf = await readFile(salida);
    const nombre = `bardo-informe-${id.slice(0, 8)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Informe PDF: ${msg}` }, { status: 500 });
  } finally {
    void unlink(entrada).catch(() => undefined);
    void unlink(salida).catch(() => undefined);
  }
}
