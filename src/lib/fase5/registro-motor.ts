/**
 * Registro global del control del motor de mezcla (Fase 5) para que la barra
 * espaciadora de la página (que por defecto controla el <audio> de la Fase 1)
 * sepa priorizar el motor cuando el editor está activo.
 */

export interface ControlMotor {
  /** alterna reproducir/pausar de la mezcla */
  toggle: () => void;
  /** ¿hay audio decodificado y listo? */
  disponible: boolean;
}

let control: ControlMotor | null = null;

export function registrarControlMotor(c: ControlMotor | null) {
  control = c;
}

export function obtenerControlMotor(): ControlMotor | null {
  return control;
}
