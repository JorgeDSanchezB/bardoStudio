"use client";

import { useEffect, useState } from "react";
import { clamp } from "@/lib/format";

interface NivelMetrosProps {
  /** lectura en dB (se llama por rAF mientras el motor suena) */
  leer: () => { vozDb: number; musicaDb: number };
  activo: boolean;
}

const PISO = -60;
const TECHO = 0;

function dbAPct(db: number): number {
  const n = clamp((db - PISO) / (TECHO - PISO), 0, 1);
  // escala algo comprimida para que -18 dB no parezca "vacío"
  return Math.pow(n, 0.7) * 100;
}

function colorBarra(pct: number): string {
  if (pct > 95) return "#f43f5e";
  if (pct > 80) return "#fbbf24";
  return "#34d399";
}

function Metro({
  etiqueta,
  pct,
  picoPct,
  color,
}: {
  etiqueta: string;
  pct: number;
  picoPct: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2" aria-label={`Medidor de ${etiqueta}`}>
      <span className="w-9 shrink-0 text-[10px] font-medium text-zinc-500">
        {etiqueta}
      </span>
      <div className="relative h-4 flex-1 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-75"
          style={{ width: `${pct}%`, background: color }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-zinc-100"
          style={{ left: `${picoPct}%` }}
          aria-hidden
        />
        {/* marcas dB */}
        {[-48, -36, -24, -12, -6].map((db) => (
          <div
            key={db}
            className="absolute inset-y-0 w-px bg-zinc-700/60"
            style={{ left: `${dbAPct(db)}%` }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

/** Medidores de nivel de voz y música (Fase 5), actualizados por rAF. */
export function NivelMetros(props: NivelMetrosProps) {
  const { leer, activo } = props;
  const [lecturas, setLecturas] = useState({
    voz: PISO,
    musica: PISO,
    picoVoz: 0,
    picoMusica: 0,
  });

  useEffect(() => {
    if (!activo) return;
    let raf = 0;
    let ultimo = 0;
    let pv = 0;
    let pm = 0;
    const loop = (t: number) => {
      if (t - ultimo > 40) {
        ultimo = t;
        const { vozDb, musicaDb } = leer();
        const nv = dbAPct(vozDb);
        const nm = dbAPct(musicaDb);
        // pico con caída lenta (retención ~1.2 s)
        pv = Math.max(nv, pv - 1.1);
        pm = Math.max(nm, pm - 1.1);
        setLecturas({
          voz: vozDb,
          musica: musicaDb,
          picoVoz: pv,
          picoMusica: pm,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [activo, leer]);

  const voz = activo ? lecturas.voz : PISO;
  const musica = activo ? lecturas.musica : PISO;
  const pctVoz = dbAPct(voz);
  const pctMusica = dbAPct(musica);

  return (
    <div className="space-y-1.5">
      <Metro
        etiqueta="VOZ"
        pct={pctVoz}
        picoPct={activo ? lecturas.picoVoz : 0}
        color={colorBarra(pctVoz)}
      />
      <Metro
        etiqueta="MÚSICA"
        pct={pctMusica}
        picoPct={activo ? lecturas.picoMusica : 0}
        color="#2dd4bf"
      />
    </div>
  );
}
