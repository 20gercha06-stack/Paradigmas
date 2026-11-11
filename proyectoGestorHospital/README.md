# Gestor de citas del hospital

## Puesta en marcha
1. `npm install`
2. Copia `.env.example` a `.env` y llena los datos de tu MySQL (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=gestor_citas`, `DB_PORT`, `PORT`). **No subas `.env` a GitHub.**
3. En MySQL ejecuta, en este orden: `bases/baseTablas.sql` y `bases/scriptEjem.sql`.
   Si ya tenías la tabla `Cita` creada con la versión anterior, ejecuta en su lugar `bases/migracion_01_restricciones.sql`.
4. `npm start` y abre http://localhost:3000

## Pruebas
`npm test` corre las pruebas de las funciones puras (`pruebas_agenda.js`) y las del servidor con una base falsa (`pruebas_servidor.js`). No necesitan MySQL.

## Estructura
- `agenda_funcional.js`: reglas de negocio como funciones puras (la hora actual entra como parámetro `ahora`).
- `server.js`: única capa con entrada y salida; lee de MySQL, llama a las funciones puras y guarda.
- `public/index.html`: formulario para agendar.
