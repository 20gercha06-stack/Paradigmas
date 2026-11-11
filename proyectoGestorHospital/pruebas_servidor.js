"use strict";
// Pruebas del servidor con una base de datos falsa en memoria y una hora fija.
// No necesitan MySQL; sirven para comprobar validación de entrada, transacciones y respuestas.
const { crearApp } = require("./server.js");

const AHORA = { fecha: "2026-11-02", minutos: 600 };
const FECHA = "2026-11-07";

// ---------- Base falsa ----------
const crearBaseFalsa = () => {
    const estado = {
        doctores: [1, 2], pacientes: [1, 2], citas: [], siguiente: 1,
        forzarDuplicado: false, conexiones: 0, liberadas: 0, commits: 0, rollbacks: 0,
    };
    const ejecutar = async (sql, p) => {
        if (sql.includes("FROM Doctor")) return [estado.doctores.includes(p[0]) ? [{ ID: p[0] }] : []];
        if (sql.includes("FROM Paciente")) return [estado.pacientes.includes(p[0]) ? [{ ID: p[0] }] : []];
        if (sql.includes("FROM Cita")) {
            const [fecha, d, pa] = p;
            return [estado.citas.filter((c) => c.fecha === fecha && c.estado === 1 && (c.doctorID === d || c.pacienteID === pa))
                .map((c) => ({ ID: c.ID, doctorID: c.doctorID, pacienteID: c.pacienteID, hora: c.hora }))];
        }
        if (sql.includes("INSERT INTO Cita")) {
            if (estado.forzarDuplicado) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
            const [doctorID, pacienteID, fecha, hora] = p;
            const ID = estado.siguiente++;
            estado.citas.push({ ID, doctorID, pacienteID, fecha, hora, estado: 1 });
            return [{ insertId: ID }];
        }
        throw new Error("Consulta no prevista: " + sql);
    };
    const pool = {
        getConnection: async () => {
            estado.conexiones++;
            return {
                execute: ejecutar,
                beginTransaction: async () => {},
                commit: async () => { estado.commits++; },
                rollback: async () => { estado.rollbacks++; },
                release: () => { estado.liberadas++; },
            };
        },
    };
    return { pool, estado };
};

const { pool, estado } = crearBaseFalsa();
const servidor = crearApp(pool, () => AHORA).listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;

const post = async (cuerpo) => {
    const r = await fetch(`${base}/api/citas`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    return { status: r.status, json: await r.json() };
};

// [id, escenario, esperado, () => obtenido]  (el esperado se definió antes de ejecutar)
const casos = [
    ["S01", "Agendar en horario libre", [201, "Cita agendada exitosamente."],
        async () => { const r = await post({ doctorID: "1", pacienteID: "1", fecha: FECHA, hora: "09:00" }); return [r.status, r.json.mensaje]; }],
    ["S02", "Traslape del mismo doctor", [400, "Traslape con la(s) cita(s): 1"],
        async () => { const r = await post({ doctorID: "1", pacienteID: "2", fecha: FECHA, hora: "09:15" }); return [r.status, r.json.error]; }],
    ["S03", "Mismo paciente, otro doctor, misma hora (req. 5)", [400, "El paciente ya tiene cita en ese horario: 1"],
        async () => { const r = await post({ doctorID: "2", pacienteID: "1", fecha: FECHA, hora: "09:00" }); return [r.status, r.json.error]; }],
    ["S04", "Falta la hora (antes daba 500)", [400, "La hora debe tener formato HH:MM."],
        async () => { const r = await post({ doctorID: "1", pacienteID: "1", fecha: FECHA }); return [r.status, r.json.error]; }],
    ["S05", "Hora inválida 25:99", [400, "La hora debe tener formato HH:MM."],
        async () => { const r = await post({ doctorID: "1", pacienteID: "1", fecha: FECHA, hora: "25:99" }); return [r.status, r.json.error]; }],
    ["S06", "Fecha inexistente", [400, "La fecha debe tener formato AAAA-MM-DD y existir."],
        async () => { const r = await post({ doctorID: "1", pacienteID: "1", fecha: "2026-02-31", hora: "09:00" }); return [r.status, r.json.error]; }],
    ["S07", "Doctor inexistente", [404, "Doctor no encontrado."],
        async () => { const r = await post({ doctorID: "99", pacienteID: "1", fecha: FECHA, hora: "10:00" }); return [r.status, r.json.error]; }],
    ["S08", "Paciente inexistente", [404, "Paciente no encontrado."],
        async () => { const r = await post({ doctorID: "1", pacienteID: "99", fecha: FECHA, hora: "10:00" }); return [r.status, r.json.error]; }],
    ["S09", "Cuerpo vacío", [400, "Indica un doctor y un paciente válidos."],
        async () => { const r = await fetch(`${base}/api/citas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); return [r.status, (await r.json()).error]; }],
    ["S10", "Fecha pasada", [400, "Fecha pasada: no se puede agendar antes de la hora actual"],
        async () => { const r = await post({ doctorID: "1", pacienteID: "1", fecha: "2026-11-01", hora: "10:00" }); return [r.status, r.json.error]; }],
    ["S11", "Horario ocupado entre la lectura y el guardado (ER_DUP_ENTRY)", [409, "Ese horario acaba de ser ocupado. Elige otro."],
        async () => {
            estado.forzarDuplicado = true;
            const r = await post({ doctorID: "2", pacienteID: "2", fecha: FECHA, hora: "12:00" });
            estado.forzarDuplicado = false;
            return [r.status, r.json.error];
        }],
    ["S12", "Solo se guardó la cita válida", 1, async () => estado.citas.length],
    ["S13", "Toda conexión se libera y cada transacción termina", true,
        async () => estado.conexiones === estado.liberadas && estado.conexiones === estado.commits + estado.rollbacks],
];

(async () => {
    console.log("--- PRUEBAS DEL SERVIDOR (base falsa) ---");
    let aprobadas = 0;
    for (const [id, escenario, esperado, fn] of casos) {
        let obtenido;
        try { obtenido = await fn(); } catch (e) { obtenido = `EXCEPCIÓN ${e.message}`; }
        const esp = JSON.stringify(esperado), obt = JSON.stringify(obtenido);
        const ok = esp === obt;
        if (ok) aprobadas++;
        console.log(`${id} | ${ok ? "Aprobada" : "Fallida"} | ${escenario} | esp=${esp} | obt=${obt}`);
    }
    console.log(`\nTotal: ${casos.length}   Aprobadas: ${aprobadas}   Fallidas: ${casos.length - aprobadas}`);
    servidor.close();
    process.exitCode = aprobadas === casos.length ? 0 : 1;
})();
