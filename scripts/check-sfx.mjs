import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const cfg = JSON.parse(readFileSync(path.join(ROOT, "config", "sfx_config.json"), "utf8"));
const cats = cfg.categoria ?? [];
console.log("num categorias:", cats.length);
const bib = new Set(
  JSON.parse(readFileSync(path.join(ROOT, "config", "sfx.json"), "utf8")).sfx.map((e) => e.id)
);
const f = cats.filter((x) => !bib.has(x.sfxId)).map((x) => x.categoria + " -> " + x.sfxId);
console.log("sin id en biblioteca:", f.length ? f : "ninguno (todas enlazan)");
console.log("ids en biblioteca:", bib.size);
