#!/usr/bin/env node
/**
 * The content policy, and the inline styles it exists to make unnecessary.
 *
 * Two things are checked, and the second is the one that rots. A policy is
 * easy to write once; what happens afterwards is that somebody adds
 * `style={{ borderColor: 'var(--kc-line)' }}` because it is quicker than
 * opening the stylesheet, and a year later there are eighty-one of them and
 * nobody can tighten `style-src` any more. There were eighty-one. This is
 * what stops the eighty-second.
 *
 * The exception is deliberate and narrow: the shared KaiCorp chrome
 * (`kaicorp-*.tsx`) is generated — copied from the kaicorplabs repository by
 * sync-theme.sh and shared with five deployed services — so editing it here
 * would be undone by the next sync. Its inline styles are why `style-src`
 * still allows them, and that is written in src/proxy.ts rather than quietly
 * lived with.
 *
 *   npm run test:csp     (needs a build; the .sh takes care of the server)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:4013";

let fallos = 0;
const check = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗"} ${que}${ok ? "" : `  (esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)})`}`);
};

// ─── 1 · No inline styles of our own, in the source ─────────────────
console.log("Ni un estilo en línea nuestro");

const GENERADOS = /^kaicorp-/;
/**
 * The four that stay, and why: a stamp's position and a rendered page's size
 * are geometry that only exists at run time, and the ink colour is whatever
 * the person picked. Turning those into classes would mean generating CSS per
 * stamp. Anything not on this list is a token lookup that belongs in a
 * stylesheet.
 */
const PERMITIDOS = {
  "pdf-viewer.tsx": 1,
  "stamp-item.tsx": 1,
  "signature-modal.tsx": 2,
};

function tsx(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...tsx(ruta));
    else if (entrada.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

const encontrados = [];
for (const ruta of tsx("src")) {
  const nombre = ruta.split("/").pop();
  if (GENERADOS.test(nombre)) continue;
  const cuantos = (readFileSync(ruta, "utf8").match(/style=\{\{/g) ?? []).length;
  const permitidos = PERMITIDOS[nombre] ?? 0;
  if (cuantos > permitidos) encontrados.push(`${ruta}: ${cuantos} (permitidos ${permitidos})`);
}
check("ningún fichero pasa de los estilos calculados que tiene permitidos", encontrados, []);

// ─── 2 · The policy, on the built server ────────────────────────────
console.log("\nY la política, en el servidor construido");

const paginas = ["/", "/verify"];
for (const pagina of paginas) {
  const res = await fetch(BASE + pagina);
  const csp = res.headers.get("content-security-policy") ?? "";
  const html = await res.text();

  check(`${pagina} lleva la política`, csp.length > 0, true);
  check(`${pagina} con un nonce, y no con unsafe-inline en los scripts`,
    /script-src [^;]*'nonce-[^']+'/.test(csp) && !/script-src [^;]*'unsafe-inline'/.test(csp), true);
  check(`${pagina} con strict-dynamic`, csp.includes("'strict-dynamic'"), true);
  check(`${pagina} no deja marcos ajenos ni base ajena`,
    csp.includes("frame-ancestors 'none'") && csp.includes("base-uri 'none'"), true);
  check(`${pagina} no deja salir a ningún tercero`, csp.includes("connect-src 'self'"), true);
  check(`${pagina} sirve el worker de pdf.js desde aquí`, csp.includes("worker-src 'self' blob:"), true);
  check(`${pagina} sirve las tipografías desde aquí`, csp.includes("font-src 'self'"), true);
  // El nonce cambia en cada petición: uno fijo en el build no protege de nada.
  const nonceCabecera = csp.match(/'nonce-([^']+)'/)?.[1];
  check(`${pagina} usa en el HTML el mismo nonce que anuncia`, html.includes(`nonce="${nonceCabecera}"`), true);
}

const dos = await Promise.all(paginas.map((p) => fetch(BASE + p).then((r) => r.headers.get("content-security-policy"))));
check("dos peticiones, dos nonces distintos", dos[0] === dos[1], false);

console.log("\nY nada se CARGA de fuera");

// Enlaces a otro sitio los hay —la cabecera y el pie comunes llevan al de la
// casa—, y eso es navegación, no carga: el navegador no ejecuta ni pinta nada
// hasta que alguien los pulsa. Lo que no puede haber es un recurso que se
// traiga solo: un script, una hoja de estilos, una fuente, una imagen.
const html = await (await fetch(BASE + "/")).text();
const recursos = [
  ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)]
    .filter((m) => !/rel="(?:canonical|alternate)"/.test(m[0]))
    .map((m) => m[1]),
];
const deFuera = recursos.filter((u) => /^https?:\/\//.test(u));
check(`ningún recurso viene de otro origen (${recursos.length} revisados)`, deFuera, []);

console.log(`\n${fallos === 0 ? "todo verde" : `${fallos} fallan`}`);
process.exit(fallos === 0 ? 0 : 1);
