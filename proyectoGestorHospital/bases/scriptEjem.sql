USE gestor_citas;

-- Crear un usuario paciente
INSERT INTO Usuario (nombre, correo, rol)
VALUES ('Paciente Prueba', 'paciente@hospital.com', 'Paciente');

SET @paciente = LAST_INSERT_ID();

INSERT INTO Paciente (ID, fechaNacimiento, telefono)
VALUES (@paciente, '2000-05-15', '5512345678');


-- Crear un usuario doctor
INSERT INTO Usuario (nombre, correo, rol)
VALUES ('Doctor Prueba', 'doctor@hospital.com', 'Doctor');

SET @doctor = LAST_INSERT_ID();

-- Crear una especialidad
INSERT INTO Especialidad (nombre)
VALUES ('Medicina General');

SET @especialidad = LAST_INSERT_ID();

-- Crear un consultorio
INSERT INTO Consultorio (numero)
VALUES (101);

SET @consultorio = LAST_INSERT_ID();

-- Registrar al doctor
INSERT INTO Doctor (ID, especialidadID, consultorioID)
VALUES (@doctor, @especialidad, @consultorio);


-- Consultar los identificadores
SELECT * FROM Usuario;
SELECT * FROM Paciente;
SELECT * FROM Doctor;