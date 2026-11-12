"use strict";
/**
 * Núcleo funcional del gestor de citas.
 *
 * Todo lo de este archivo son funciones puras: no leen la hora del sistema,
 * no tocan la base de datos y no modifican sus argumentos. La hora actual
 * entra siempre como parámetro `ahora`.
 *
 * Formatos:
 *   fecha   -> texto 'AAAA-MM-DD'
 *   minutos -> entero, minutos desde las 00:00 (09:30 = 570)
 *   ahora   -> { fecha, minutos }
 *   cita    -> { id, medico, paciente, fecha, inicio, duracion, estado?, creada? }
 *              estado: 'PENDIENTE_PAGO' | 'CONFIRMADA' | 'CANCELADA'
 *              creada: el `ahora` del momento en que se agendó
 */

// ---------- Constantes de las reglas de negocio ----------
const DURACION_MAXIMA = 240;          // minutos
const HORAS_MIN_ANTICIPACION = 48;    // req. 8: mínimo para agendar
const MESES_MAX_ANTICIPACION = 3;     // req. 8: máximo para agendar
const HORAS_PARA_CANCELAR = 8;        // req. 2
const HORAS_PARA_PAGAR = 8;           // req. 7
const PORCENTAJE_REEMBOLSO = 50;      // req. 9

// ---------- Resultados ----------
const exito = (extra = {}) => ({ exito: true, ...extra });
const fallo = (error) => ({ exito: false, error });

// ---------- Fechas (sin zona horaria: hora local del hospital) ----------
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const esFechaValida = (fecha) => {
    if (typeof fecha !== "string" || !FORMATO_FECHA.test(fecha)) return false;
    const [a, m, d] = fecha.split("-").map(Number);
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
};

/** Minutos transcurridos desde 1970-01-01 00:00 para una fecha y hora local. */
const aMinutosAbsolutos = (fecha, minutos) => {
    const [a, m, d] = fecha.split("-").map(Number);
    return Date.UTC(a, m - 1, d) / 60000 + minutos;
};

const absolutoDeCita = (cita) => aMinutosAbsolutos(cita.fecha, cita.inicio);
const absolutoDeAhora = (ahora) => aMinutosAbsolutos(ahora.fecha, ahora.minutos);

/** Suma meses a una fecha; si el día no existe en el mes destino usa el último. */
const sumarMeses = (fecha, meses) => {
    const [a, m, d] = fecha.split("-").map(Number);
    const total = (m - 1) + meses;
    const anio = a + Math.floor(total / 12);
    const mes = ((total % 12) + 12) % 12;
    const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    const dia = Math.min(d, ultimoDia);
    return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};

// ---------- Cálculos básicos ----------
const finDeCita = (cita) => cita.inicio + cita.duracion;

const hhmm = (min) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const estaActiva = (cita) => cita.estado !== "CANCELADA";

/** Mismo día y los intervalos se cruzan. Citas contiguas (fin == inicio) no chocan. */
const chocanHoras = (a, b) =>
    a.fecha === b.fecha && a.inicio < finDeCita(b) && b.inicio < finDeCita(a);

/** Choque de doctor: mismo médico y horas cruzadas. */
const seTraslapan = (a, b) => a.medico === b.medico && chocanHoras(a, b);

/** Choque de paciente (req. 5): mismo paciente y horas cruzadas, con cualquier doctor. */
const pacienteTieneChoque = (nueva, agenda) =>
    agenda.filter((c) => estaActiva(c) && c.paciente === nueva.paciente && chocanHoras(nueva, c));

// ---------- Validaciones de la cita (cada una devuelve {ok, valor|error}) ----------
const ok = (valor) => ({ ok: true, valor });
const no = (error) => ({ ok: false, error });

const validarTipos = (cita) => {
    if (!cita || typeof cita.id !== "string" || cita.id === "" ||
        typeof cita.medico !== "string" || cita.medico === "" ||
        typeof cita.paciente !== "string" || cita.paciente === "")
        return no("Datos inválidos: faltan id, doctor o paciente");
    if (!Number.isInteger(cita.inicio) || !Number.isInteger(cita.duracion))
        return no("Datos inválidos: inicio y duración deben ser enteros");
    if (!esFechaValida(cita.fecha))
        return no("Datos inválidos: la fecha debe tener formato AAAA-MM-DD y existir");
    return ok(cita);
};

const validarDuracion = (cita) =>
    cita.duracion <= 0 ? no("Duración inválida: debe ser mayor que cero")
    : cita.duracion > DURACION_MAXIMA ? no(`Duración inválida: máximo ${DURACION_MAXIMA} minutos`)
    : ok(cita);

// Devuelve un validador (currying) para la jornada indicada.
const validarJornada = (jornada) => (cita) =>
    cita.inicio >= jornada.inicio && finDeCita(cita) <= jornada.fin
        ? ok(cita)
        : no(`Fuera de jornada (${hhmm(jornada.inicio)}-${hhmm(jornada.fin)})`);

/** req. 11: no se agenda en el pasado. */
const esFechaPasada = (cita, ahora) => absolutoDeCita(cita) < absolutoDeAhora(ahora);

const validarNoPasada = (ahora) => (cita) =>
    esFechaPasada(cita, ahora) ? no("Fecha pasada: no se puede agendar antes de la hora actual") : ok(cita);

/** req. 8: de 48 horas a 3 meses de anticipación, ambos límites incluidos. */
const dentroDeVentana = (cita, ahora) => {
    const falta = absolutoDeCita(cita) - absolutoDeAhora(ahora);
    const limite = aMinutosAbsolutos(sumarMeses(ahora.fecha, MESES_MAX_ANTICIPACION), ahora.minutos);
    return falta >= HORAS_MIN_ANTICIPACION * 60 && absolutoDeCita(cita) <= limite;
};

const validarVentana = (ahora) => (cita) =>
    dentroDeVentana(cita, ahora)
        ? ok(cita)
        : no(`Fuera de ventana: la cita debe agendarse con ${HORAS_MIN_ANTICIPACION} horas a ${MESES_MAX_ANTICIPACION} meses de anticipación`);

// Pipeline: cada validador solo corre si el anterior tuvo éxito.
const validarCita = (cita, jornada, ahora) => {
    const validadores = [
        validarTipos,
        validarDuracion,
        validarJornada(jornada),
        validarNoPasada(ahora),
        validarVentana(ahora),
    ];
    return validadores.reduce((res, v) => (res.ok ? v(res.valor) : res), ok(cita));
};

// ---------- Funcionalidad principal ----------
/**
 * Agenda una cita. Devuelve {exito:true, agenda: <agenda NUEVA>} o {exito:false, error}.
 * `agenda` debe traer las citas del doctor y del paciente ese día; no se modifica.
 */
const agendar = (agenda, nueva, jornada, ahora) => {
    const valida = validarCita(nueva, jornada, ahora);
    if (!valida.ok) return fallo(valida.error);

    const activas = agenda.filter(estaActiva);

    if (activas.some((c) => c.id === nueva.id))
        return fallo(`Identificador duplicado: ${nueva.id}`);

    const choquesDoctor = activas.filter((c) => seTraslapan(nueva, c));
    if (choquesDoctor.length > 0)
        return fallo(`Traslape con la(s) cita(s): ${choquesDoctor.map((c) => c.id).join(" | ")}`);

    const choquesPaciente = pacienteTieneChoque(nueva, activas);
    if (choquesPaciente.length > 0)
        return fallo(`El paciente ya tiene cita en ese horario: ${choquesPaciente.map((c) => c.id).join(" | ")}`);

    const registrada = { ...nueva, estado: "PENDIENTE_PAGO", creada: ahora };
    const nuevaAgenda = [...agenda, registrada].sort(
        (a, b) => absolutoDeCita(a) - absolutoDeCita(b));
    return exito({ agenda: nuevaAgenda });
};

// ---------- Cancelación y pago ----------
/** req. 2: se puede cancelar si faltan 8 horas o más (8 exactas incluidas). */
const puedeCancelar = (cita, ahora) =>
    absolutoDeCita(cita) - absolutoDeAhora(ahora) >= HORAS_PARA_CANCELAR * 60;

/** req. 7: el pago es válido hasta 8 horas después de agendar (8 exactas incluidas). */
const pagoVigente = (cita, ahora) => {
    const transcurrido = absolutoDeAhora(ahora) - absolutoDeAhora(cita.creada);
    return transcurrido >= 0 && transcurrido <= HORAS_PARA_PAGAR * 60;
};

/** req. 9: reembolso del 50 % del monto pagado; 0 si no hay pago. */
const calcularReembolso = (pago) =>
    pago && pago.monto > 0 ? Math.round(pago.monto * PORCENTAJE_REEMBOLSO) / 100 : 0;

/**
 * Cancela una cita. Devuelve {exito:true, agenda: <nueva>, reembolso} o {exito:false, error}.
 * `pago` es opcional: si la cita estaba pagada se calcula el reembolso.
 */
const cancelarCita = (agenda, citaId, ahora, pago) => {
    const cita = agenda.find((c) => c.id === citaId);
    if (!cita) return fallo(`Cita no encontrada: ${citaId}`);
    if (!estaActiva(cita)) return fallo(`La cita ya está cancelada: ${citaId}`);
    if (!puedeCancelar(cita, ahora))
        return fallo(`Cancelación rechazada: se requieren ${HORAS_PARA_CANCELAR} horas de anticipación`);

    const nuevaAgenda = agenda.map((c) => (c.id === citaId ? { ...c, estado: "CANCELADA" } : c));
    return exito({ agenda: nuevaAgenda, reembolso: calcularReembolso(pago) });
};

// ---------- Barrido periódico (req. 7 y "no acudió") ----------
/** Citas pendientes de pago cuyo plazo de 8 horas ya venció. */
const citasConPagoVencido = (citas, ahora) =>
    citas.filter((c) => c.estado === "PENDIENTE_PAGO" && !pagoVigente(c, ahora));

/** Citas pagadas cuya fecha ya pasó sin haberse atendido. */
const citasNoAcudidas = (citas, ahora) =>
    citas.filter((c) => c.estado === "CONFIRMADA" && c.fecha < ahora.fecha);

// ---------- Horarios libres ----------
/** Huecos [inicio, fin] del doctor en una fecha, de al menos `duracionMin` minutos. */
const huecosLibres = (agenda, medico, fecha, duracionMin, jornada) => {
    const delDia = agenda
        .filter((c) => estaActiva(c) && c.medico === medico && c.fecha === fecha)
        .sort((a, b) => a.inicio - b.inicio);

    const paso = (acum, c) => ({
        huecos: c.inicio > acum.cursor ? [...acum.huecos, [acum.cursor, c.inicio]] : acum.huecos,
        cursor: Math.max(acum.cursor, finDeCita(c)),
    });

    const final = delDia.reduce(paso, { huecos: [], cursor: jornada.inicio });
    const todos = final.cursor < jornada.fin ? [...final.huecos, [final.cursor, jornada.fin]] : final.huecos;
    return todos.filter((h) => h[1] - h[0] >= duracionMin);
};

module.exports = {
    DURACION_MAXIMA, HORAS_PARA_CANCELAR, HORAS_PARA_PAGAR,
    esFechaValida, aMinutosAbsolutos, sumarMeses, hhmm,
    finDeCita, seTraslapan, chocanHoras, pacienteTieneChoque,
    validarCita, esFechaPasada, dentroDeVentana,
    agendar, puedeCancelar, pagoVigente, calcularReembolso, cancelarCita, huecosLibres,
    PORCENTAJE_REEMBOLSO, citasConPagoVencido, citasNoAcudidas,
};
