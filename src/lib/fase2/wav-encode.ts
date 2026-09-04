/**
 * Codificación WAV PCM16 mono para las solicitudes ASR (16 kHz) y
 * conversión Blob → base64. El servicio de transcripción recibe audio en
 * base64 y admite archivos de 0–30 s, así que cada sub-bloque viaja ligero.
 */

export function encodeWavMono16(pcm: Float32Array, sampleRate = 16000): Blob {
  const nFrames = pcm.length;
  const blockAlign = 2; // mono · 16 bits
  const dataSize = nFrames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const escribeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  escribeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  escribeStr(8, "WAVE");
  escribeStr(12, "fmt ");
  dv.setUint32(16, 16, true); // tamaño fmt
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  escribeStr(36, "data");
  dv.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < nFrames; i++) {
    let v = pcm[i];
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Blob → base64 (sin el prefijo data:). */
export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = String(fr.result ?? "");
      const i = r.indexOf(",");
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    fr.onerror = () => reject(fr.error ?? new Error("FileReader falló"));
    fr.readAsDataURL(blob);
  });
}
