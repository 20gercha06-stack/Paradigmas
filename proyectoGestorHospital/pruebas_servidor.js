"use strict";
/**
 * Pruebas de integración: servidor Express + MySQL REAL, con una hora fija (reloj inyectado).
 *
 * Crean la base `gestor_citas_test` desde bases/baseTablas.sql y bases/scriptEjem.sql, así que
 * NO tocan tu base `gestor_citas`. Necesitan un MySQL accesible con las variables de .env
 * (DB_HOST, DB_USER, DB_PASSWORD, DB_PORT); el usuario debe poder crear bases de datos.
 * El resultado esperado de cada prueba está escrito aquí antes de ejecutarla.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { crearApp, barrer } = require("./server.js");

const DB_PRUEBAS = "gestor_citas_test";
const conexion = {
    host: process.env.DB_HOST || "127.0.0.1",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT || 3306),
};

// ---------- Hora fija, controlada por las pruebas ----------
let ahora = { fecha: "2026-11-02", minutos: 600 };               // 2 nov 2026, 10:00
const poner = (fecha, hhmm) => { const [h, m] = hhmm.split(":").map(Number); ahora = { fecha, minutos: h * 60 + m }; };
const reloj = () => ({ ...ahora });

(async () => {
    // ---------- Preparar la base de pruebas ----------
    let admin;
    try {
        admin = await mysql.createConnection({ ...conexion, multipleStatements: true });
    } catch (e) {
        console.log(`PRUEBAS DE SERVIDOR OMITIDAS: no hay conexión a MySQL (${e.code || e.message}).`);
        console.log("Revisa DB_HOST, DB_USER y DB_PASSWORD en tu .env y que MySQL esté encendido.");
        process.exit(0);
    }
    const sql = (f) => fs.readFileSync(path.join(__dirname, "bases", f), "utf8").replaceAll("gestor_citas", DB_PRUEBAS);
    await admin.query(`DROP DATABASE IF EXISTS ${DB_PRUEBAS}`);
    await admin.query(sql("baseTablas.sql"));
    await admin.query(sql("scriptEjem.sql"));
    await admin.end();

    const pool = mysql.createPool({
        ...conexion, database: DB_PRUEBAS, dateStrings: true, decimalNumbers: true, connectionLimit: 10,
    });
    const servidor = crearApp(pool, reloj).listen(0);
    const base = `http://127.0.0.1:${servidor.address().port}`;

    const llamar = async (metodo, ruta, cuerpo, token) => {
        const r = await fetch(base + ruta, {
            method: metodo,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        });
        let json = null;
        try { json = await r.json(); } catch (_) { /* sin cuerpo */ }
        return { estado: r.status, cuerpo: json ?? {} };
    };
    const q = async (consulta, params = []) => (await pool.query(consulta, params))[0];
    const entrar = async (perfil, usuario, password = "Pass123!") =>
        (await llamar("POST", "/api/login", { perfil, usuario, password })).cuerpo.token;

    /** "estado" o "estado fragmento"; si el mensaje no contiene el fragmento muestra el mensaje real. */
    const R = (r, frag) => {
        const msg = String(r.cuerpo.error ?? r.cuerpo.message ?? "");
        return frag === undefined ? String(r.estado) : `${r.estado} ${msg.includes(frag) ? frag : `«${msg}»`}`;
    };
    const cita = (paciente, doctor, fecha, hora) =>
        ({ Paciente_id_Paciente: paciente, Doctor_id_Doctor: doctor, Fecha: fecha, Horario: hora });

    // ---------- Sesiones de ejemplo ----------
    const tO = await entrar("paciente", "Oscar");     // paciente 1
    const tT = await entrar("paciente", "Teresa");    // paciente 2
    const tJ = await entrar("doctor", "Juan");        // doctor 1 (07:00-14:00, 800)
    const tC = await entrar("doctor", "Carlos");      // doctor 3 (07:00-21:00, 700)
    const tD = await entrar("recepcionista", "Diana");
    const tA = await entrar("administrador", "Admin");
    let tAna = null;   // se obtiene tras el alta de Ana (S08)

    const F = {};   // folios que se van creando

    // [id, escenario, entrada, ESPERADO (escrito antes de ejecutar), función async]
    const casos = [
        // ---------- Acceso ----------
        ["S01", "Login correcto de paciente", "Oscar / Pass123!", "200",
            async () => R(await llamar("POST", "/api/login", { perfil: "paciente", usuario: "Oscar", password: "Pass123!" }))],
        ["S02", "Login con contraseña incorrecta", "Oscar / mala", "401",
            async () => R(await llamar("POST", "/api/login", { perfil: "paciente", usuario: "Oscar", password: "mala" }))],
        ["S03", "Login con perfil inventado", "perfil 'dios'", "400",
            async () => R(await llamar("POST", "/api/login", { perfil: "dios", usuario: "Oscar", password: "Pass123!" }))],
        ["S04", "Intento de inyección SQL en el login", "usuario \"' OR '1'='1\"", "401",
            async () => R(await llamar("POST", "/api/login", { perfil: "paciente", usuario: "' OR '1'='1", password: "x" }))],
        ["S05", "Un doctor no entra por el perfil de paciente", "Juan como paciente", "401",
            async () => R(await llamar("POST", "/api/login", { perfil: "paciente", usuario: "Juan", password: "Pass123!" }))],
        ["S06", "Pedir datos sin iniciar sesión", "GET citas sin token", "401",
            async () => R(await llamar("GET", "/api/pacientes/1/citas-sp"))],
        ["S07", "Un paciente no ve los datos de otro", "Oscar pide el expediente del paciente 2", "403",
            async () => R(await llamar("GET", "/api/pacientes/2/datos", undefined, tO))],

        // ---------- Alta de pacientes (req. 6, caso de uso 2) ----------
        ["S08", "Paciente se da de alta (happy path)", "Ana Soto Ruiz, datos completos", "201",
            async () => R(await llamar("POST", "/api/pacientes/registro",
                { nombre: "Ana", apellidos: "Soto Ruiz", ciudad: "CDMX", calle: "Reforma", colonia: "Centro", numero: "30-A", contrasenia: "secreto1" }))],
        ["S09", "Alta con nombre inválido (unhappy path)", "Nombre 'An4'", "400 Nombre inválido",
            async () => R(await llamar("POST", "/api/pacientes/registro",
                { nombre: "An4", apellidos: "Soto", ciudad: "CDMX", calle: "R", colonia: "C", numero: "1", contrasenia: "secreto1" }), "Nombre inválido")],
        ["S10", "Alta con contraseña corta (unhappy path)", "Contraseña de 3 caracteres", "400 Contraseña inválida",
            async () => R(await llamar("POST", "/api/pacientes/registro",
                { nombre: "Luis", apellidos: "Soto", ciudad: "CDMX", calle: "R", colonia: "C", numero: "1", contrasenia: "abc" }), "Contraseña inválida")],
        ["S11", "Alta con cuerpo vacío (unhappy path)", "{}", "400",
            async () => R(await llamar("POST", "/api/pacientes/registro", {}))],
        ["S12", "La paciente nueva ya puede iniciar sesión", "Ana / secreto1", "200",
            async () => { const r = await llamar("POST", "/api/login", { perfil: "paciente", usuario: "Ana", password: "secreto1" }); tAna = r.cuerpo.token; return R(r); }],

        // ---------- Agendar (req. 1, 3, 5, 8, 11) ----------
        ["S13", "Agendar en horario libre (happy path)", "Oscar, doctor 1, 2026-11-10 09:00", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-10", "09:00"), tO); F.A = r.cuerpo.Folio_Cita; return R(r); }],
        ["S14", "Mismo doctor, mismo horario, otro paciente (req. 1)", "Teresa, doctor 1, 09:00", "400 Traslape",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(2, 1, "2026-11-10", "09:00"), tT), "Traslape")],
        ["S15", "Traslape parcial con el mismo doctor", "Teresa, doctor 1, 09:15", "400 Traslape",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(2, 1, "2026-11-10", "09:15"), tT), "Traslape")],
        ["S16", "Mismo paciente, otro doctor, mismo horario (req. 5)", "Oscar, doctor 3, 09:00", "400 El paciente ya tiene cita",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-10", "09:00"), tO), "El paciente ya tiene cita")],
        ["S17", "Paciente con varias citas en horarios distintos (req. 5)", "Teresa, doctor 3, 09:00 y 10:00", "201,201",
            async () => {
                const a = await llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-10", "09:00"), tT);
                const b = await llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-10", "10:00"), tT);
                F.B = a.cuerpo.Folio_Cita; F.C = b.cuerpo.Folio_Cita;
                return `${R(a)},${R(b)}`;
            }],
        ["S18", "Cita contigua (límite: fin = inicio)", "Oscar, doctor 1, 09:30", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-10", "09:30"), tO); F.D = r.cuerpo.Folio_Cita; return R(r); }],
        ["S19", "Cita que termina justo al cierre de su jornada (límite)", "Oscar, doctor 1 (07-14), 13:30", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-10", "13:30"), tO); F.E = r.cuerpo.Folio_Cita; return R(r); }],
        ["S20", "Cita que termina después de su jornada (req. 3)", "Oscar, doctor 1 (07-14), 14:00", "400 Fuera de jornada",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-11", "14:00"), tO), "Fuera de jornada")],
        ["S21", "Cita antes de iniciar su jornada (req. 3)", "Oscar, doctor 1 (07-14), 06:30", "400 Fuera de jornada",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-11", "06:30"), tO), "Fuera de jornada")],
        ["S22", "Con menos de 48 horas de anticipación (req. 8)", "2026-11-03 09:00 (23 h)", "400 Fuera de ventana",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-03", "09:00"), tO), "Fuera de ventana")],
        ["S23", "Justo 48 horas de anticipación (límite)", "2026-11-04 10:00", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-04", "10:00"), tO); F.F = r.cuerpo.Folio_Cita; return R(r); }],
        ["S24", "47 h 59 min de anticipación (límite)", "2026-11-04 09:59", "400 Fuera de ventana",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-04", "09:59"), tO), "Fuera de ventana")],
        ["S25", "Justo 3 meses de anticipación (límite)", "2027-02-02 10:00", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2027-02-02", "10:00"), tO); F.G = r.cuerpo.Folio_Cita; return R(r); }],
        ["S26", "Más de 3 meses de anticipación (req. 8)", "2027-02-02 10:01", "400 Fuera de ventana",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2027-02-02", "10:01"), tO), "Fuera de ventana")],
        ["S27", "Fecha pasada (req. 11)", "2026-10-30 09:00", "400 Fecha pasada",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-10-30", "09:00"), tO), "Fecha pasada")],
        ["S28", "Fecha inexistente", "2026-02-30", "400",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-02-30", "09:00"), tO))],
        ["S29", "Hora inválida", "25:00", "400",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-12", "25:00"), tO))],
        ["S30", "Doctor inexistente", "doctor 999", "404",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 999, "2026-11-12", "09:00"), tO))],
        ["S31", "Un paciente no agenda a nombre de otro", "Oscar agenda para el paciente 2", "403",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-12", "09:00"), tO))],
        ["S32", "El doctor no puede agendar citas", "Juan intenta agendar", "403",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-12", "09:00"), tJ))],
        ["S33", "La recepcionista agenda por un paciente", "Diana: Teresa, doctor 1, 11-11 08:00", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(2, 1, "2026-11-11", "08:00"), tD); F.H = r.cuerpo.Folio_Cita; return R(r); }],

        // ---------- Pago (req. 7, caso de uso 8) ----------
        ["S34", "Pagar a tiempo (happy path)", "Oscar paga la cita A", "200",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.A }, tO))],
        ["S35", "Pagar dos veces la misma cita (unhappy path)", "Oscar paga la cita A otra vez", "400 no está pendiente de pago",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.A }, tO), "no está pendiente de pago")],
        ["S36", "Pagar la cita de otro paciente", "Teresa paga la cita D de Oscar", "403",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.D }, tT))],
        ["S37", "Pagar con folio inválido (unhappy path)", "Folio 'abc'", "400",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: "abc" }, tO))],
        ["S38", "Pagar con folio inexistente", "Folio 99999", "404",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: 99999 }, tO))],
        ["S39", "Pagar justo a las 8 horas (límite, req. 7)", "Cita E creada 10:00; se paga a las 18:00", "200",
            async () => { poner("2026-11-02", "18:00"); const r = await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.E }, tO); poner("2026-11-02", "10:00"); return R(r); }],
        ["S40", "Pagar a las 8 h y 1 min: la cita se cancela (req. 7)", "Cita F creada 10:00; se paga a las 18:01", "400 plazo de 8 horas",
            async () => { poner("2026-11-02", "18:01"); const r = await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.F }, tO); poner("2026-11-02", "10:00"); return R(r, "plazo de 8 horas"); }],
        ["S41", "La cita vencida quedó cancelada por falta de pago", "Estatus de F en la base", "Cancelada Falta de pago",
            async () => (await q("SELECT Estatus FROM Cita WHERE Folio_Cita = ?", [F.F]))[0].Estatus],
        ["S42", "El horario de una cita vencida queda libre", "Teresa toma el 2026-11-04 10:00 con doctor 3", "201",
            async () => R(await llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-04", "10:00"), tT))],

        // ---------- Cancelar (req. 2, 9, casos de uso 4 y 6) ----------
        ["S43", "Paciente cancela una cita pagada con tiempo: reembolso 50 % (req. 9)", "Oscar cancela A ($800 pagados)", "200 · 50 % · $400",
            async () => { const r = await llamar("DELETE", `/api/citas/${F.A}`, undefined, tO); const d = r.cuerpo.datosReembolso ?? {}; return `${r.estado} · ${d.porcentaje} % · $${d.montoDevuelto}`; }],
        ["S44", "El reembolso queda guardado y la cita cancelada", "Pago y estatus de A en la base", "400.00 · Cancelada Paciente",
            async () => { const p = (await q("SELECT pg.Monto_Devolucion AS m, c.Estatus AS e FROM Pago pg JOIN Cita c ON c.Folio_Cita = pg.Cita_Folio_Cita WHERE c.Folio_Cita = ?", [F.A]))[0]; return `${Number(p.m).toFixed(2)} · ${p.e}`; }],
        ["S45", "Cancelar una cita sin pagar: sin reembolso", "Oscar cancela D (sin pagar)", "200 · 0 % · $0",
            async () => { const r = await llamar("DELETE", `/api/citas/${F.D}`, undefined, tO); const d = r.cuerpo.datosReembolso ?? {}; return `${r.estado} · ${d.porcentaje} % · $${d.montoDevuelto}`; }],
        ["S46", "Paciente cancela una cita inexistente (unhappy path)", "Folio 99999", "404",
            async () => R(await llamar("DELETE", "/api/citas/99999", undefined, tO))],
        ["S47", "Recepcionista cancela una cita inexistente (unhappy path)", "Folio 99999", "404",
            async () => R(await llamar("DELETE", "/api/recepcion/citas/99999", undefined, tD))],
        ["S48", "Cancelar una cita ya cancelada", "Oscar cancela A otra vez", "400 ya no se puede cancelar",
            async () => R(await llamar("DELETE", `/api/citas/${F.A}`, undefined, tO), "ya no se puede cancelar")],
        ["S49", "Un paciente no cancela la cita de otro", "Teresa cancela E de Oscar", "403",
            async () => R(await llamar("DELETE", `/api/citas/${F.E}`, undefined, tT))],
        ["S50", "El doctor no puede cancelar una cita (req. 4)", "Juan cancela E", "403",
            async () => R(await llamar("DELETE", `/api/citas/${F.E}`, undefined, tJ))],
        ["S51", "Cancelar con 7 h 59 min de anticipación (req. 2)", "Cita E 13:30; cancela a las 05:31", "400 Cancelación rechazada",
            async () => { poner("2026-11-10", "05:31"); const r = await llamar("DELETE", `/api/citas/${F.E}`, undefined, tO); poner("2026-11-02", "10:00"); return R(r, "Cancelación rechazada"); }],
        ["S52", "Cancelar con exactamente 8 h de anticipación (límite, req. 2)", "Cita E 13:30; cancela a las 05:30", "200 · 50 % · $400",
            async () => { poner("2026-11-10", "05:30"); const r = await llamar("DELETE", `/api/citas/${F.E}`, undefined, tO); poner("2026-11-02", "10:00"); const d = r.cuerpo.datosReembolso ?? {}; return `${r.estado} · ${d.porcentaje} % · $${d.montoDevuelto}`; }],
        ["S53", "El horario de una cita cancelada queda libre", "Ana toma el 2026-11-10 09:00 con doctor 1 (el que liberó Oscar)", "201",
            async () => { const r = await llamar("POST", "/api/citas/agendar-sp", cita(3, 1, "2026-11-10", "09:00"), tAna); F.J = r.cuerpo.Folio_Cita; return R(r); }],
        ["S54", "La recepcionista cancela una cita (caso de uso 4)", "Diana cancela la cita H", "200",
            async () => R(await llamar("DELETE", `/api/recepcion/citas/${F.H}`, undefined, tD))],

        // ---------- Cancelación de un doctor con autorización (req. 4) ----------
        ["S55", "Ana paga la cita J", "pago de J", "200",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.J }, tAna))],
        ["S56", "El doctor solicita cancelar una cita suya", "Juan solicita cancelar J", "201",
            async () => R(await llamar("POST", "/api/medicos/solicitar-cancelacion", { Folio_Cita: F.J, motivo: "Emergencia" }, tJ))],
        ["S57", "Solicitud duplicada", "Juan solicita J otra vez", "409",
            async () => R(await llamar("POST", "/api/medicos/solicitar-cancelacion", { Folio_Cita: F.J, motivo: "Emergencia" }, tJ))],
        ["S58", "Un doctor no solicita cancelar la cita de otro doctor", "Juan solicita B (doctor 3)", "403",
            async () => R(await llamar("POST", "/api/medicos/solicitar-cancelacion", { Folio_Cita: F.B, motivo: "x" }, tJ))],
        ["S59", "La cita sigue vigente mientras nadie autorice", "Estatus de J", "Pagada pendiente por atender",
            async () => (await q("SELECT Estatus FROM Cita WHERE Folio_Cita = ?", [F.J]))[0].Estatus],
        ["S60", "Solo el administrador autoriza", "Diana intenta autorizar", "403",
            async () => R(await llamar("POST", "/api/admin/solicitudes/1/autorizar", undefined, tD))],
        ["S61", "El administrador ve la solicitud", "GET solicitudes", "1",
            async () => String((await llamar("GET", "/api/admin/solicitudes", undefined, tA)).cuerpo.length)],
        ["S62", "El administrador autoriza: cita cancelada y reembolso completo", "Autoriza la solicitud 1", "200 · $800",
            async () => { const r = await llamar("POST", "/api/admin/solicitudes/1/autorizar", undefined, tA); return `${r.estado} · $${r.cuerpo.montoDevuelto}`; }],
        ["S63", "Quedó cancelada por el médico", "Estatus de J", "Cancelada por Médico",
            async () => (await q("SELECT Estatus FROM Cita WHERE Folio_Cita = ?", [F.J]))[0].Estatus],
        ["S64", "Solicitud ya resuelta no se resuelve dos veces", "Autoriza la solicitud 1 otra vez", "409",
            async () => R(await llamar("POST", "/api/admin/solicitudes/1/autorizar", undefined, tA))],

        // ---------- Atender, receta y ticket ----------
        ["S65", "Teresa paga la cita B (doctor 3)", "pago de B", "200",
            async () => R(await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.B }, tT))],
        ["S66", "No se atiende una cita antes de su día", "Carlos atiende B el 2026-11-02", "400 Solo puedes atenderla hoy",
            async () => R(await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.B, Diagnostico: "Gripe", Tratamiento: "Reposo", medicamentos: ["Paracetamol"] }, tC), "Solo puedes atenderla hoy")],
        ["S67", "No se atiende una cita sin pagar", "Carlos atiende C (sin pagar) el 2026-11-10", "400 Solo se atienden citas pagadas",
            async () => { poner("2026-11-10", "09:00"); const r = await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.C, Diagnostico: "Gripe", Tratamiento: "Reposo" }, tC); return R(r, "Solo se atienden citas pagadas"); }],
        ["S68", "Un doctor no atiende la cita de otro", "Juan atiende B", "403",
            async () => R(await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.B, Diagnostico: "Gripe", Tratamiento: "Reposo" }, tJ))],
        ["S69", "Receta sin diagnóstico", "Diagnóstico vacío", "400",
            async () => R(await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.B, Diagnostico: "  ", Tratamiento: "Reposo" }, tC))],
        ["S70", "El doctor atiende a su paciente el día de la cita (happy path)", "Carlos atiende B el 2026-11-10", "201",
            async () => R(await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.B, Diagnostico: "Gripe", Tratamiento: "Reposo", Observacion: "Beber agua", medicamentos: ["Paracetamol 500 mg c/8h", "Loratadina 10 mg c/24h"] }, tC))],
        ["S71", "No se atiende dos veces", "Carlos atiende B otra vez", "400",
            async () => R(await llamar("POST", "/api/recetas/generar-sp", { Folio_Cita: F.B, Diagnostico: "Gripe", Tratamiento: "Reposo" }, tC))],
        ["S72", "La paciente ve su receta con los medicamentos", "Teresa pide la receta de B", "200 · Paracetamol 500 mg c/8h | Loratadina 10 mg c/24h",
            async () => { const r = await llamar("GET", `/api/pacientes/receta/${F.B}`, undefined, tT); return `${r.estado} · ${r.cuerpo.receta?.Medicamentos}`; }],
        ["S73", "Otro paciente no ve esa receta", "Oscar pide la receta de B", "403",
            async () => R(await llamar("GET", `/api/pacientes/receta/${F.B}`, undefined, tO))],
        ["S74", "Recepción obtiene el ticket de una cita atendida", "Ticket de B ($700)", "200 · 700",
            async () => { const r = await llamar("GET", `/api/recepcion/ticket/${F.B}`, undefined, tD); return `${r.estado} · ${r.cuerpo.ticket?.Gran_Total}`; }],
        ["S75", "No hay ticket de una cita sin atender", "Ticket de C", "404",
            async () => R(await llamar("GET", `/api/recepcion/ticket/${F.C}`, undefined, tD))],
        ["S76", "No se cancela una cita ya atendida", "Teresa cancela B", "400 ya no se puede cancelar",
            async () => R(await llamar("DELETE", `/api/citas/${F.B}`, undefined, tT), "ya no se puede cancelar")],
        ["S77", "Historial de recetas por médico", "Recepción busca 'Carlos'", "1",
            async () => String((await llamar("GET", "/api/recepcion/historial-recetas?filtro=Carlos", undefined, tD)).cuerpo.filter((x) => x.Num_Receta > 2).length)],

        // ---------- Bitácora (triggers) ----------
        ["S78", "Los triggers registran cada cambio de estatus de A", "Movimientos de A en Bitacora_Estatus_Cita", "3",
            async () => String((await q("SELECT COUNT(*) AS n FROM Bitacora_Estatus_Cita WHERE Folio_cita = ?", [F.A]))[0].n)],
        ["S79", "El doctor consulta la bitácora de un paciente", "Juan busca 'Oscar'", "true",
            async () => { poner("2026-11-02", "10:00"); const r = await llamar("GET", "/api/medicos/historial-bitacora?busqueda=Oscar", undefined, tJ); return String(r.estado === 200 && r.cuerpo.length >= 3); }],

        // ---------- Administrador: altas y bajas (casos de uso 1 y 5) ----------
        ["S80", "La recepcionista no da de alta doctores", "Diana intenta el alta", "403",
            async () => R(await llamar("POST", "/api/admin/personal/registro", {}, tD))],
        ["S81", "Un paciente no da de alta doctores (req. 6)", "Oscar intenta el alta", "403",
            async () => R(await llamar("POST", "/api/admin/personal/registro", {}, tO))],
        ["S82", "El administrador da de alta un doctor (happy path)", "Nuevo Pérez Gil, cédula CED9999, 08:00-12:00", "201",
            async () => R(await llamar("POST", "/api/admin/personal/registro",
                { tipo: "Doctor", nombre: "Nuevo", ap_paterno: "Pérez", ap_materno: "Gil", cedula: "CED9999", especialidad_id: 4, consultorio: 104, sueldo: 20000, hora_inicio: "08:00", hora_fin: "12:00", contrasenia: "doctor123" }, tA))],
        ["S83", "Alta con cédula repetida", "CED9999 otra vez", "409",
            async () => R(await llamar("POST", "/api/admin/personal/registro",
                { tipo: "Doctor", nombre: "Otro", ap_paterno: "Pérez", ap_materno: "Gil", cedula: "CED9999", especialidad_id: 4, consultorio: 104, sueldo: 20000, hora_inicio: "08:00", hora_fin: "12:00", contrasenia: "doctor123" }, tA))],
        ["S84", "Alta con horario invertido (unhappy path)", "15:00-08:00", "400 Horario inválido",
            async () => R(await llamar("POST", "/api/admin/personal/registro",
                { tipo: "Doctor", nombre: "Otro", ap_paterno: "Pérez", ap_materno: "Gil", cedula: "CED8888", especialidad_id: 4, consultorio: 104, sueldo: 20000, hora_inicio: "15:00", hora_fin: "08:00", contrasenia: "doctor123" }, tA), "Horario inválido")],
        ["S85", "Alta con consultorio inexistente (unhappy path)", "Consultorio 999", "400 consultorio indicado no existe",
            async () => R(await llamar("POST", "/api/admin/personal/registro",
                { tipo: "Doctor", nombre: "Otro", ap_paterno: "Pérez", ap_materno: "Gil", cedula: "CED8888", especialidad_id: 4, consultorio: 999, sueldo: 20000, hora_inicio: "08:00", hora_fin: "12:00", contrasenia: "doctor123" }, tA), "consultorio indicado no existe")],
        ["S86", "El doctor nuevo inicia sesión y aparece en el catálogo", "Login de Nuevo + catálogo", "200 · true",
            async () => { const r = await llamar("POST", "/api/login", { perfil: "doctor", usuario: "Nuevo", password: "doctor123" }); const cat = await llamar("GET", "/api/recepcion/medicos", undefined, tO); return `${r.estado} · ${cat.cuerpo.some((d) => d.Nombre_Doctor.startsWith("Nuevo"))}`; }],
        ["S87", "La jornada del doctor nuevo se respeta (08:00-12:00)", "Oscar, doctor nuevo, 12:00", "400 Fuera de jornada",
            async () => { const id = (await q("SELECT MAX(id_Doctor) AS id FROM Doctor"))[0].id; F.nuevoDoc = id; return R(await llamar("POST", "/api/citas/agendar-sp", cita(1, id, "2026-11-12", "12:00"), tO), "Fuera de jornada"); }],
        ["S88", "No se da de baja a un doctor con citas vigentes", "Oscar agenda con doctor 1 y se intenta su baja", "409",
            async () => {
                poner("2026-11-02", "10:00");
                await llamar("POST", "/api/citas/agendar-sp", cita(1, 1, "2026-11-12", "09:00"), tO);
                return R(await llamar("DELETE", "/api/admin/personal/doctor/1", undefined, tA));
            }],
        ["S89", "Baja de un doctor sin citas (happy path)", "Baja del doctor nuevo", "200",
            async () => R(await llamar("DELETE", `/api/admin/personal/doctor/${F.nuevoDoc}`, undefined, tA))],
        ["S90", "El doctor dado de baja ya no inicia sesión", "Login de Nuevo", "401",
            async () => R(await llamar("POST", "/api/login", { perfil: "doctor", usuario: "Nuevo", password: "doctor123" }))],
        ["S91", "Dar de baja dos veces", "Baja del doctor nuevo otra vez", "404",
            async () => R(await llamar("DELETE", `/api/admin/personal/doctor/${F.nuevoDoc}`, undefined, tA))],
        ["S92", "Alta y baja de recepcionista", "Alta de 'Rita' y su baja", "201,200",
            async () => {
                const a = await llamar("POST", "/api/admin/personal/registro", { tipo: "Recepcionista", nombre: "Rita", ap_paterno: "Soto", ap_materno: "Mena", sueldo: 8000, hora_inicio: "07:00", hora_fin: "14:00", contrasenia: "recep123" }, tA);
                const id = (await q("SELECT MAX(id_Recepcionista) AS id FROM Recepcionista"))[0].id;
                const b = await llamar("DELETE", `/api/admin/personal/recepcionista/${id}`, undefined, tA);
                return `${R(a)},${R(b)}`;
            }],

        // ---------- Baja de paciente (caso de uso 7) ----------
        ["S93", "Baja con contraseña incorrecta (unhappy path)", "Ana con 'mala'", "400 Datos incorrectos",
            async () => { const t = await entrar("paciente", "Ana", "secreto1"); return R(await llamar("POST", "/api/pacientes/3/baja", { contrasenia: "mala" }, t), "Datos incorrectos"); }],
        ["S94", "No se da de baja con citas vigentes", "Oscar (tiene la cita G de 2027)", "409",
            async () => R(await llamar("POST", "/api/pacientes/1/baja", { contrasenia: "Pass123!" }, tO))],
        ["S95", "Baja correcta de un paciente sin citas (happy path)", "Ana con su contraseña", "200",
            async () => { const t = await entrar("paciente", "Ana", "secreto1"); return R(await llamar("POST", "/api/pacientes/3/baja", { contrasenia: "secreto1" }, t)); }],
        ["S96", "El paciente dado de baja ya no inicia sesión", "Login de Ana", "401",
            async () => R(await llamar("POST", "/api/login", { perfil: "paciente", usuario: "Ana", password: "secreto1" }))],

        // ---------- Barrido periódico ----------
        ["S97", "El barrido cancela por falta de pago a las 8 h", "Cita K sin pagar; barrido 8 h 1 min después", "Cancelada Falta de pago",
            async () => {
                poner("2026-11-02", "10:00");
                const r = await llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-20", "09:00"), tO); F.K = r.cuerpo.Folio_Cita;
                poner("2026-11-02", "18:01"); await barrer(pool, reloj());
                return (await q("SELECT Estatus FROM Cita WHERE Folio_Cita = ?", [F.K]))[0].Estatus;
            }],
        ["S98", "El barrido marca 'No acudió' a una cita pagada y vencida", "Cita L pagada del 11-12; barrido el 11-13", "No acudió",
            async () => {
                poner("2026-11-02", "10:00");
                const r = await llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-12", "08:00"), tT); F.L = r.cuerpo.Folio_Cita;
                await llamar("POST", "/api/pacientes/pagar-cita", { Folio_Cita: F.L }, tT);
                poner("2026-11-13", "08:00"); await barrer(pool, reloj());
                return (await q("SELECT Estatus FROM Cita WHERE Folio_Cita = ?", [F.L]))[0].Estatus;
            }],
        ["S99", "El barrido es idempotente", "Segunda ejecución seguida", `{"vencidas":0,"noAcudio":0}`,
            async () => JSON.stringify(await barrer(pool, reloj()))],

        // ---------- Concurrencia ----------
        ["S100", "Dos peticiones simultáneas por el mismo horario: gana una sola", "Oscar y Teresa piden doctor 3, 2026-11-25 09:00 a la vez", "1 creada, 1 rechazada, 1 cita activa",
            async () => {
                poner("2026-11-13", "08:00");
                const [a, b] = await Promise.all([
                    llamar("POST", "/api/citas/agendar-sp", cita(1, 3, "2026-11-25", "09:00"), tO),
                    llamar("POST", "/api/citas/agendar-sp", cita(2, 3, "2026-11-25", "09:00"), tT)]);
                const creadas = [a, b].filter((r) => r.estado === 201).length;
                const rechazadas = [a, b].filter((r) => r.estado === 400 || r.estado === 409).length;
                const activas = (await q("SELECT COUNT(*) AS n FROM Cita WHERE Doctor_id_Doctor = 3 AND Fecha = '2026-11-25' AND Horario = '09:00:00' AND Activa = 1"))[0].n;
                return `${creadas} creada, ${rechazadas} rechazada, ${activas} cita activa`;
            }],
    ];

    console.log("--- PRUEBAS DE SERVIDOR (MySQL real) ---");
    const filas = [];
    for (const [id, escenario, entrada, esperado, fn] of casos) {
        let obtenido;
        try { obtenido = await fn(); } catch (e) { obtenido = `EXCEPCIÓN ${e.message}`; }
        const estado = obtenido === esperado ? "Aprobada" : "Fallida";
        console.log(`${id} | ${estado} | ${escenario} | esp=${esperado} | obt=${obtenido}`);
        filas.push({ id, escenario, entrada, esperado, obtenido, estado });
    }
    const aprobadas = filas.filter((f) => f.estado === "Aprobada").length;
    console.log(`\nTotal: ${filas.length}   Aprobadas: ${aprobadas}   Fallidas: ${filas.length - aprobadas}`);
    fs.writeFileSync(path.join(__dirname, "resultados_servidor.json"), JSON.stringify(filas, null, 1));

    servidor.close();
    await pool.end();
    process.exit(aprobadas === filas.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
