const { finDeCita, agendar, huecosLibres } = require('./agenda_funcional.js');

const JORNADA = { inicio: 480, fin: 1080 }; // 08:00 a 18:00 en minutos
const agendaVacia = [];
const agendaBase = [
    { id: "C1", medico: "DocA", inicio: 540, duracion: 30 } // 09:00 - 09:30
];

let aprobadas = 0;
let total = 0;

const probar = (id, descripcion, esperado, obtenido) => {
    total++;
    const strEsperado = JSON.stringify(esperado);
    const strObtenido = JSON.stringify(obtenido);
    const estado = strEsperado === strObtenido ? "Aprobada" : "Fallida";
    if (estado === "Aprobada") aprobadas++;
    
    console.log(`${id} | ${estado} | ${descripcion} | esp=${strEsperado} | obt=${strObtenido}`);
};

console.log("--- EJECUCIÓN DE PRUEBAS ---");

// P01: Calcular el final de una cita
probar("P01", "Calcular el final de una cita", 570, finDeCita({ inicio: 540, duracion: 30 }));

// P02: Duración negativa
const resP02 = agendar(agendaVacia, { id: "C2", medico: "DocA", inicio: 540, duracion: -15 }, JORNADA);
probar("P02", "Duración negativa", "Duración inválida: debe ser mayor que cero", resP02.error);

// P04: Inicio antes de la jornada
const resP04 = agendar(agendaVacia, { id: "C3", medico: "DocA", inicio: 400, duracion: 30 }, JORNADA);
probar("P04", "Inicio antes de la jornada", "Fuera de jornada (480-1080)", resP04.error);

// P08: Traslape parcial
const resP08 = agendar(agendaBase, { id: "C4", medico: "DocA", inicio: 530, duracion: 30 }, JORNADA);
probar("P08", "Traslape parcial, mismo médico", "Traslape con la(s) cita(s): C1", resP08.error);

// P12: Huecos libres agenda vacía
probar("P12", "Huecos con agenda vacía", [[480, 1080]], huecosLibres(agendaVacia, "DocA", 30, JORNADA));

// P15: Inmutabilidad (La agenda original no se modifica)
agendar(agendaBase, { id: "C5", medico: "DocA", inicio: 600, duracion: 30 }, JORNADA);
probar("P15", "La agenda original no se modifica", 1, agendaBase.length);

console.log(`\nTotal: ${total}   Aprobadas: ${aprobadas}`);
