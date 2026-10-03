"use strict";
const fs = require("fs");
const {
  crearCita: C, finDeCita, validarCita, agendar, huecosLibres, compose,
} = require("./agenda_funcional");

const base = Object.freeze([C("C1", "Ruiz", 540, 30), C("C2", "Ruiz", 600, 60)]);
const ids = (r) => (r.ok ? r.valor.map((c) => c.id) : r.error);
const j = (x) => JSON.stringify(x);

// [id, escenario, entrada, ESPERADO (definido antes de ejecutar), función]
const casos = [
  ["P01", "Calcular el final de una cita", "Inicio 540, duración 30", 570,
    () => finDeCita(C("X", "Ruiz", 540, 30))],
  ["P02", "Duración negativa", "Inicio 540, duración -15",
    "Duración inválida: debe ser mayor que cero",
    () => validarCita(C("X", "Ruiz", 540, -15)).error],
  ["P03", "Duración cero (límite)", "Inicio 540, duración 0",
    "Duración inválida: debe ser mayor que cero",
    () => validarCita(C("X", "Ruiz", 540, 0)).error],
  ["P04", "Inicio antes de la jornada", "Inicio 420 (07:00), duración 30",
    "Fuera de jornada (08:00-18:00)",
    () => validarCita(C("X", "Ruiz", 420, 30)).error],
  ["P05", "Termina después del cierre", "Inicio 1060, duración 30",
    "Fuera de jornada (08:00-18:00)",
    () => validarCita(C("X", "Ruiz", 1060, 30)).error],
  ["P06", "Termina exactamente al cierre (límite)", "Inicio 1050, duración 30",
    true, () => validarCita(C("X", "Ruiz", 1050, 30)).ok],
  ["P07", "Agendar en agenda vacía", "Agenda [], cita X 540/30",
    j(["X"]), () => j(ids(agendar([], C("X", "Ruiz", 540, 30))))],
  ["P08", "Traslape parcial, mismo médico", "Agenda C1(540/30), C2(600/60); nueva 560/30",
    "Traslape con la(s) cita(s): C1",
    () => agendar(base, C("N", "Ruiz", 560, 30)).error],
  ["P09", "Cita contigua (fin = inicio, límite)", "Nueva 570/30 entre C1 y C2",
    j(["C1", "N", "C2"]), () => j(ids(agendar(base, C("N", "Ruiz", 570, 30))))],
  ["P10", "Mismo horario, otro médico", "Nueva 540/30, médico Soto",
    j(["C1", "N", "C2"]), () => j(ids(agendar(base, C("N", "Soto", 540, 30))))],
  ["P11", "Identificador duplicado", "Nueva con id C1",
    "Identificador duplicado: C1",
    () => agendar(base, C("C1", "Ruiz", 700, 30)).error],
  ["P12", "Huecos con agenda vacía", "Agenda [], médico Ruiz",
    j([[480, 1080]]), () => j(huecosLibres([], "Ruiz"))],
  ["P13", "Huecos con dos citas", "Agenda base, médico Ruiz",
    j([[480, 540], [570, 600], [660, 1080]]), () => j(huecosLibres(base, "Ruiz"))],
  ["P14", "Huecos con duración mínima 45", "Agenda base, mínimo 45 min",
    j([[480, 540], [660, 1080]]), () => j(huecosLibres(base, "Ruiz", 45))],
  ["P15", "La agenda original no se modifica", "agendar(base, 570/30) y compara base",
    true, () => {
      const antes = j(base);
      agendar(base, C("N", "Ruiz", 570, 30));
      huecosLibres(base, "Ruiz");
      return j(base) === antes && base.length === 2 && Object.isFrozen(base);
    }],
  ["P16", "Tipo inválido (duración como texto)", "Duración '30'",
    "Datos inválidos: inicio y duración deben ser enteros",
    () => validarCita(C("X", "Ruiz", 540, "30")).error],
  ["P17", "Jornada llena (sin huecos)", "Cita 480/600 de Ruiz",
    j([]), () => j(huecosLibres([C("L", "Ruiz", 480, 600)], "Ruiz"))],
  ["P18", "Composición de funciones", "compose(x+1, x*2)(5)",
    11, () => compose((x) => x + 1, (x) => x * 2)(5)],
];

const filas = casos.map(([id, escenario, entrada, esperado, fn]) => {
  let obtenido;
  try { obtenido = fn(); } catch (e) { obtenido = `EXCEPCIÓN ${e.message}`; }
  return {
    id, escenario, entrada,
    esperado: String(esperado), obtenido: String(obtenido),
    estado: obtenido === esperado ? "Aprobada" : "Fallida",
  };
});

filas.forEach((f) =>
  console.log(`${f.id} | ${f.estado.padEnd(8)} | ${f.escenario} | esp=${f.esperado} | obt=${f.obtenido}`));
console.log(`\nTotal: ${filas.length}  Aprobadas: ${filas.filter((f) => f.estado === "Aprobada").length}`);
fs.writeFileSync("resultados.json", JSON.stringify(filas, null, 1));
