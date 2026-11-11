-- Solo para bases que YA tienen la tabla Cita creada con el script anterior.
-- (Si creas la base desde cero con baseTablas.sql, no necesitas este archivo.)
USE gestor_citas;

-- 1. Revisa que no haya citas activas duplicadas; si esta consulta devuelve filas, corrígelas antes de seguir.
SELECT doctorID, fecha, hora, COUNT(*) AS veces FROM Cita WHERE estado = 1 GROUP BY doctorID, fecha, hora HAVING veces > 1;
SELECT pacienteID, fecha, hora, COUNT(*) AS veces FROM Cita WHERE estado = 1 GROUP BY pacienteID, fecha, hora HAVING veces > 1;

-- 2. Agrega la fecha de creación, la columna 'activa' y las restricciones únicas.
ALTER TABLE Cita
    ADD COLUMN creadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN activa TINYINT GENERATED ALWAYS AS (IF(estado = 1, 1, NULL)) STORED,
    ADD UNIQUE KEY uq_cita_doctor (doctorID, fecha, hora, activa),
    ADD UNIQUE KEY uq_cita_paciente (pacienteID, fecha, hora, activa);
