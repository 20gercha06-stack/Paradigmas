// 1. Funciones Puras Básicas
const finDeCita = (cita) => cita.inicio + cita.duracion;

const seTraslapan = (a, b) => 
    (a.medico === b.medico) && 
    (a.inicio < finDeCita(b)) && 
    (b.inicio < finDeCita(a));

// 2. Validaciones (Composición y Funciones de Orden Superior)
const validarTipos = (cita) => 
    (typeof cita.inicio === 'number' && typeof cita.duracion === 'number') 
        ? { ok: true, valor: cita } 
        : { ok: false, error: "Datos inválidos: inicio y duración deben ser enteros" };

const validarDuracion = (cita) => 
    (cita.duracion > 0) 
        ? { ok: true, valor: cita } 
        : { ok: false, error: "Duración inválida: debe ser mayor que cero" };

// Retorna una función (currying) para evaluar la jornada actual
const validarJornada = (jornada) => (cita) => 
    (cita.inicio >= jornada.inicio && finDeCita(cita) <= jornada.fin)
        ? { ok: true, valor: cita }
        : { ok: false, error: `Fuera de jornada (${jornada.inicio}-${jornada.fin})` };

// Función de orden superior para encadenar validaciones (Pipeline con reduce)
const validarCita = (cita, jornada) => {
    const validadores = [validarTipos, validarDuracion, validarJornada(jornada)];
    return validadores.reduce((res, validador) => {
        return res.ok ? validador(res.valor) : res;
    }, { ok: true, valor: cita });
};

// 3. Funciones Principales (Inmutabilidad)
const agendar = (agenda, nueva, jornada) => {
    const validacion = validarCita(nueva, jornada);
    if (!validacion.ok) return { exito: false, error: validacion.error };

    const existeId = agenda.some(c => c.id === nueva.id);
    if (existeId) return { exito: false, error: `Identificador duplicado: ${nueva.id}` };

    const choques = agenda.filter(c => seTraslapan(nueva, c));
    if (choques.length > 0) {
        const idsChoque = choques.map(c => c.id).join(" | ");
        return { exito: false, error: `Traslape con la(s) cita(s): ${idsChoque}` };
    }

    // Retorna una NUEVA agenda (inmutabilidad) ordenada por inicio
    const nuevaAgenda = [...agenda, nueva].sort((a, b) => a.inicio - b.inicio);
    return { exito: true, agenda: nuevaAgenda };
};

const huecosLibres = (agenda, medico, duracionMin, jornada) => {
    const delMedico = agenda
        .filter(c => c.medico === medico)
        .sort((a, b) => a.inicio - b.inicio);

    const paso = (acum, c) => ({
        huecos: c.inicio > acum.cursor 
            ? [...acum.huecos, [acum.cursor, c.inicio]] 
            : acum.huecos,
        cursor: Math.max(acum.cursor, finDeCita(c))
    });

    const final = delMedico.reduce(paso, { huecos: [], cursor: jornada.inicio });

    const todos = final.cursor < jornada.fin 
        ? [...final.huecos, [final.cursor, jornada.fin]] 
        : final.huecos;

    return todos.filter(h => (h[1] - h[0]) >= duracionMin);
};

// Exportar los módulos para Node.js
module.exports = {
    finDeCita,
    seTraslapan,
    validarCita,
    agendar,
    huecosLibres
};
