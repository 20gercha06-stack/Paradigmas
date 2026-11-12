"use strict";
const fs = require("fs");
const {
    finDeCita, agendar, huecosLibres, cancelarCita, calcularReembolso,
    pagoVigente, validarCita, citasConPagoVencido, citasNoAcudidas,
} = require("./agenda_funcional.js");

const JORNADA = { inicio: 480, fin: 1080 };               // 08:00 a 18:00
const AHORA = { fecha: "2026-11-02", minutos: 600 };      // 2 nov 2026, 10:00 (fijo para todas las pruebas)

// Constructor de citas de prueba: C(id, doctor, paciente, fecha, inicio, duracion)
const C = (id, medico, paciente, fecha, inicio, duracion, extra = {}) =>
    ({ id, medico, paciente, fecha, inicio, duracion, ...extra });

const FECHA_OK = "2026-11-07";                            // 5 días después de AHORA
const base = [C("C1", "D1", "P1", FECHA_OK, 540, 30)];    // 09:00 a 09:30

const ids = (r) => (r.exito ? r.agenda.map((c) => c.id) : r.error);

const deepFreeze = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); });
    return Object.freeze(o);
};

// ESPERADO se define aquí antes de ejecutar cada prueba.
// [id, escenario, entrada, esperado, () => obtenido]
const casos = [
    ["P01", "Calcular el final de una cita", "Inicio 540, duración 30", 570,
        () => finDeCita({ inicio: 540, duracion: 30 })],
    ["P02", "Agendar en horario libre", "Agenda vacía; cita 09:00, 30 min, a 5 días",
        [true, "PENDIENTE_PAGO"],
        () => { const r = agendar([], C("N", "D1", "P1", FECHA_OK, 540, 30), JORNADA, AHORA); return [r.exito, r.agenda[0].estado]; }],
    ["P03", "Traslape parcial, mismo doctor", "Existe 09:00-09:30; nueva 09:15-09:45",
        "Traslape con la(s) cita(s): C1",
        () => agendar(base, C("N", "D1", "P2", FECHA_OK, 555, 30), JORNADA, AHORA).error],
    ["P04", "Cita contigua (límite)", "Existe 09:00-09:30; nueva 09:30-10:00",
        ["C1", "N"],
        () => ids(agendar(base, C("N", "D1", "P2", FECHA_OK, 570, 30), JORNADA, AHORA))],
    ["P05", "Fuera de la jornada", "Inicio 07:00 con jornada 08:00-18:00",
        "Fuera de jornada (08:00-18:00)",
        () => agendar([], C("N", "D1", "P1", FECHA_OK, 420, 30), JORNADA, AHORA).error],
    ["P06", "Menos de 48 h (límite)", "Cita el 4 nov a las 09:59 (47 h 59 min)",
        "Fuera de ventana: la cita debe agendarse con 48 horas a 3 meses de anticipación",
        () => agendar([], C("N", "D1", "P1", "2026-11-04", 599, 30), JORNADA, AHORA).error],
    ["P07", "Exactamente 48 h (límite)", "Cita el 4 nov a las 10:00",
        true,
        () => agendar([], C("N", "D1", "P1", "2026-11-04", 600, 30), JORNADA, AHORA).exito],
    ["P08", "Más de 3 meses", "Cita el 3 feb 2027 a las 10:00 (3 meses y 1 día)",
        "Fuera de ventana: la cita debe agendarse con 48 horas a 3 meses de anticipación",
        () => agendar([], C("N", "D1", "P1", "2027-02-03", 600, 30), JORNADA, AHORA).error],
    ["P09", "Fecha pasada", "Cita del 1 nov 2026",
        "Fecha pasada: no se puede agendar antes de la hora actual",
        () => agendar([], C("N", "D1", "P1", "2026-11-01", 600, 30), JORNADA, AHORA).error],
    ["P10", "Paciente con dos citas a la misma hora", "P1 ya tiene 09:00 con D1; nueva 09:00 con D2",
        "El paciente ya tiene cita en ese horario: C1",
        () => agendar(base, C("N", "D2", "P1", FECHA_OK, 540, 30), JORNADA, AHORA).error],
    ["P11", "Paciente con citas en horas distintas", "P1 tiene 09:00 con D1; nueva 11:00 con D2",
        ["C1", "N"],
        () => ids(agendar(base, C("N", "D2", "P1", FECHA_OK, 660, 30), JORNADA, AHORA))],
    ["P12", "Cancelar con 8 h exactas (límite) y reembolso", "Cita 5 nov 10:00; ahora 5 nov 02:00; pago de 500",
        [true, "CANCELADA", 250],
        () => {
            const ag = [C("C1", "D1", "P1", "2026-11-05", 600, 30, { estado: "CONFIRMADA" })];
            const r = cancelarCita(ag, "C1", { fecha: "2026-11-05", minutos: 120 }, { monto: 500 });
            return [r.exito, r.agenda[0].estado, r.reembolso];
        }],
    ["P13", "Cancelar con menos de 8 h", "Cita 5 nov 10:00; ahora 5 nov 02:01",
        "Cancelación rechazada: se requieren 8 horas de anticipación",
        () => cancelarCita([C("C1", "D1", "P1", "2026-11-05", 600, 30)], "C1", { fecha: "2026-11-05", minutos: 121 }).error],
    ["P14", "Cancelar una cita inexistente", "Id X9 que no existe",
        "Cita no encontrada: X9",
        () => cancelarCita(base, "X9", AHORA).error],
    ["P15", "Reembolso del 50 %", "Pago de 500",
        250, () => calcularReembolso({ monto: 500 })],
    ["P16", "Pago a las 8 h exactas (límite)", "Agendada 2 nov 10:00; ahora 2 nov 18:00",
        true, () => pagoVigente({ creada: AHORA }, { fecha: "2026-11-02", minutos: 1080 })],
    ["P17", "Pago pasadas las 8 h", "Agendada 2 nov 10:00; ahora 2 nov 18:01",
        false, () => pagoVigente({ creada: AHORA }, { fecha: "2026-11-02", minutos: 1081 })],
    ["P18", "Huecos con agenda vacía", "Sin citas, doctor D1",
        [[480, 1080]], () => huecosLibres([], "D1", FECHA_OK, 30, JORNADA)],
    ["P19", "Huecos con una cita y duración mínima", "C1 09:00-09:30; mínimo 45 min",
        [[480, 540], [570, 1080]], () => huecosLibres(base, "D1", FECHA_OK, 45, JORNADA)],
    ["P20", "Cita cancelada libera el horario", "C1 CANCELADA 09:00; nueva 09:00 del mismo doctor",
        ["C1", "N"],
        () => ids(agendar([{ ...base[0], estado: "CANCELADA" }], C("N", "D1", "P1", FECHA_OK, 540, 30), JORNADA, AHORA))],
    ["P21", "Mismo horario en otro día no choca", "C1 el 7 nov 09:00; nueva el 8 nov 09:00 (mismo doctor y paciente)",
        true, () => agendar(base, C("N", "D1", "P1", "2026-11-08", 540, 30), JORNADA, AHORA).exito],
    ["P22", "Duración negativa", "Duración -15",
        "Duración inválida: debe ser mayor que cero",
        () => validarCita(C("N", "D1", "P1", FECHA_OK, 540, -15), JORNADA, AHORA).error],
    ["P23", "Duración como texto", "Duración '30'",
        "Datos inválidos: inicio y duración deben ser enteros",
        () => validarCita(C("N", "D1", "P1", FECHA_OK, 540, "30"), JORNADA, AHORA).error],
    ["P24", "Fecha inexistente", "Fecha 2026-13-45",
        "Datos inválidos: la fecha debe tener formato AAAA-MM-DD y existir",
        () => validarCita(C("N", "D1", "P1", "2026-13-45", 540, 30), JORNADA, AHORA).error],
    ["P25", "Identificador duplicado", "Nueva con id C1",
        "Identificador duplicado: C1",
        () => agendar(base, C("C1", "D1", "P2", FECHA_OK, 700, 30), JORNADA, AHORA).error],
    ["P26", "Las funciones no modifican la agenda", "Agenda congelada; agendar, cancelar y huecos; compara antes y después",
        true,
        () => {
            const ag = deepFreeze([C("C1", "D1", "P1", FECHA_OK, 540, 30, { estado: "CONFIRMADA" })]);
            const antes = JSON.stringify(ag);
            agendar(ag, C("N", "D1", "P2", FECHA_OK, 600, 30), JORNADA, AHORA);
            cancelarCita(ag, "C1", AHORA, { monto: 500 });
            huecosLibres(ag, "D1", FECHA_OK, 30, JORNADA);
            return JSON.stringify(ag) === antes;   // si alguna función mutara, lanzaría error al estar congelada
        }],
    ["P27", "Barrido: pago vencido a las 8 h y 1 min (límite)", "Cita pendiente creada hace 481 min",
        JSON.stringify(["V"]),
        () => JSON.stringify(citasConPagoVencido(
            [C("V", "D1", "P1", FECHA_OK, 540, 30, { estado: "PENDIENTE_PAGO", creada: { fecha: "2026-11-02", minutos: 119 } })],
            AHORA).map((c) => c.id))],
    ["P28", "Barrido: pago vigente a las 8 h exactas (límite)", "Cita pendiente creada hace 480 min",
        JSON.stringify([]),
        () => JSON.stringify(citasConPagoVencido(
            [C("V", "D1", "P1", FECHA_OK, 540, 30, { estado: "PENDIENTE_PAGO", creada: { fecha: "2026-11-02", minutos: 120 } })],
            AHORA).map((c) => c.id))],
    ["P29", "Barrido: cita pagada de ayer sin atender = no acudió", "Cita CONFIRMADA del 2026-11-01",
        JSON.stringify(["A"]),
        () => JSON.stringify(citasNoAcudidas(
            [C("A", "D1", "P1", "2026-11-01", 540, 30, { estado: "CONFIRMADA" }),
             C("B", "D1", "P1", "2026-11-02", 540, 30, { estado: "CONFIRMADA" }),
             C("E", "D1", "P1", "2026-11-01", 600, 30, { estado: "PENDIENTE_PAGO" })],
            AHORA).map((c) => c.id))],
    ["P30", "Barrido sin citas", "Lista vacía", JSON.stringify([[], []]),
        () => JSON.stringify([citasConPagoVencido([], AHORA), citasNoAcudidas([], AHORA)])],
];

console.log("--- EJECUCIÓN DE PRUEBAS ---");
const filas = casos.map(([id, escenario, entrada, esperado, fn]) => {
    let obtenido;
    try { obtenido = fn(); } catch (e) { obtenido = `EXCEPCIÓN ${e.message}`; }
    const esp = JSON.stringify(esperado), obt = JSON.stringify(obtenido);
    const estado = esp === obt ? "Aprobada" : "Fallida";
    console.log(`${id} | ${estado} | ${escenario} | esp=${esp} | obt=${obt}`);
    return { id, escenario, entrada, esperado: esp, obtenido: obt, estado };
});

const aprobadas = filas.filter((f) => f.estado === "Aprobada").length;
console.log(`\nTotal: ${filas.length}   Aprobadas: ${aprobadas}   Fallidas: ${filas.length - aprobadas}`);
fs.writeFileSync(`${__dirname}/resultados_pruebas.json`, JSON.stringify(filas, null, 1));
process.exitCode = aprobadas === filas.length ? 0 : 1;
