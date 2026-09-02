#!/usr/bin/env node
/**
 * Who gets in, and how.
 *
 * The access model is the one decided in docs/34 of the infrastructure
 * repository, and it is not the one the other services use: verifying is
 * public forever, the workspace needs a session, and somebody with a session
 * can hand out a link that lets one other person sign without joining
 * anything. Three doors, and this suite is what stops any of them drifting
 * open — or shut.
 *
 * The session cookie is forged here rather than obtained from a provider:
 * it is an HMAC with the secret the server was started with, and forging one
 * is exactly what the server must let happen only to whoever holds that
 * secret. The OIDC round trip has its own suite (test-backchannel).
 *
 *   npm run test:acceso     (needs a build; the .sh takes care of the server)
 */
import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:3998";
const SECRETO = process.env.SIGNDROP_SESSION_SECRET ?? "secreto-de-pruebas-con-treinta-y-dos-bytes";

let fallos = 0;
const check = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗"} ${que}${ok ? "" : `  (esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)})`}`);
};

const sellar = (objeto, prefijo, secreto = SECRETO) => {
  const carga = Buffer.from(JSON.stringify(objeto)).toString("base64url");
  return `${carga}.${createHmac("sha256", secreto).update(prefijo + carga).digest("base64url")}`;
};

const sesion = (sub = "persona-de-pruebas", extra = {}) =>
  sellar({ sub, email: `${sub}@example.invalid`, name: "Persona", iat: Date.now(), exp: Date.now() + 3600_000, ...extra }, "");

const invitacion = (opciones = {}) =>
  sellar({ by: "quien-invita", exp: Math.floor(Date.now() / 1000) + 3600, ...opciones.carga }, "guest.", opciones.secreto);

const pedir = (ruta, { cookie, metodo = "GET", cuerpo, tipo, cabeceras = {}, redirect = "manual" } = {}) =>
  fetch(BASE + ruta, {
    method: metodo,
    redirect,
    headers: {
      ...(tipo ? { "content-type": tipo } : {}),
      ...(cookie ? { cookie } : {}),
      ...cabeceras,
    },
    ...(cuerpo !== undefined ? { body: cuerpo } : {}),
  });

const texto = async (res) => (await res.text()).toLowerCase();
const cookiesDe = (res) =>
  Object.fromEntries(
    (res.headers.getSetCookie?.() ?? []).map((linea) => {
      const [par] = linea.split(";");
      const i = par.indexOf("=");
      return [par.slice(0, i).trim(), par.slice(i + 1).trim()];
    })
  );

// ─── 1 · The public door ────────────────────────────────────────────
console.log("Verificar no pide nada, y no lo pedirá nunca");
const verificar = await pedir("/verify");
check("/verify contesta 200 sin cookie", verificar.status, 200);
check("y es la página de verificar", (await texto(verificar)).includes("verify"), true);

console.log("\nY quien llega sin sesión ve la portada, no el espacio de trabajo");
const portada = await pedir("/");
const portadaHtml = await texto(portada);
check("/ contesta 200", portada.status, 200);
check("con la portada", portadaHtml.includes("sign a pdf where it already is"), true);
check("y sin el cargador de documentos", portadaHtml.includes("drop a pdf") || portadaHtml.includes("pdf-uploader"), false);

console.log("\nMientras no se publique, nada se indexa");
const robots = await (await pedir("/robots.txt")).text();
check("robots.txt lo prohíbe todo", /disallow:\s*\/\s*$/im.test(robots.trim()), true);
check("y no anuncia ningún sitemap", robots.toLowerCase().includes("sitemap"), false);

// ─── 2 · Minting an invitation ──────────────────────────────────────
console.log("\nInvitar exige tener cuenta");
const crear = (cookie, cuerpo = { label: "la otra parte", ttlHours: 2 }) =>
  pedir("/api/guest-links", { cookie, metodo: "POST", tipo: "application/json", cuerpo: JSON.stringify(cuerpo) });

check("sin cookie, 401", (await crear(undefined)).status, 401);
check("con una cookie firmada con otro secreto, 401",
  (await crear(`signdrop_session=${sellar({ sub: "x", email: "x@y.z", iat: Date.now(), exp: Date.now() + 3600_000 }, "", "otro-secreto-de-treinta-y-dos-bytes")}`)).status, 401);
check("con una cookie caducada, 401",
  (await crear(`signdrop_session=${sesion("persona", { exp: Date.now() - 1000 })}`)).status, 401);

const conSesion = `signdrop_session=${sesion()}`;
const emitida = await crear(conSesion);
check("con sesión, 200", emitida.status, 200);
const enlace = await emitida.json();
check("y devuelve una URL completa con el host de verdad, que es lo que se pega en un mensaje",
  enlace.url?.startsWith(`${BASE}/invite/`), true);
check("con la caducidad que se pidió", enlace.expiresInHours, 2);

console.log("\nLa caducidad se acota por los dos lados");
check("cuatro meses se recortan a siete días", (await (await crear(conSesion, { ttlHours: 3000 })).json()).expiresInHours, 168);
check("cero se sube a una hora", (await (await crear(conSesion, { ttlHours: 0 })).json()).expiresInHours, 1);

console.log("\nY una petición de otro sitio no vale, ni para invitar ni para salir");
check("invitar con Origin ajeno, 403",
  (await pedir("/api/guest-links", { cookie: conSesion, metodo: "POST", tipo: "application/json", cuerpo: "{}", cabeceras: { origin: "https://evil.example" } })).status, 403);
check("salir con Origin ajeno, 403",
  (await pedir("/api/auth/logout", { cookie: conSesion, metodo: "POST", cabeceras: { origin: "https://evil.example" } })).status, 403);
check("salir es POST: un GET no existe",
  (await pedir("/api/auth/logout", { cookie: conSesion })).status, 405);

// ─── 3 · Using an invitation ────────────────────────────────────────
console.log("\nEl enlace de invitado abre el espacio de trabajo, y solo eso");
const token = new URL(enlace.url).pathname.replace("/invite/", "");
const abierto = await pedir(`/invite/${token}`);
check("la puerta redirige", abierto.status, 302);
check("a la raíz", abierto.headers.get("location")?.endsWith("/"), true);
const galletaInvitado = cookiesDe(abierto).signdrop_guest;
check("y deja el token en una cookie httpOnly, fuera de la barra de direcciones", Boolean(galletaInvitado), true);

const conInvitacion = `signdrop_guest=${galletaInvitado}`;
const espacio = await texto(await pedir("/", { cookie: conInvitacion }));
check("con ella, / ya es el espacio de trabajo", espacio.includes("sign a pdf where it already is"), false);
check("y no la portada", espacio.includes("browser"), true);

check("pero invitar sigue exigiendo cuenta: un invitado no reparte invitaciones",
  (await crear(conInvitacion)).status, 401);

console.log("\nLo que no abre nada");
const malos = [
  ["un token inventado", "no-es-un-token"],
  ["uno firmado con otro secreto", invitacion({ secreto: "otro-secreto-de-treinta-y-dos-bytes" })],
  ["uno caducado", invitacion({ carga: { exp: Math.floor(Date.now() / 1000) - 60 } })],
  ["uno sin emisor", invitacion({ carga: { by: undefined } })],
];
for (const [que, malo] of malos) {
  const res = await pedir(`/invite/${encodeURIComponent(malo)}`);
  const puso = Boolean(cookiesDe(res).signdrop_guest);
  check(`${que}: no deja cookie`, puso, false);
  check(`${que}: y manda a la portada`, res.headers.get("location")?.includes("invite=expired") ?? false, true);
}

console.log("\nLos dos tipos de credencial no se confunden entre sí");
// Ambas son un base64url firmado con el mismo secreto. Sin separar los
// dominios de la firma, una valdría por la otra.
check("una sesión usada como invitación no abre nada",
  Boolean(cookiesDe(await pedir(`/invite/${sesion()}`)).signdrop_guest), false);
check("y una invitación usada como sesión no invita",
  (await crear(`signdrop_session=${invitacion()}`)).status, 401);

// ─── 4 · The time-stamp proxy is not an open proxy ──────────────────
console.log("\nEl proxy de sellos tiene cuota, y se nota antes de salir a la red");
const sellarPeticion = (cookie) =>
  pedir("/api/tsa", { metodo: "POST", tipo: "application/timestamp-query", cuerpo: "", cookie });

let visto429 = false;
let visto400 = 0;
for (let i = 0; i < 25; i++) {
  const res = await sellarPeticion();
  if (res.status === 429) {
    visto429 = true;
    break;
  }
  if (res.status === 400) visto400++;
}
check("un cuerpo vacío no es una petición de sello", visto400 > 0, true);
check("y pasada la cuota anónima contesta 429 sin llamar a la TSA", visto429, true);
check("la cuota es por IP, no global: con sesión todavía se puede",
  [400, 429].includes((await sellarPeticion(conSesion)).status), true);
check("y con sesión la que se agota es la suya, así que aún no", (await sellarPeticion(conSesion)).status, 400);

console.log(`\n${fallos === 0 ? "todo verde" : `${fallos} fallan`}`);
process.exit(fallos === 0 ? 0 : 1);
