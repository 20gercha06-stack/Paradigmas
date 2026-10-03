"use strict";
/**
 * Agenda de citas con paradigma funcional (JavaScript).
 *
 * Funcionalidad: validar y agendar una cita sin traslapes, y calcular los
 * huecos libres de un médico. Los tiempos son minutos desde las 00:00.
 *
 * - Funciones puras: sin efectos secundarios, misma entrada -> misma salida.
 * - Inmutabilidad: objetos congelados (Object.freeze); agendar() devuelve
 *   una agenda NUEVA sin tocar la original.
 * - Orden superior / lambdas: filter, reduce, some, map, compose.
 * - La E/S (console.log) vive solo en main().
 */

const JORNADA = Object.freeze({ inicio: 480, fin: 1080 }); // 08:00 - 18:00
const DURACION_MAXIMA = 240; // minutos

// ---------- Constructores inmutables ----------
const crearCita = (id, medico, inicio, duracion) =>
  Object.freeze({ id, medico, inicio, duracion });

const exito = (valor) => Object.freeze({ ok: true, valor, error: "" });
const fallo = (error) => Object.freeze({ ok: false, valor: null, error });

// ---------- Composición ----------
// compose(f, g, h)(x) === f(g(h(x)))
const compose = (...fs) => (x) => fs.reduceRight((acc, f) => f(acc), x);

// ---------- Cálculos puros ----------
const finDeCita = (c) => c.inicio + c.duracion;

const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Citas contiguas (fin === inicio) NO chocan.
const seTraslapan = (a, b) =>
  a.medico === b.medico && a.inicio < finDeCita(b) && b.inicio < finDeCita(a);

const conflictos = (nueva, agenda) => agenda.filter((c) => seTraslapan(nueva, c));

// ---------- Validaciones (cada una devuelve un resultado) ----------
const validarTipos = (c) =>
  Number.isInteger(c.inicio) && Number.isInteger(c.duracion)
    ? exito(c)
    : fallo("Datos inválidos: inicio y duración deben ser enteros");

const validarDuracion = (c) =>
  c.duracion <= 0
    ? fallo("Duración inválida: debe ser mayor que cero")
    : c.duracion > DURACION_MAXIMA
    ? fallo(`Duración inválida: máximo ${DURACION_MAXIMA} minutos`)
    : exito(c);

const validarJornada = (jornada) => (c) =>
  c.inicio < jornada.inicio || finDeCita(c) > jornada.fin
    ? fallo(`Fuera de jornada (${hhmm(jornada.inicio)}-${hhmm(jornada.fin)})`)
    : exito(c);

// Aplica el siguiente validador solo si el anterior tuvo éxito.
const encadenar = (resultado, validador) =>
  resultado.ok ? validador(resultado.valor) : resultado;

const validarCita = (c, jornada = JORNADA) =>
  [validarTipos, validarDuracion, validarJornada(jornada)].reduce(encadenar, exito(c));

// ---------- Funcionalidad principal ----------
// Devuelve exito(nuevaAgenda) o fallo(mensaje). No modifica `agenda`.
const agendar = (agenda, nueva, jornada = JORNADA) => {
  const valida = validarCita(nueva, jornada);
  if (!valida.ok) return valida;
  if (agenda.some((c) => c.id === nueva.id))
    return fallo(`Identificador duplicado: ${nueva.id}`);
  const choques = conflictos(nueva, agenda);
  if (choques.length > 0)
    return fallo(`Traslape con la(s) cita(s): ${choques.map((c) => c.id).join(", ")}`);
  return exito(Object.freeze([...agenda, nueva].sort((a, b) => a.inicio - b.inicio)));
};

// Intervalos libres [inicio, fin] del médico con al menos `duracionMin`.
const huecosLibres = (agenda, medico, duracionMin = 1, jornada = JORNADA) => {
  const delMedico = agenda
    .filter((c) => c.medico === medico)
    .sort((a, b) => a.inicio - b.inicio); // filter ya devolvió copia

  const paso = ({ huecos, cursor }, c) => ({
    huecos: c.inicio > cursor ? [...huecos, [cursor, c.inicio]] : huecos,
    cursor: Math.max(cursor, finDeCita(c)),
  });

  const { huecos, cursor } = delMedico.reduce(paso, { huecos: [], cursor: jornada.inicio });
  const todos = cursor < jornada.fin ? [...huecos, [cursor, jornada.fin]] : huecos;
  return todos.filter(([ini, fin]) => fin - ini >= duracionMin);
};

// ---------- Entrada/Salida (única parte con efectos) ----------
const main = () => {
  const agenda = Object.freeze([
    crearCita("C1", "Dra. Ruiz", 540, 30),
    crearCita("C2", "Dra. Ruiz", 600, 60),
  ]);
  const r = agendar(agenda, crearCita("C3", "Dra. Ruiz", 570, 30));
  console.log("Agendar C3:", r.ok ? r.valor.map((c) => c.id) : r.error);
  huecosLibres(agenda, "Dra. Ruiz", 30).forEach(([i, f]) =>
    console.log(`Hueco libre: ${hhmm(i)} - ${hhmm(f)}`)
  );
};

module.exports = {
  JORNADA, crearCita, exito, fallo, compose, finDeCita, hhmm, seTraslapan,
  conflictos, validarTipos, validarDuracion, validarJornada, validarCita,
  agendar, huecosLibres,
};

if (require.main === module) main();
