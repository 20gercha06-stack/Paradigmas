"use strict";
/**
 * Conversiones y validaciones de entrada: funciones puras (sin base de datos, sin hora del sistema).
 * server.js las usa para pasar de filas SQL / peticiones HTTP a los objetos que esperan
 * las funciones de agenda_funcional.js.
 */

const ok = (valor) => ({ ok: true, valor });
const no = (error) => ({ ok: false, error });

// ---------- Horas y fechas ----------
/** 'HH:MM' o 'HH:MM:SS' -> minutos desde las 00:00; null si no es una hora válida. */
const horaAMinutos = (hora) => {
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(typeof hora === "string" ? hora : "");
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    return h > 23 || min > 59 ? null : h * 60 + min;
};

const pad = (n) => String(n).padStart(2, "0");

/** minutos -> 'HH:MM:00' (formato TIME de MySQL). */
const minutosAHora = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;

/** 'AAAA-MM-DD' -> 'AAAA-MM-DDT00:00:00' (el navegador lo interpreta como hora local, sin desfase). */
const fechaIso = (fecha) => `${String(fecha).slice(0, 10)}T00:00:00`;

/** DATETIME 'AAAA-MM-DD HH:MM:SS' -> { fecha, minutos } (misma forma que `ahora`). */
const datetimeAAhora = (texto) => {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto));
    return m ? { fecha: m[1], minutos: Number(m[2]) * 60 + Number(m[3]) } : null;
};

/** { fecha, minutos } -> 'AAAA-MM-DD HH:MM:00' para guardar en un DATETIME. */
const ahoraADatetime = (ahora) => `${ahora.fecha} ${minutosAHora(ahora.minutos)}`;

// ---------- Identificadores y texto ----------
const idValido = (v) => {
    const n = Number(v);
    return v !== "" && v !== null && v !== undefined && typeof v !== "boolean" &&
        Number.isInteger(n) && n > 0 ? n : null;
};

/** Texto recortado y no vacío de a lo sumo `max` caracteres; null si no cumple. */
const texto = (v, max) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 && t.length <= max ? t : null;
};

const NOMBRE = /^\p{L}[\p{L} .'-]*$/u;
const nombrePropio = (v, max = 40) => {
    const t = texto(v, max);
    return t !== null && NOMBRE.test(t) ? t : null;
};

const MIN_CONTRASENIA = 6;
const contraseniaValida = (v) =>
    typeof v === "string" && v.length >= MIN_CONTRASENIA && v.length <= 45 ? v : null;

// ---------- Citas ----------
const ESTADOS_ACTIVOS = Object.freeze(["Agendada pendiente", "Pagada pendiente por atender", "Atendida"]);
const ESTADOS_CANCELABLES = Object.freeze(["Agendada pendiente", "Pagada pendiente por atender"]);

/** Estatus de la base de datos -> estado que entiende agenda_funcional.js. */
const estadoDeEstatus = (estatus) =>
    estatus === "Agendada pendiente" ? "PENDIENTE_PAGO"
    : estatus === "Pagada pendiente por atender" || estatus === "Atendida" ? "CONFIRMADA"
    : "CANCELADA";

/** Fila de la tabla Cita -> cita pura. */
const filaACita = (f) => ({
    id: String(f.Folio_Cita),
    medico: String(f.Doctor_id_Doctor),
    paciente: String(f.Paciente_id_Paciente),
    fecha: String(f.Fecha).slice(0, 10),
    inicio: horaAMinutos(String(f.Horario)),
    duracion: Number(f.Duracion),
    estado: estadoDeEstatus(f.Estatus),
    creada: datetimeAAhora(f.Fecha_Registro),
});

// ---------- Validación de formularios (devuelven {ok, valor} o {ok:false, error}) ----------
const validarRegistroPaciente = (d) => {
    const c = d ?? {};
    const nombre = nombrePropio(c.nombre);
    if (nombre === null) return no("Nombre inválido: solo letras, hasta 40 caracteres.");
    const apellidos = typeof c.apellidos === "string" ? c.apellidos.trim().split(/\s+/).filter(Boolean) : [];
    if (apellidos.length === 0 || apellidos.some((a) => nombrePropio(a, 50) === null))
        return no("Apellidos inválidos: escribe al menos el apellido paterno (solo letras).");
    const ciudad = nombrePropio(c.ciudad, 45);
    if (ciudad === null) return no("Ciudad inválida.");
    const calle = texto(c.calle, 50);
    if (calle === null) return no("Calle inválida: es obligatoria (máx. 50 caracteres).");
    const colonia = texto(c.colonia, 50);
    if (colonia === null) return no("Colonia inválida: es obligatoria (máx. 50 caracteres).");
    const numero = texto(c.numero, 10);
    if (numero === null || !/^[\p{L}\d][\p{L}\d \-/]*$/u.test(numero))
        return no("Número inválido: hasta 10 caracteres (letras, números, - o /).");
    const contrasenia = contraseniaValida(c.contrasenia);
    if (contrasenia === null) return no(`Contraseña inválida: mínimo ${MIN_CONTRASENIA} caracteres.`);
    return ok({
        nombre, ap_paterno: apellidos[0], ap_materno: apellidos.slice(1).join(" ") || null,
        ciudad, calle, colonia, numero, contrasenia,
    });
};

const validarAltaPersonal = (d) => {
    const c = d ?? {};
    const tipo = c.tipo;
    if (tipo !== "Doctor" && tipo !== "Recepcionista") return no("Tipo de personal inválido (Doctor o Recepcionista).");
    const nombre = nombrePropio(c.nombre);
    const ap_paterno = nombrePropio(c.ap_paterno, 50);
    const ap_materno = nombrePropio(c.ap_materno, 50);
    if (nombre === null || ap_paterno === null || ap_materno === null)
        return no("Nombre y apellidos inválidos: solo letras.");
    const contrasenia = contraseniaValida(c.contrasenia);
    if (contrasenia === null) return no(`Contraseña inválida: mínimo ${MIN_CONTRASENIA} caracteres.`);
    const inicio = horaAMinutos(c.hora_inicio), fin = horaAMinutos(c.hora_fin);
    if (inicio === null || fin === null || inicio >= fin)
        return no("Horario inválido: usa HH:MM y que la entrada sea anterior a la salida.");
    const sueldo = Number(c.sueldo);
    if (c.sueldo === "" || c.sueldo === null || c.sueldo === undefined || !Number.isFinite(sueldo) || sueldo < 0)
        return no("Sueldo inválido.");
    const base = { tipo, nombre, ap_paterno, ap_materno, contrasenia, sueldo, hora_inicio: minutosAHora(inicio), hora_fin: minutosAHora(fin) };
    if (tipo === "Recepcionista") return ok(base);
    const cedula = texto(c.cedula, 15);
    const especialidad = idValido(c.especialidad_id);
    const consultorio = idValido(c.consultorio);
    if (cedula === null || !/^[A-Za-z0-9]+$/.test(cedula)) return no("Cédula profesional inválida (letras y números, máx. 15).");
    if (especialidad === null) return no("Especialidad inválida.");
    if (consultorio === null) return no("Número de consultorio inválido.");
    return ok({ ...base, cedula, especialidad, consultorio });
};

/** Escapa % y _ para usar un texto literal dentro de un LIKE. */
const escaparLike = (t) => String(t ?? "").replace(/[\\%_]/g, (ch) => `\\${ch}`);

module.exports = {
    pad, horaAMinutos, minutosAHora, fechaIso, datetimeAAhora, ahoraADatetime,
    idValido, texto, nombrePropio, contraseniaValida,
    ESTADOS_ACTIVOS, ESTADOS_CANCELABLES, estadoDeEstatus, filaACita,
    validarRegistroPaciente, validarAltaPersonal, escaparLike,
};
