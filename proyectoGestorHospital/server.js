"use strict";
/**
 * Servidor del gestor de citas (única capa con entrada/salida).
 *
 * Qué hace cada parte:
 *  - Lee de MySQL y convierte las filas con conversiones.js (funciones puras).
 *  - Decide con agenda_funcional.js (funciones puras): traslapes, jornada, ventana de 48 h a 3 meses,
 *    cancelar con 8 h, plazo de pago de 8 h, reembolso del 50 %.
 *  - Guarda el resultado. La hora actual se lee SOLO aquí (`reloj`) y se pasa como parámetro.
 */
require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const {
    agendar, cancelarCita, pagoVigente, citasConPagoVencido, citasNoAcudidas, PORCENTAJE_REEMBOLSO,
    esFechaValida,
} = require("./agenda_funcional.js");
const C = require("./conversiones.js");

const DURACION_CITA = 30; // minutos por consulta

// ---------- Efecto: la hora actual vive aquí, no en las funciones puras ----------
const ahoraLocal = (d = new Date()) => ({
    fecha: `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`,
    minutos: d.getHours() * 60 + d.getMinutes(),
});

class ErrorHttp extends Error {
    constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}
const falla = (estado, mensaje) => { throw new ErrorHttp(estado, mensaje); };
const responde = (estado, cuerpo) => ({ estado, cuerpo });

const ACTIVAS_SQL = C.ESTADOS_ACTIVOS.map((e) => `'${e}'`).join(",");
const NOMBRE_DOCTOR_SQL = "CONCAT_WS(' ', emp.Nombre, emp.A_P, emp.A_M)";
const NOMBRE_PACIENTE_SQL = "CONCAT_WS(' ', p.Nombre, p.A_P, p.A_M)";

/**
 * Barrido periódico: cancela por falta de pago (req. 7) y marca "No acudió".
 * Las funciones puras deciden qué citas; aquí solo se leen y se actualizan.
 */
const barrer = async (pool, ahora) => {
    const [filas] = await pool.query(
        "SELECT Folio_Cita, Doctor_id_Doctor, Paciente_id_Paciente, Fecha, Horario, Duracion, Estatus, Fecha_Registro " +
        "FROM Cita WHERE Estatus IN ('Agendada pendiente','Pagada pendiente por atender')");
    const citas = filas.map(C.filaACita);
    const vencidas = citasConPagoVencido(citas, ahora).map((c) => Number(c.id));
    const noAcudio = citasNoAcudidas(citas, ahora).map((c) => Number(c.id));
    if (vencidas.length > 0)
        await pool.query("UPDATE Cita SET Estatus = 'Cancelada Falta de pago' WHERE Folio_Cita IN (?) AND Estatus = 'Agendada pendiente'", [vencidas]);
    if (noAcudio.length > 0)
        await pool.query("UPDATE Cita SET Estatus = 'No acudió' WHERE Folio_Cita IN (?) AND Estatus = 'Pagada pendiente por atender'", [noAcudio]);
    return { vencidas: vencidas.length, noAcudio: noAcudio.length };
};

/**
 * Crea la aplicación Express. Recibe el pool de MySQL y el reloj para poder probarla
 * con una base de pruebas y una hora fija.
 */
const crearApp = (pool, reloj = ahoraLocal) => {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, "public")));

    // ---------- Utilidades con efectos ----------
    const enTransaccion = async (fn) => {
        const con = await pool.getConnection();
        try {
            await con.beginTransaction();
            const r = await fn(con);
            await con.commit();
            return r;
        } catch (e) {
            try { await con.rollback(); } catch (_) { /* ya no hay transacción */ }
            throw e;
        } finally {
            con.release();
        }
    };

    const ruta = (fn) => async (req, res) => {
        const r = await fn(req);
        res.status(r.estado).json(r.cuerpo);
    };

    // ---------- Sesiones (en memoria) y autorización por perfil ----------
    const sesiones = new Map();
    const requiere = (...perfiles) => (req, res, next) => {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const s = sesiones.get(token);
        if (!s) return res.status(401).json({ success: false, error: "Inicia sesión para continuar." });
        if (perfiles.length > 0 && !perfiles.includes(s.perfil))
            return res.status(403).json({ success: false, error: "No tienes permiso para esta operación." });
        req.sesion = s;
        req.token = token;
        next();
    };
    const exigePropio = (req, id) => {
        if (req.sesion.perfil === "paciente" && String(req.sesion.id) !== String(id))
            falla(403, "Solo puedes consultar y modificar tus propios datos.");
    };

    // ========================================================================
    // Acceso
    // ========================================================================
    const CONSULTAS_LOGIN = {
        paciente:
            "SELECT p.id_Paciente AS id, p.Nombre FROM Paciente p JOIN Usuario u ON u.id_Usuario = p.Usuario_id_Usuario " +
            "WHERE p.Nombre = ? AND u.Contrasenia = SHA2(?, 256) AND p.Estatus_Activo = 1",
        doctor:
            "SELECT d.id_Doctor AS id, emp.Nombre FROM Doctor d JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado " +
            "JOIN Usuario u ON u.Empleado_id_Empleado = emp.id_Empleado " +
            "WHERE emp.Nombre = ? AND u.Contrasenia = SHA2(?, 256) AND emp.Estatus_Activo = 1",
        recepcionista:
            "SELECT r.id_Recepcionista AS id, emp.Nombre FROM Recepcionista r JOIN Empleado emp ON emp.id_Empleado = r.Empleado_id_Empleado " +
            "JOIN Usuario u ON u.Empleado_id_Empleado = emp.id_Empleado " +
            "WHERE emp.Nombre = ? AND u.Contrasenia = SHA2(?, 256) AND emp.Estatus_Activo = 1",
        administrador:
            "SELECT a.id_Administrador AS id, emp.Nombre FROM Administrador a JOIN Empleado emp ON emp.id_Empleado = a.Empleado_id_Empleado " +
            "JOIN Usuario u ON u.Empleado_id_Empleado = emp.id_Empleado " +
            "WHERE emp.Nombre = ? AND u.Contrasenia = SHA2(?, 256) AND emp.Estatus_Activo = 1",
    };

    app.post("/api/login", ruta(async (req) => {
        const { perfil, usuario, password } = req.body ?? {};
        const sql = Object.hasOwn(CONSULTAS_LOGIN, perfil) ? CONSULTAS_LOGIN[perfil] : null;
        if (sql === null) return responde(400, { success: false, message: "Perfil inválido." });
        if (typeof usuario !== "string" || typeof password !== "string" || usuario === "" || password === "")
            return responde(400, { success: false, message: "Escribe tu usuario y contraseña." });
        const [filas] = await pool.execute(sql, [usuario, password]);
        if (filas.length === 0)
            return responde(401, { success: false, message: "Usuario o contraseña incorrectos." });
        const token = crypto.randomBytes(24).toString("hex");
        sesiones.set(token, { perfil, id: filas[0].id, nombre: filas[0].Nombre });
        return responde(200, { success: true, token, user: { id: filas[0].id, Nombre: filas[0].Nombre, perfil } });
    }));

    app.post("/api/logout", requiere(), (req, res) => {
        sesiones.delete(req.token);
        res.json({ success: true });
    });

    // ========================================================================
    // Pacientes: alta, baja, datos (req. 6: solo ellos se dan de alta solos)
    // ========================================================================
    app.post("/api/pacientes/registro", ruta(async (req) => {
        const v = C.validarRegistroPaciente(req.body);
        if (!v.ok) return responde(400, { success: false, error: v.error });
        const d = v.valor;
        const id = await enTransaccion(async (con) => {
            const [u] = await con.execute("INSERT INTO Usuario (Contrasenia, Empleado_id_Empleado) VALUES (SHA2(?, 256), NULL)", [d.contrasenia]);
            const [p] = await con.execute(
                "INSERT INTO Paciente (Nombre, A_P, A_M, Calle, Colonia, Numero, Ciudad, Usuario_id_Usuario) VALUES (?,?,?,?,?,?,?,?)",
                [d.nombre, d.ap_paterno, d.ap_materno, d.calle, d.colonia, d.numero, d.ciudad, u.insertId]);
            return p.insertId;
        });
        return responde(201, { success: true, id });
    }));

    app.post("/api/pacientes/:id/baja", requiere("paciente"), ruta(async (req) => {
        const id = C.idValido(req.params.id);
        if (id === null) return responde(400, { success: false, error: "Paciente inválido." });
        exigePropio(req, id);
        const contrasenia = req.body?.contrasenia;
        if (typeof contrasenia !== "string" || contrasenia === "")
            return responde(400, { success: false, error: "Escribe tu contraseña para confirmar la baja." });
        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                "SELECT p.id_Paciente FROM Paciente p JOIN Usuario u ON u.id_Usuario = p.Usuario_id_Usuario " +
                "WHERE p.id_Paciente = ? AND p.Estatus_Activo = 1 AND u.Contrasenia = SHA2(?, 256) FOR UPDATE OF p", [id, contrasenia]);
            if (filas.length === 0) return responde(400, { success: false, error: "Datos incorrectos: la contraseña no coincide." });
            const [pend] = await con.execute(
                `SELECT COUNT(*) AS n FROM Cita WHERE Paciente_id_Paciente = ? AND Estatus IN ('Agendada pendiente','Pagada pendiente por atender')`, [id]);
            if (pend[0].n > 0)
                return responde(409, { success: false, error: "Tienes citas vigentes. Cancélalas antes de darte de baja." });
            await con.execute("UPDATE Paciente SET Estatus_Activo = 0 WHERE id_Paciente = ?", [id]);
            for (const [t, s] of sesiones) if (s.perfil === "paciente" && String(s.id) === String(id)) sesiones.delete(t);
            return responde(200, { success: true, message: "Tu cuenta fue dada de baja." });
        });
    }));

    app.get("/api/pacientes/:id/datos", requiere("paciente", "recepcionista", "administrador"), ruta(async (req) => {
        const id = C.idValido(req.params.id);
        if (id === null) return responde(400, { success: false, error: "Paciente inválido." });
        exigePropio(req, id);
        const [filas] = await pool.execute("SELECT * FROM vw_ExpedientePaciente WHERE id_Paciente = ?", [id]);
        return filas.length === 0 ? responde(404, { success: false, error: "Paciente no encontrado." }) : responde(200, filas[0]);
    }));

    // ========================================================================
    // Agendar una cita (req. 1, 3, 5, 8, 11) -> usa agendar() de agenda_funcional.js
    // ========================================================================
    const agendarCita = ruta(async (req) => {
        const { Paciente_id_Paciente, Doctor_id_Doctor, Fecha, Horario } = req.body ?? {};
        const doctor = C.idValido(Doctor_id_Doctor);
        const paciente = C.idValido(Paciente_id_Paciente);
        const inicio = C.horaAMinutos(Horario);
        if (doctor === null || paciente === null)
            return responde(400, { success: false, error: "Indica un doctor y un paciente válidos." });
        if (!esFechaValida(Fecha))
            return responde(400, { success: false, error: "La fecha debe tener formato AAAA-MM-DD y existir." });
        if (inicio === null)
            return responde(400, { success: false, error: "La hora debe tener formato HH:MM." });
        exigePropio(req, paciente);

        return enTransaccion(async (con) => {
            // Bloquear al doctor y al paciente (siempre en este orden): dos peticiones simultáneas no
            // pueden agendar el mismo horario.
            const [docs] = await con.execute(
                "SELECT emp.Hora_Inicio, emp.Hora_Fin, e.Costo_Consulta FROM Doctor d " +
                "JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado " +
                "JOIN Especialidad e ON e.id_Especialidad = d.Especialidad_id_Especialidad " +
                "WHERE d.id_Doctor = ? AND emp.Estatus_Activo = 1 FOR UPDATE OF d", [doctor]);
            if (docs.length === 0) return responde(404, { success: false, error: "Doctor no encontrado." });
            const [pacs] = await con.execute(
                "SELECT id_Paciente FROM Paciente WHERE id_Paciente = ? AND Estatus_Activo = 1 FOR UPDATE", [paciente]);
            if (pacs.length === 0) return responde(404, { success: false, error: "Paciente no encontrado." });

            // Citas activas de ese día del doctor Y del paciente
            const [filas] = await con.execute(
                "SELECT Folio_Cita, Doctor_id_Doctor, Paciente_id_Paciente, Fecha, Horario, Duracion, Estatus, Fecha_Registro " +
                `FROM Cita WHERE Fecha = ? AND Estatus IN (${ACTIVAS_SQL}) AND (Doctor_id_Doctor = ? OR Paciente_id_Paciente = ?)`,
                [Fecha, doctor, paciente]);
            const agenda = filas.map(C.filaACita);

            const jornada = { inicio: C.horaAMinutos(String(docs[0].Hora_Inicio)), fin: C.horaAMinutos(String(docs[0].Hora_Fin)) };
            const ahora = reloj();
            const nueva = { id: "nueva", medico: String(doctor), paciente: String(paciente), fecha: Fecha, inicio, duracion: DURACION_CITA };
            const r = agendar(agenda, nueva, jornada, ahora);
            if (!r.exito) return responde(400, { success: false, error: r.error });

            const [c] = await con.execute(
                "INSERT INTO Cita (Fecha, Horario, Duracion, Fecha_Registro, Estatus, Paciente_id_Paciente, Doctor_id_Doctor) " +
                "VALUES (?,?,?,?, 'Agendada pendiente', ?, ?)",
                [Fecha, C.minutosAHora(inicio), DURACION_CITA, C.ahoraADatetime(ahora), paciente, doctor]);
            await con.execute("INSERT INTO Pago (Cita_Folio_Cita, Monto) VALUES (?, ?)", [c.insertId, docs[0].Costo_Consulta]);
            return responde(201, {
                success: true, mensaje: "Cita agendada exitosamente. Tienes 8 horas para pagarla.",
                Folio_Cita: c.insertId, citaID: c.insertId, Monto: docs[0].Costo_Consulta,
            });
        });
    });
    app.post("/api/citas/agendar-sp", requiere("paciente", "recepcionista"), agendarCita);
    app.post("/api/citas", requiere("paciente", "recepcionista"), agendarCita);

    // ========================================================================
    // Mis citas, pagar, cancelar
    // ========================================================================
    app.get("/api/pacientes/:id/citas-sp", requiere("paciente", "recepcionista", "administrador"), ruta(async (req) => {
        const id = C.idValido(req.params.id);
        if (id === null) return responde(400, { success: false, error: "Paciente inválido." });
        exigePropio(req, id);
        const [filas] = await pool.execute(
            `SELECT c.Folio_Cita, c.Fecha, c.Horario, ${NOMBRE_DOCTOR_SQL} AS Medico, e.Nombre_Esp AS Especialidad,
                    pg.Monto, c.Estatus, c.Fecha_Registro
             FROM Cita c
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             JOIN Especialidad e ON e.id_Especialidad = d.Especialidad_id_Especialidad
             LEFT JOIN Pago pg ON pg.Cita_Folio_Cita = c.Folio_Cita
             WHERE c.Paciente_id_Paciente = ? ORDER BY c.Fecha DESC, c.Horario DESC`, [id]);
        return responde(200, filas.map((f) => ({ ...f, Fecha: C.fechaIso(f.Fecha) })));
    }));

    app.post("/api/pacientes/pagar-cita", requiere("paciente"), ruta(async (req) => {
        const folio = C.idValido(req.body?.Folio_Cita);
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                "SELECT Folio_Cita, Doctor_id_Doctor, Paciente_id_Paciente, Fecha, Horario, Duracion, Estatus, Fecha_Registro " +
                "FROM Cita WHERE Folio_Cita = ? FOR UPDATE", [folio]);
            if (filas.length === 0) return responde(404, { success: false, error: "No se encontró el folio especificado." });
            exigePropio(req, filas[0].Paciente_id_Paciente);
            if (filas[0].Estatus !== "Agendada pendiente")
                return responde(400, { success: false, error: `La cita no está pendiente de pago (estatus: ${filas[0].Estatus}).` });

            const ahora = reloj();
            if (!pagoVigente(C.filaACita(filas[0]), ahora)) {
                await con.execute("UPDATE Cita SET Estatus = 'Cancelada Falta de pago' WHERE Folio_Cita = ?", [folio]);
                return responde(400, { success: false, error: "El plazo de 8 horas para pagar venció; la cita fue cancelada." });
            }
            await con.execute("UPDATE Cita SET Estatus = 'Pagada pendiente por atender' WHERE Folio_Cita = ?", [folio]);
            await con.execute("UPDATE Pago SET Pagado = 1, Fecha_Pago = ? WHERE Cita_Folio_Cita = ?", [C.ahoraADatetime(ahora), folio]);
            return responde(200, { success: true, message: "¡Pago procesado exitosamente!" });
        });
    }));

    // Cancelar (req. 2 y 9): el paciente (la suya) o la recepcionista. El doctor NO puede (req. 4).
    const cancelar = ruta(async (req) => {
        const folio = C.idValido(req.params.id);
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                "SELECT c.Folio_Cita, c.Doctor_id_Doctor, c.Paciente_id_Paciente, c.Fecha, c.Horario, c.Duracion, c.Estatus, c.Fecha_Registro, " +
                "COALESCE(pg.Pagado, 0) AS Pagado, COALESCE(pg.Monto, 0) AS Monto " +
                "FROM Cita c LEFT JOIN Pago pg ON pg.Cita_Folio_Cita = c.Folio_Cita WHERE c.Folio_Cita = ? FOR UPDATE OF c", [folio]);
            if (filas.length === 0) return responde(404, { success: false, error: "No se encontró el folio especificado." });
            const f = filas[0];
            exigePropio(req, f.Paciente_id_Paciente);
            if (!C.ESTADOS_CANCELABLES.includes(f.Estatus))
                return responde(400, { success: false, error: `La cita tiene estatus "${f.Estatus}" y ya no se puede cancelar.` });

            const cita = C.filaACita(f);
            const r = cancelarCita([cita], cita.id, reloj(), f.Pagado ? { monto: Number(f.Monto) } : undefined);
            if (!r.exito) return responde(400, { success: false, error: r.error });

            const nuevoEstatus = req.sesion.perfil === "paciente" ? "Cancelada Paciente" : "Cancelada Recepción";
            await con.execute("UPDATE Pago SET Monto_Devolucion = ? WHERE Cita_Folio_Cita = ?", [r.reembolso, folio]);
            await con.execute("UPDATE Cita SET Estatus = ? WHERE Folio_Cita = ?", [nuevoEstatus, folio]);
            return responde(200, {
                success: true,
                datosReembolso: { porcentaje: r.reembolso > 0 ? PORCENTAJE_REEMBOLSO : 0, montoDevuelto: r.reembolso },
            });
        });
    });
    app.delete("/api/citas/:id", requiere("paciente", "recepcionista"), cancelar);
    app.delete("/api/recepcion/citas/:id", requiere("paciente", "recepcionista"), cancelar);

    // ========================================================================
    // Médico: agenda, bitácora, receta, solicitud de cancelación (req. 4)
    // ========================================================================
    app.get("/api/medicos/agenda-sp", requiere("doctor", "recepcionista", "administrador"), ruta(async (req) => {
        const donde = req.sesion.perfil === "doctor"
            ? { sql: "c.Doctor_id_Doctor = ?", p: [req.sesion.id] }
            : { sql: `${NOMBRE_DOCTOR_SQL} LIKE ?`, p: [`%${C.escaparLike(req.query.nombre)}%`] };
        const [filas] = await pool.execute(
            `SELECT c.Folio_Cita, c.Fecha, c.Horario, ${NOMBRE_PACIENTE_SQL} AS Nombre_Paciente, c.Estatus
             FROM Cita c JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             WHERE ${donde.sql} AND c.Estatus IN (${ACTIVAS_SQL}) ORDER BY c.Fecha, c.Horario`, donde.p);
        return responde(200, filas.map((f) => ({ ...f, Fecha: C.fechaIso(f.Fecha) })));
    }));

    app.get("/api/medicos/historial-bitacora", requiere("doctor", "recepcionista", "administrador"), ruta(async (req) => {
        const busqueda = String(req.query.busqueda ?? "").trim();
        const condiciones = [`(${NOMBRE_PACIENTE_SQL} LIKE ? OR p.id_Paciente = ?)`];
        const params = [`%${C.escaparLike(busqueda)}%`, C.idValido(busqueda) ?? 0];
        if (req.sesion.perfil === "doctor") { condiciones.push("c.Doctor_id_Doctor = ?"); params.push(req.sesion.id); }
        const [filas] = await pool.execute(
            `SELECT b.id_Bitacora_Estatus AS id_bitacora, b.Fecha_mov AS Fecha_Movimiento, c.Folio_Cita, c.Fecha AS Fecha_Cita,
                    ${NOMBRE_PACIENTE_SQL} AS Nombre_Paciente, ${NOMBRE_DOCTOR_SQL} AS Nombre_Doctor,
                    e.Nombre_Esp AS Especialidad, b.Costo, b.Estatus_cita AS Estatus_Cita,
                    COALESCE(r.Diagnostico, 'Ninguno') AS Diagnostico
             FROM Bitacora_Estatus_Cita b
             JOIN Cita c ON c.Folio_Cita = b.Folio_cita
             JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             JOIN Especialidad e ON e.id_Especialidad = b.id_Especialidad
             LEFT JOIN Receta r ON r.Cita_Folio_Cita = c.Folio_Cita
             WHERE ${condiciones.join(" AND ")} ORDER BY b.id_Bitacora_Estatus DESC LIMIT 200`, params);
        return responde(200, filas.map((f) => ({ ...f, Fecha_Cita: C.fechaIso(f.Fecha_Cita), Fecha_Movimiento: String(f.Fecha_Movimiento).replace(" ", "T") })));
    }));

    app.post("/api/recetas/generar-sp", requiere("doctor"), ruta(async (req) => {
        const { Folio_Cita, Diagnostico, Tratamiento, Observacion, medicamentos } = req.body ?? {};
        const folio = C.idValido(Folio_Cita);
        const diagnostico = C.texto(Diagnostico, 200);
        const tratamiento = C.texto(Tratamiento, 200);
        const observacion = Observacion === undefined || Observacion === null || Observacion === "" ? null : C.texto(Observacion, 200);
        const meds = Array.isArray(medicamentos) ? medicamentos.map((m) => C.texto(m, 200)) : [];
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        if (diagnostico === null || tratamiento === null)
            return responde(400, { success: false, error: "El diagnóstico y el tratamiento son obligatorios (máx. 200 caracteres)." });
        if (Observacion && observacion === null) return responde(400, { success: false, error: "Observación demasiado larga (máx. 200)." });
        if (meds.length > 20 || meds.includes(null)) return responde(400, { success: false, error: "Medicamentos inválidos (máx. 20, 200 caracteres cada uno)." });

        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                "SELECT c.Fecha, c.Estatus, c.Doctor_id_Doctor, pg.id_Pago, pg.Monto FROM Cita c " +
                "JOIN Pago pg ON pg.Cita_Folio_Cita = c.Folio_Cita WHERE c.Folio_Cita = ? FOR UPDATE OF c", [folio]);
            if (filas.length === 0) return responde(404, { success: false, error: "No se encontró el folio especificado." });
            const f = filas[0];
            if (f.Doctor_id_Doctor !== req.sesion.id)
                return responde(403, { success: false, error: "Esta cita no pertenece a tu agenda." });
            if (f.Estatus !== "Pagada pendiente por atender")
                return responde(400, { success: false, error: `Solo se atienden citas pagadas (estatus actual: ${f.Estatus}).` });
            const ahora = reloj();
            const fechaCita = String(f.Fecha).slice(0, 10);
            if (fechaCita !== ahora.fecha)
                return responde(400, { success: false, error: `Esta cita está programada para el día ${fechaCita}. Solo puedes atenderla hoy (${ahora.fecha}).` });

            const [r] = await con.execute(
                "INSERT INTO Receta (Diagnostico, Tratamiento, Observacion, Cita_Folio_Cita) VALUES (?,?,?,?)",
                [diagnostico, tratamiento, observacion, folio]);
            for (const m of meds)
                await con.execute("INSERT INTO Receta_Medicamento (Receta_Folio_Recetas, Descripcion) VALUES (?,?)", [r.insertId, m]);
            await con.execute("UPDATE Cita SET Estatus = 'Atendida' WHERE Folio_Cita = ?", [folio]);
            await con.execute("INSERT INTO Ticket (Pago_id_Pago, Fecha, Hora, Subtotal) VALUES (?,?,?,?)",
                [f.id_Pago, ahora.fecha, C.minutosAHora(ahora.minutos), f.Monto]);
            return responde(201, { success: true, numReceta: r.insertId });
        });
    }));

    app.post("/api/medicos/solicitar-cancelacion", requiere("doctor"), ruta(async (req) => {
        const folio = C.idValido(req.body?.Folio_Cita);
        const motivo = C.texto(req.body?.motivo, 200);
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        if (motivo === null) return responde(400, { success: false, error: "Escribe el motivo de la cancelación." });
        return enTransaccion(async (con) => {
            const [filas] = await con.execute("SELECT Doctor_id_Doctor, Estatus FROM Cita WHERE Folio_Cita = ? FOR UPDATE", [folio]);
            if (filas.length === 0) return responde(404, { success: false, error: "No se encontró el folio especificado." });
            if (filas[0].Doctor_id_Doctor !== req.sesion.id) return responde(403, { success: false, error: "Esta cita no pertenece a tu agenda." });
            if (!C.ESTADOS_CANCELABLES.includes(filas[0].Estatus))
                return responde(400, { success: false, error: `La cita tiene estatus "${filas[0].Estatus}" y no se puede cancelar.` });
            const [dup] = await con.execute("SELECT 1 FROM Solicitud_Cancelacion WHERE Cita_Folio_Cita = ? AND Estatus = 'Pendiente'", [folio]);
            if (dup.length > 0) return responde(409, { success: false, error: "Ya existe una solicitud pendiente para esta cita." });
            await con.execute(
                "INSERT INTO Solicitud_Cancelacion (Cita_Folio_Cita, Doctor_id_Doctor, Motivo, Fecha_Solicitud) VALUES (?,?,?,?)",
                [folio, req.sesion.id, motivo, C.ahoraADatetime(reloj())]);
            return responde(201, { success: true, message: "Solicitud enviada. La cita se cancela solo si el administrador la autoriza." });
        });
    }));

    app.get("/api/pacientes/receta/:id", requiere("paciente", "doctor", "recepcionista", "administrador"), ruta(async (req) => {
        const folio = C.idValido(req.params.id);
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        const [filas] = await pool.execute(
            `SELECT r.Folio_Recetas AS Num_Receta, c.Fecha, c.Paciente_id_Paciente, ${NOMBRE_PACIENTE_SQL} AS Paciente,
                    ${NOMBRE_DOCTOR_SQL} AS Medico, d.Cedula_Profesional, r.Diagnostico, r.Tratamiento,
                    COALESCE((SELECT GROUP_CONCAT(rm.Descripcion ORDER BY rm.id_Receta_Medicamento SEPARATOR ' | ')
                              FROM Receta_Medicamento rm WHERE rm.Receta_Folio_Recetas = r.Folio_Recetas), 'No especificados') AS Medicamentos,
                    r.Observacion AS Observaciones
             FROM Receta r JOIN Cita c ON c.Folio_Cita = r.Cita_Folio_Cita
             JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             WHERE c.Folio_Cita = ?`, [folio]);
        if (filas.length === 0) return responde(404, { success: false, error: "Esa cita no tiene receta." });
        exigePropio(req, filas[0].Paciente_id_Paciente);
        return responde(200, { success: true, receta: { ...filas[0], Fecha: C.fechaIso(filas[0].Fecha) } });
    }));

    // ========================================================================
    // Recepción
    // ========================================================================
    app.get("/api/recepcion/citas", requiere("recepcionista", "administrador"), ruta(async () => {
        const [filas] = await pool.query("SELECT * FROM vw_AgendaCitas ORDER BY Fecha DESC, Horario DESC");
        return responde(200, filas.map((f) => ({ ...f, Fecha: C.fechaIso(f.Fecha) })));
    }));

    app.get("/api/recepcion/medicos", requiere(), ruta(async () => {
        const [filas] = await pool.query("SELECT * FROM vw_CatalogoDoctores ORDER BY id_Doctor");
        return responde(200, filas);
    }));

    app.get("/api/recepcion/ticket/:id", requiere("recepcionista", "administrador"), ruta(async (req) => {
        const folio = C.idValido(req.params.id);
        if (folio === null) return responde(400, { success: false, error: "Folio de cita inválido." });
        const [filas] = await pool.execute(
            `SELECT c.Folio_Cita, t.Fecha, ${NOMBRE_PACIENTE_SQL} AS Paciente, ${NOMBRE_DOCTOR_SQL} AS Medico,
                    pg.Monto AS Costo_Consulta, t.Subtotal AS Gran_Total,
                    COALESCE((SELECT GROUP_CONCAT(rm.Descripcion ORDER BY rm.id_Receta_Medicamento SEPARATOR ' | ')
                              FROM Receta r JOIN Receta_Medicamento rm ON rm.Receta_Folio_Recetas = r.Folio_Recetas
                              WHERE r.Cita_Folio_Cita = c.Folio_Cita), 'Ninguno') AS Medicamentos_Texto
             FROM Ticket t JOIN Pago pg ON pg.id_Pago = t.Pago_id_Pago
             JOIN Cita c ON c.Folio_Cita = pg.Cita_Folio_Cita
             JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             WHERE c.Folio_Cita = ?`, [folio]);
        if (filas.length === 0)
            return responde(404, { success: false, error: "Esa cita no tiene ticket (se genera cuando el médico la atiende)." });
        return responde(200, { success: true, ticket: { ...filas[0], Fecha: C.fechaIso(filas[0].Fecha) } });
    }));

    app.get("/api/recepcion/historial-recetas", requiere("recepcionista", "administrador"), ruta(async (req) => {
        const filtro = `%${C.escaparLike(String(req.query.filtro ?? "").trim())}%`;
        const [filas] = await pool.execute(
            `SELECT r.Folio_Recetas AS Num_Receta, c.Fecha, ${NOMBRE_PACIENTE_SQL} AS Nombre_Paciente,
                    ${NOMBRE_DOCTOR_SQL} AS Nombre_Medico, d.Cedula_Profesional, r.Diagnostico,
                    COALESCE((SELECT GROUP_CONCAT(rm.Descripcion ORDER BY rm.id_Receta_Medicamento SEPARATOR ' | ')
                              FROM Receta_Medicamento rm WHERE rm.Receta_Folio_Recetas = r.Folio_Recetas), 'Ninguno prescrito') AS Medicamentos,
                    r.Tratamiento, r.Observacion AS Observaciones
             FROM Receta r JOIN Cita c ON c.Folio_Cita = r.Cita_Folio_Cita
             JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = c.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             WHERE ${NOMBRE_DOCTOR_SQL} LIKE ? OR d.Cedula_Profesional LIKE ? ORDER BY r.Folio_Recetas DESC`, [filtro, filtro]);
        return responde(200, filas.map((f) => ({ ...f, Fecha: C.fechaIso(f.Fecha) })));
    }));

    // ========================================================================
    // Administrador: altas/bajas de personal y autorización de cancelaciones
    // ========================================================================
    app.get("/api/admin/personal", requiere("administrador"), ruta(async () => {
        const [filas] = await pool.query(
            `SELECT 'Doctor' AS tipo, d.id_Doctor AS id, CONCAT_WS(' ', emp.Nombre, emp.A_P, emp.A_M) AS Nombre,
                    d.Cedula_Profesional AS Cedula, e.Nombre_Esp AS Especialidad,
                    CONCAT(TIME_FORMAT(emp.Hora_Inicio,'%H:%i'),' - ',TIME_FORMAT(emp.Hora_Fin,'%H:%i')) AS Horario
             FROM Doctor d JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             JOIN Especialidad e ON e.id_Especialidad = d.Especialidad_id_Especialidad WHERE emp.Estatus_Activo = 1
             UNION ALL
             SELECT 'Recepcionista', r.id_Recepcionista, CONCAT_WS(' ', emp.Nombre, emp.A_P, emp.A_M), NULL, NULL,
                    CONCAT(TIME_FORMAT(emp.Hora_Inicio,'%H:%i'),' - ',TIME_FORMAT(emp.Hora_Fin,'%H:%i'))
             FROM Recepcionista r JOIN Empleado emp ON emp.id_Empleado = r.Empleado_id_Empleado WHERE emp.Estatus_Activo = 1`);
        return responde(200, filas);
    }));

    app.post("/api/admin/personal/registro", requiere("administrador"), ruta(async (req) => {
        const v = C.validarAltaPersonal(req.body);
        if (!v.ok) return responde(400, { success: false, error: v.error });
        const d = v.valor;
        return enTransaccion(async (con) => {
            let consultorioId = null;
            if (d.tipo === "Doctor") {
                const [esp] = await con.execute("SELECT 1 FROM Especialidad WHERE id_Especialidad = ?", [d.especialidad]);
                if (esp.length === 0) return responde(400, { success: false, error: "La especialidad indicada no existe." });
                const [cons] = await con.execute("SELECT id_Consultorio FROM Consultorio WHERE Numero_Consultorio = ?", [d.consultorio]);
                if (cons.length === 0) return responde(400, { success: false, error: "El consultorio indicado no existe." });
                consultorioId = cons[0].id_Consultorio;
            }
            const [emp] = await con.execute(
                "INSERT INTO Empleado (Nombre, A_P, A_M, Tipo, Sueldo, Hora_Inicio, Hora_Fin) VALUES (?,?,?,?,?,?,?)",
                [d.nombre, d.ap_paterno, d.ap_materno, d.tipo, d.sueldo, d.hora_inicio, d.hora_fin]);
            await con.execute("INSERT INTO Usuario (Contrasenia, Empleado_id_Empleado) VALUES (SHA2(?, 256), ?)", [d.contrasenia, emp.insertId]);
            if (d.tipo === "Doctor")
                await con.execute(
                    "INSERT INTO Doctor (Cedula_Profesional, Empleado_id_Empleado, Especialidad_id_Especialidad, Consultorio_id_Consultorio) VALUES (?,?,?,?)",
                    [d.cedula, emp.insertId, d.especialidad, consultorioId]);
            else
                await con.execute("INSERT INTO Recepcionista (Empleado_id_Empleado) VALUES (?)", [emp.insertId]);
            return responde(201, { success: true, message: `${d.tipo} dado de alta.` });
        });
    }));

    app.delete("/api/admin/personal/:tipo/:id", requiere("administrador"), ruta(async (req) => {
        const id = C.idValido(req.params.id);
        const tipo = req.params.tipo;
        if (id === null || (tipo !== "doctor" && tipo !== "recepcionista"))
            return responde(400, { success: false, error: "Tipo o identificador inválido." });
        const [tabla, pk] = tipo === "doctor" ? ["Doctor", "id_Doctor"] : ["Recepcionista", "id_Recepcionista"];
        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                `SELECT t.Empleado_id_Empleado AS emp FROM ${tabla} t JOIN Empleado e ON e.id_Empleado = t.Empleado_id_Empleado
                 WHERE t.${pk} = ? AND e.Estatus_Activo = 1 FOR UPDATE`, [id]);
            if (filas.length === 0) return responde(404, { success: false, error: "Personal no encontrado o ya dado de baja." });
            if (tipo === "doctor") {
                const [pend] = await con.execute(
                    `SELECT COUNT(*) AS n FROM Cita WHERE Doctor_id_Doctor = ? AND Estatus IN ('Agendada pendiente','Pagada pendiente por atender')`, [id]);
                if (pend[0].n > 0)
                    return responde(409, { success: false, error: `El doctor tiene ${pend[0].n} cita(s) vigente(s). Resuélvelas antes de darlo de baja.` });
            }
            await con.execute("UPDATE Empleado SET Estatus_Activo = 0 WHERE id_Empleado = ?", [filas[0].emp]);
            for (const [t, s] of sesiones) if (s.perfil === tipo && s.id === id) sesiones.delete(t);
            return responde(200, { success: true, message: "Baja lógica ejecutada exitosamente." });
        });
    }));

    app.get("/api/admin/solicitudes", requiere("administrador"), ruta(async () => {
        const [filas] = await pool.query(
            `SELECT s.id_Solicitud, s.Cita_Folio_Cita AS Folio_Cita, s.Motivo, s.Fecha_Solicitud,
                    ${NOMBRE_DOCTOR_SQL} AS Nombre_Doctor, ${NOMBRE_PACIENTE_SQL} AS Nombre_Paciente, c.Fecha, c.Horario, c.Estatus
             FROM Solicitud_Cancelacion s JOIN Cita c ON c.Folio_Cita = s.Cita_Folio_Cita
             JOIN Paciente p ON p.id_Paciente = c.Paciente_id_Paciente
             JOIN Doctor d ON d.id_Doctor = s.Doctor_id_Doctor
             JOIN Empleado emp ON emp.id_Empleado = d.Empleado_id_Empleado
             WHERE s.Estatus = 'Pendiente' ORDER BY s.id_Solicitud`);
        return responde(200, filas.map((f) => ({ ...f, Fecha: C.fechaIso(f.Fecha) })));
    }));

    const resolverSolicitud = (autorizar) => ruta(async (req) => {
        const id = C.idValido(req.params.id);
        if (id === null) return responde(400, { success: false, error: "Solicitud inválida." });
        return enTransaccion(async (con) => {
            const [filas] = await con.execute(
                "SELECT Cita_Folio_Cita, Estatus FROM Solicitud_Cancelacion WHERE id_Solicitud = ? FOR UPDATE", [id]);
            if (filas.length === 0) return responde(404, { success: false, error: "Solicitud no encontrada." });
            if (filas[0].Estatus !== "Pendiente") return responde(409, { success: false, error: "Esa solicitud ya fue resuelta." });
            const folio = filas[0].Cita_Folio_Cita;
            if (!autorizar) {
                await con.execute("UPDATE Solicitud_Cancelacion SET Estatus = 'Rechazada' WHERE id_Solicitud = ?", [id]);
                return responde(200, { success: true, message: "Solicitud rechazada; la cita sigue vigente." });
            }
            const [cita] = await con.execute(
                "SELECT c.Estatus, COALESCE(pg.Pagado,0) AS Pagado, COALESCE(pg.Monto,0) AS Monto FROM Cita c " +
                "LEFT JOIN Pago pg ON pg.Cita_Folio_Cita = c.Folio_Cita WHERE c.Folio_Cita = ? FOR UPDATE OF c", [folio]);
            if (!C.ESTADOS_CANCELABLES.includes(cita[0].Estatus)) {
                await con.execute("UPDATE Solicitud_Cancelacion SET Estatus = 'Rechazada' WHERE id_Solicitud = ?", [id]);
                return responde(400, { success: false, error: `La cita ya está "${cita[0].Estatus}"; la solicitud se marcó como rechazada.` });
            }
            // La cancelación la origina el hospital, no el paciente: se devuelve lo pagado completo.
            const devolucion = cita[0].Pagado ? Number(cita[0].Monto) : 0;
            await con.execute("UPDATE Pago SET Monto_Devolucion = ? WHERE Cita_Folio_Cita = ?", [devolucion, folio]);
            await con.execute("UPDATE Cita SET Estatus = 'Cancelada por Médico' WHERE Folio_Cita = ?", [folio]);
            await con.execute("UPDATE Solicitud_Cancelacion SET Estatus = 'Autorizada' WHERE id_Solicitud = ?", [id]);
            return responde(200, { success: true, message: "Cancelación autorizada.", montoDevuelto: devolucion });
        });
    });
    app.post("/api/admin/solicitudes/:id/autorizar", requiere("administrador"), resolverSolicitud(true));
    app.post("/api/admin/solicitudes/:id/rechazar", requiere("administrador"), resolverSolicitud(false));

    // ========================================================================
    // Errores: lo que no se previó
    // ========================================================================
    app.use("/api", (req, res) => res.status(404).json({ success: false, error: "Ruta no encontrada." }));
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (err instanceof ErrorHttp) return res.status(err.estado).json({ success: false, error: err.message });
        if (err && err.code === "ER_DUP_ENTRY") {
            const msg = /Cedula/i.test(err.message) ? "Esa cédula profesional ya está registrada."
                : "Ese horario acaba de ser ocupado. Elige otro.";
            return res.status(409).json({ success: false, error: msg });
        }
        if (err && err.status === 400) return res.status(400).json({ success: false, error: "Petición mal formada." });
        console.error(err);
        return res.status(500).json({ success: false, error: "Error interno del servidor." });
    });

    return app;
};

module.exports = { crearApp, ahoraLocal, barrer };

if (require.main === module) {
    const pool = require("./db.js");
    const puerto = Number(process.env.PORT || 3000);
    const tarea = () => barrer(pool, ahoraLocal()).catch((e) => console.error("Barrido:", e.message));
    tarea();
    setInterval(tarea, 60 * 1000);
    crearApp(pool).listen(puerto, () => console.log(`Servidor corriendo en http://localhost:${puerto}`));
}
