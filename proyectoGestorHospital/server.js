"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { agendar, esFechaValida } = require("./agenda_funcional.js");

const JORNADA = { inicio: 480, fin: 1080 }; // 08:00 a 18:00 en minutos
const DURACION_CITA = 30;                    // citas de 30 min

// ---------- Efectos: la hora actual vive aquí, no en las funciones puras ----------
const pad = (n) => String(n).padStart(2, "0");
const ahoraLocal = (d = new Date()) => ({
    fecha: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    minutos: d.getHours() * 60 + d.getMinutes(),
});

// ---------- Conversiones (puras) ----------
const horaAMinutos = (hora) => {
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(typeof hora === "string" ? hora : "");
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    return h > 23 || min > 59 ? null : h * 60 + min;
};

const idValido = (v) => {
    const n = Number(v);
    return v !== "" && v !== null && v !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};

/** Fila de la tabla Cita -> objeto que espera agendar(). */
const filaACita = (fila, fecha) => ({
    id: String(fila.ID),
    medico: String(fila.doctorID),
    paciente: String(fila.pacienteID),
    fecha,
    inicio: horaAMinutos(String(fila.hora)),
    duracion: DURACION_CITA,
});

/**
 * Crea la aplicación Express. Recibe el pool de MySQL y el reloj para poder
 * probarla con datos falsos y una hora fija.
 */
const crearApp = (pool, reloj = ahoraLocal) => {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, "public")));

    app.post("/api/citas", async (req, res) => {
        // 1. Validar la entrada: un dato malo es culpa del cliente (400), no del servidor (500)
        const { doctorID, pacienteID, fecha, hora } = req.body ?? {};
        const doctor = idValido(doctorID);
        const paciente = idValido(pacienteID);
        const inicio = horaAMinutos(hora);
        if (doctor === null || paciente === null)
            return res.status(400).json({ error: "Indica un doctor y un paciente válidos." });
        if (!esFechaValida(fecha))
            return res.status(400).json({ error: "La fecha debe tener formato AAAA-MM-DD y existir." });
        if (inicio === null)
            return res.status(400).json({ error: "La hora debe tener formato HH:MM." });

        const conexion = await pool.getConnection();
        try {
            await conexion.beginTransaction();

            // 2. Bloquear al doctor y al paciente (siempre en este orden) para que dos
            //    peticiones simultáneas no puedan agendar el mismo horario.
            const [doctores] = await conexion.execute("SELECT ID FROM Doctor WHERE ID = ? FOR UPDATE", [doctor]);
            if (doctores.length === 0) {
                await conexion.rollback();
                return res.status(404).json({ error: "Doctor no encontrado." });
            }
            const [pacientes] = await conexion.execute("SELECT ID FROM Paciente WHERE ID = ? FOR UPDATE", [paciente]);
            if (pacientes.length === 0) {
                await conexion.rollback();
                return res.status(404).json({ error: "Paciente no encontrado." });
            }

            // 3. Leer las citas activas del día del doctor Y del paciente (req. 1 y req. 5)
            const [filas] = await conexion.execute(
                "SELECT ID, doctorID, pacienteID, hora FROM Cita " +
                "WHERE fecha = ? AND estado = 1 AND (doctorID = ? OR pacienteID = ?)",
                [fecha, doctor, paciente]
            );
            const agenda = filas.map((f) => filaACita(f, fecha));

            // 4. Validar con las funciones puras
            const nueva = {
                id: "nueva", medico: String(doctor), paciente: String(paciente),
                fecha, inicio, duracion: DURACION_CITA,
            };
            const resultado = agendar(agenda, nueva, JORNADA, reloj());
            if (!resultado.exito) {
                await conexion.rollback();
                return res.status(400).json({ error: resultado.error });
            }

            // 5. Guardar
            const [insercion] = await conexion.execute(
                "INSERT INTO Cita (doctorID, pacienteID, fecha, hora, estado) VALUES (?, ?, ?, ?, 1)",
                [doctor, paciente, fecha, `${String(hora).slice(0, 5)}:00`]
            );
            await conexion.commit();
            return res.status(201).json({ mensaje: "Cita agendada exitosamente.", citaID: insercion.insertId });
        } catch (error) {
            try { await conexion.rollback(); } catch (_) { /* ya no hay transacción */ }
            if (error && error.code === "ER_DUP_ENTRY")
                return res.status(409).json({ error: "Ese horario acaba de ser ocupado. Elige otro." });
            console.error(error);
            return res.status(500).json({ error: "Error interno del servidor." });
        } finally {
            conexion.release();
        }
    });

    return app;
};

module.exports = { crearApp, ahoraLocal, horaAMinutos, idValido };

if (require.main === module) {
    const pool = require("./db.js");
    const puerto = Number(process.env.PORT || 3000);
    crearApp(pool).listen(puerto, () => console.log(`Servidor corriendo en http://localhost:${puerto}`));
}
