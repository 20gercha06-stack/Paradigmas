# Gestor de citas del hospital (MediGest adaptado al proyecto de Paradigmas)

Sistema web con **cuatro portales** (paciente, doctor, recepcionista y administrador) sobre **MySQL**.
Las reglas de negocio están en `agenda_funcional.js` como **funciones puras** (paradigma funcional);
`server.js` es la única parte con entrada/salida.

## Puesta en marcha
1. `npm install`
2. Copia `.env.example` a `.env` y llena `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=gestor_citas`, `DB_PORT=3306` y `PORT=3000`. **No subas `.env` a GitHub.**
3. En MySQL ejecuta, en este orden: `bases/baseTablas.sql` y después `bases/scriptEjem.sql`.
   (Si ya tenías una versión anterior de `gestor_citas`, el primer script falla porque las tablas existen: borra la base con `DROP DATABASE gestor_citas;` y vuelve a empezar.)
4. `npm start` y abre http://localhost:3000

## Usuarios de ejemplo (contraseña de todos: `Pass123!`)
| Perfil | Usuario |
|---|---|
| Paciente | `Oscar`, `Teresa` (o registra uno nuevo en la pantalla de inicio) |
| Doctor | `Juan` (07-14 h, Cardiología), `Carlos` (07-21 h, Ginecología), `María`, `Ana`, `Luis`, `Laura`, `Jorge`, `Elena`, `Pedro`, `Sofía` |
| Recepcionista | `Diana`, `Roberto` |
| Administrador | `Admin` |

## Dónde vive cada requisito
| Req. | Regla | Dónde |
|---|---|---|
| 1 | Un doctor no atiende dos citas a la vez | `agendar` (`seTraslapan`) + `UNIQUE` en `Cita` |
| 2 | Cancelar con 8 h de anticipación | `puedeCancelar` / `cancelarCita` |
| 3 | Respetar el horario laboral del doctor | `validarJornada`; la jornada sale de `Empleado.Hora_Inicio/Hora_Fin` |
| 4 | El doctor no cancela sin autorización | el doctor solo *solicita* (`Solicitud_Cancelacion`); decide el administrador |
| 5 | Varias citas por paciente, nunca simultáneas | `pacienteTieneChoque` + `UNIQUE` en `Cita` |
| 6 | Solo el paciente se da de alta solo | `/api/pacientes/registro` es la única alta pública; doctores y recepcionistas los da de alta el administrador |
| 7 | 8 h para pagar | `pagoVigente`; el barrido (`barrer`) cancela por falta de pago |
| 8 | Agendar entre 48 h y 3 meses | `validarVentana` / `dentroDeVentana` |
| 9 | Reembolso del 50 % al cancelar | `calcularReembolso` |
| 10 | No se reagenda | no existe ninguna ruta para reagendar: se cancela y se agenda otra |
| 11 | No se agenda en el pasado | `validarNoPasada` |

Los límites (8 h, 48 h, 3 meses) son **inclusivos**: cancelar con exactamente 8 h o agendar con exactamente 48 h sí se permite.

## Flujo de una cita
Agendar → pagar (se genera el **Ticket**, como en el UML `Pago.procesar(): Ticket`) → el doctor la marca como **Atendida** el día de la cita.
Si se cancela ya pagada, el ticket muestra el reembolso del 50 %.

Para ver el núcleo funcional sin base de datos: `node agenda_funcional.js` (ejecuta `main()`, la única función con `console.log`).

## Pruebas
`npm test` corre:
- `pruebas_agenda.js`: 30 pruebas de las funciones puras, sin base de datos.
- `pruebas_servidor.js`: 100 pruebas del servidor contra **MySQL real**, con la hora fija. Crean y borran su propia base `gestor_citas_test` (no tocan `gestor_citas`); el usuario de tu `.env` debe poder crear bases de datos. Si no hay conexión a MySQL se omiten con un aviso.

## Estructura
- `agenda_funcional.js`: reglas como funciones puras (la hora actual entra como parámetro `ahora`) y `main()` de demostración.
- `conversiones.js`: validación y conversión de datos de entrada, también funciones puras.
- `server.js`: rutas, sesiones, transacciones (`SELECT ... FOR UPDATE`) y el barrido cada minuto.
- `bases/baseTablas.sql`: tablas, vistas y triggers de auditoría. `bases/scriptEjem.sql`: datos de ejemplo.
- `public/`: los cuatro portales (`paciente`, `doctor`, `recepcionista`, `administrador`) y `index.html` (acceso y registro).

## Limitaciones conocidas
- El inicio de sesión es por **nombre de pila** (como en el proyecto original): dos usuarios con el mismo nombre y la misma contraseña se confundirían. Las contraseñas se guardan con SHA-256 sin sal; para producción usa bcrypt/argon2.
- Las sesiones viven en memoria: al reiniciar el servidor hay que iniciar sesión de nuevo.
- El alta de "enfermera" (caso de uso 1) no está implementada; se pueden dar de alta doctores y recepcionistas.
- Cada consulta dura 30 minutos. Los portales cargan Tailwind y Remixicon desde un CDN, así que necesitan internet.
