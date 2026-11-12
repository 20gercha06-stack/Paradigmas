-- ==========================================================================
-- Gestor de citas del hospital (MySQL 8) - esquema, vistas y triggers
-- Las reglas de negocio (traslapes, 8 h, 48 h-3 meses, reembolso 50 %...) viven
-- en agenda_funcional.js. Aquí solo hay datos, restricciones y auditoría.
-- Ejecutar primero este archivo y después scriptEjem.sql
-- ==========================================================================
CREATE DATABASE IF NOT EXISTS gestor_citas CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE gestor_citas;
SET NAMES utf8mb4;

-- ---------- Catálogos ----------
CREATE TABLE Especialidad (
    id_Especialidad INT AUTO_INCREMENT PRIMARY KEY,
    Nombre_Esp VARCHAR(50) NOT NULL,
    Costo_Consulta DECIMAL(10,2) NOT NULL CHECK (Costo_Consulta >= 0)
);

CREATE TABLE Consultorio (
    id_Consultorio INT AUTO_INCREMENT PRIMARY KEY,
    Numero_Consultorio INT NOT NULL UNIQUE
);

-- ---------- Personal ----------
-- La jornada laboral del doctor (req. 3) es Hora_Inicio-Hora_Fin de su Empleado.
CREATE TABLE Empleado (
    id_Empleado INT AUTO_INCREMENT PRIMARY KEY,
    Nombre VARCHAR(50) NOT NULL,
    A_P VARCHAR(50) NOT NULL,
    A_M VARCHAR(50),
    Tipo ENUM('Doctor','Recepcionista','Administrador') NOT NULL,
    Sueldo DECIMAL(10,2) NOT NULL DEFAULT 0,
    Hora_Inicio TIME NOT NULL,
    Hora_Fin TIME NOT NULL,
    Estatus_Activo TINYINT NOT NULL DEFAULT 1,       -- 0 = baja lógica
    CHECK (Hora_Inicio < Hora_Fin)
);

-- Usuario guarda la contraseña como SHA-256 (nunca en texto plano).
-- Empleado_id_Empleado es NULL para los pacientes (req. 6: solo ellos se dan de alta solos).
CREATE TABLE Usuario (
    id_Usuario INT AUTO_INCREMENT PRIMARY KEY,
    Contrasenia CHAR(64) NOT NULL,
    Empleado_id_Empleado INT NULL UNIQUE,
    FOREIGN KEY (Empleado_id_Empleado) REFERENCES Empleado(id_Empleado)
);

CREATE TABLE Administrador (
    id_Administrador INT AUTO_INCREMENT PRIMARY KEY,
    Empleado_id_Empleado INT NOT NULL UNIQUE,
    FOREIGN KEY (Empleado_id_Empleado) REFERENCES Empleado(id_Empleado)
);

CREATE TABLE Recepcionista (
    id_Recepcionista INT AUTO_INCREMENT PRIMARY KEY,
    Empleado_id_Empleado INT NOT NULL UNIQUE,
    FOREIGN KEY (Empleado_id_Empleado) REFERENCES Empleado(id_Empleado)
);

CREATE TABLE Doctor (
    id_Doctor INT AUTO_INCREMENT PRIMARY KEY,
    Cedula_Profesional VARCHAR(15) NOT NULL UNIQUE,
    CURP VARCHAR(18) NULL,
    Empleado_id_Empleado INT NOT NULL UNIQUE,
    Especialidad_id_Especialidad INT NOT NULL,
    Consultorio_id_Consultorio INT NOT NULL,
    FOREIGN KEY (Empleado_id_Empleado) REFERENCES Empleado(id_Empleado),
    FOREIGN KEY (Especialidad_id_Especialidad) REFERENCES Especialidad(id_Especialidad),
    FOREIGN KEY (Consultorio_id_Consultorio) REFERENCES Consultorio(id_Consultorio)
);

CREATE TABLE Paciente (
    id_Paciente INT AUTO_INCREMENT PRIMARY KEY,
    Nombre VARCHAR(40) NOT NULL,
    A_P VARCHAR(50) NOT NULL,
    A_M VARCHAR(50),
    Calle VARCHAR(50) NOT NULL,
    Colonia VARCHAR(50) NOT NULL,
    Numero VARCHAR(10) NOT NULL,
    Ciudad VARCHAR(45) NOT NULL,
    Estatus_Activo TINYINT NOT NULL DEFAULT 1,       -- 0 = el paciente se dio de baja
    Usuario_id_Usuario INT NOT NULL UNIQUE,
    FOREIGN KEY (Usuario_id_Usuario) REFERENCES Usuario(id_Usuario)
);

-- ---------- Citas ----------
CREATE TABLE Cita (
    Folio_Cita INT AUTO_INCREMENT PRIMARY KEY,
    Fecha DATE NOT NULL,
    Horario TIME NOT NULL,
    Duracion INT NOT NULL DEFAULT 30 CHECK (Duracion > 0),
    Fecha_Registro DATETIME NOT NULL,                -- base del plazo de pago de 8 h (req. 7)
    Estatus VARCHAR(40) NOT NULL DEFAULT 'Agendada pendiente',
    -- Activa = 1 mientras la cita ocupa el horario; NULL si se canceló. MySQL ignora los NULL
    -- en los UNIQUE, así que una cita cancelada libera el horario.
    Activa TINYINT GENERATED ALWAYS AS
        (IF(Estatus IN ('Agendada pendiente','Pagada pendiente por atender','Atendida'), 1, NULL)) STORED,
    Paciente_id_Paciente INT NOT NULL,
    Doctor_id_Doctor INT NOT NULL,
    -- Última barrera contra horarios duplicados (el traslape parcial lo valida agenda_funcional.js)
    UNIQUE KEY uq_cita_doctor   (Doctor_id_Doctor, Fecha, Horario, Activa),
    UNIQUE KEY uq_cita_paciente (Paciente_id_Paciente, Fecha, Horario, Activa),
    FOREIGN KEY (Paciente_id_Paciente) REFERENCES Paciente(id_Paciente),
    FOREIGN KEY (Doctor_id_Doctor) REFERENCES Doctor(id_Doctor)
);

CREATE TABLE Pago (
    id_Pago INT AUTO_INCREMENT PRIMARY KEY,
    Cita_Folio_Cita INT NOT NULL UNIQUE,
    Monto DECIMAL(10,2) NOT NULL,
    Pagado TINYINT NOT NULL DEFAULT 0,
    Fecha_Pago DATETIME NULL,
    Monto_Devolucion DECIMAL(10,2) NOT NULL DEFAULT 0,   -- req. 9: 50 % de lo pagado
    FOREIGN KEY (Cita_Folio_Cita) REFERENCES Cita(Folio_Cita)
);

CREATE TABLE Receta (
    Folio_Recetas INT AUTO_INCREMENT PRIMARY KEY,
    Diagnostico VARCHAR(200) NOT NULL,
    Tratamiento VARCHAR(200) NOT NULL,
    Observacion VARCHAR(200),
    Cita_Folio_Cita INT NOT NULL UNIQUE,
    FOREIGN KEY (Cita_Folio_Cita) REFERENCES Cita(Folio_Cita)
);

CREATE TABLE Receta_Medicamento (
    id_Receta_Medicamento INT AUTO_INCREMENT PRIMARY KEY,
    Receta_Folio_Recetas INT NOT NULL,
    Descripcion VARCHAR(200) NOT NULL,
    FOREIGN KEY (Receta_Folio_Recetas) REFERENCES Receta(Folio_Recetas)
);

CREATE TABLE Ticket (
    id_Ticket INT AUTO_INCREMENT PRIMARY KEY,
    Pago_id_Pago INT NOT NULL UNIQUE,
    Fecha DATE NOT NULL,
    Hora TIME NOT NULL,
    Subtotal DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (Pago_id_Pago) REFERENCES Pago(id_Pago)
);

-- Req. 4: el doctor no cancela solo; pide autorización y el administrador decide.
CREATE TABLE Solicitud_Cancelacion (
    id_Solicitud INT AUTO_INCREMENT PRIMARY KEY,
    Cita_Folio_Cita INT NOT NULL,
    Doctor_id_Doctor INT NOT NULL,
    Motivo VARCHAR(200) NOT NULL,
    Estatus ENUM('Pendiente','Autorizada','Rechazada') NOT NULL DEFAULT 'Pendiente',
    Fecha_Solicitud DATETIME NOT NULL,
    FOREIGN KEY (Cita_Folio_Cita) REFERENCES Cita(Folio_Cita),
    FOREIGN KEY (Doctor_id_Doctor) REFERENCES Doctor(id_Doctor)
);

-- ---------- Auditoría ----------
CREATE TABLE Bitacora_Estatus_Cita (
    id_Bitacora_Estatus INT AUTO_INCREMENT PRIMARY KEY,
    Folio_cita INT NOT NULL,
    Fecha_mov DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Estatus_cita VARCHAR(40) NOT NULL,
    Fecha_cita DATE NOT NULL,
    id_Especialidad INT NOT NULL,
    Costo DECIMAL(10,2) NOT NULL,
    Monto_Devuelto DECIMAL(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE Bitacora_Historial_Citas (
    Id_Historial INT AUTO_INCREMENT PRIMARY KEY,
    Usuario_Accion VARCHAR(100) NOT NULL DEFAULT (CURRENT_USER()),
    Fecha_mov DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Folio_cita INT NOT NULL,
    Fecha_cita DATE NOT NULL,
    Hora_cita TIME NOT NULL,
    Id_Paciente INT NOT NULL,
    Id_doctor INT NOT NULL,
    Estatus_consulta VARCHAR(40) NOT NULL
);

-- ---------- Vistas ----------
CREATE VIEW vw_CatalogoDoctores AS
SELECT d.id_Doctor, d.Cedula_Profesional,
       CONCAT_WS(' ', emp.Nombre, emp.A_P, emp.A_M) AS Nombre_Doctor,
       e.Nombre_Esp AS Especialidad, e.Costo_Consulta, c.Numero_Consultorio,
       CONCAT(TIME_FORMAT(emp.Hora_Inicio, '%H:%i'), ' - ', TIME_FORMAT(emp.Hora_Fin, '%H:%i')) AS Horario_Atencion
FROM Doctor d
JOIN Empleado emp ON d.Empleado_id_Empleado = emp.id_Empleado
JOIN Especialidad e ON d.Especialidad_id_Especialidad = e.id_Especialidad
JOIN Consultorio c ON d.Consultorio_id_Consultorio = c.id_Consultorio
WHERE emp.Estatus_Activo = 1;

CREATE VIEW vw_AgendaCitas AS
SELECT c.Folio_Cita, c.Fecha, c.Horario, pg.Monto AS Monto_Pago, c.Estatus AS Pago_Cita,
       CONCAT_WS(' ', p.Nombre, p.A_P, p.A_M) AS Nombre_Paciente,
       CONCAT_WS(' ', emp.Nombre, emp.A_P, emp.A_M) AS Nombre_Doctor,
       e.Nombre_Esp AS Especialidad, con.Numero_Consultorio
FROM Cita c
JOIN Paciente p ON c.Paciente_id_Paciente = p.id_Paciente
JOIN Doctor d ON c.Doctor_id_Doctor = d.id_Doctor
JOIN Empleado emp ON d.Empleado_id_Empleado = emp.id_Empleado
JOIN Especialidad e ON d.Especialidad_id_Especialidad = e.id_Especialidad
JOIN Consultorio con ON d.Consultorio_id_Consultorio = con.id_Consultorio
LEFT JOIN Pago pg ON pg.Cita_Folio_Cita = c.Folio_Cita;

CREATE VIEW vw_ExpedientePaciente AS
SELECT p.id_Paciente, p.Nombre, p.A_P, p.A_M, p.Calle, p.Ciudad,
       CONCAT_WS(' ', p.Nombre, p.A_P, p.A_M) AS Nombre_Paciente,
       CONCAT(p.Calle, ' ', p.Numero, ', ', p.Colonia, ', ', p.Ciudad) AS Direccion_Completa
FROM Paciente p WHERE p.Estatus_Activo = 1;

-- ---------- Triggers (una sola sentencia cada uno: no requieren DELIMITER) ----------
CREATE TRIGGER trg_Cita_Insert_Historial AFTER INSERT ON Cita FOR EACH ROW
INSERT INTO Bitacora_Historial_Citas (Folio_cita, Fecha_cita, Hora_cita, Id_Paciente, Id_doctor, Estatus_consulta)
VALUES (NEW.Folio_Cita, NEW.Fecha, NEW.Horario, NEW.Paciente_id_Paciente, NEW.Doctor_id_Doctor, NEW.Estatus);

CREATE TRIGGER trg_Cita_Insert_Estatus AFTER INSERT ON Cita FOR EACH ROW
INSERT INTO Bitacora_Estatus_Cita (Folio_cita, Estatus_cita, Fecha_cita, id_Especialidad, Costo)
SELECT NEW.Folio_Cita, NEW.Estatus, NEW.Fecha, d.Especialidad_id_Especialidad, e.Costo_Consulta
FROM Doctor d JOIN Especialidad e ON e.id_Especialidad = d.Especialidad_id_Especialidad
WHERE d.id_Doctor = NEW.Doctor_id_Doctor;

-- Cada cambio de estatus (pago, atención, cancelación, vencimiento) queda registrado.
CREATE TRIGGER trg_Cita_Update_Estatus AFTER UPDATE ON Cita FOR EACH ROW
INSERT INTO Bitacora_Estatus_Cita (Folio_cita, Estatus_cita, Fecha_cita, id_Especialidad, Costo, Monto_Devuelto)
SELECT NEW.Folio_Cita, NEW.Estatus, NEW.Fecha, d.Especialidad_id_Especialidad,
       COALESCE((SELECT pg.Monto FROM Pago pg WHERE pg.Cita_Folio_Cita = NEW.Folio_Cita), e.Costo_Consulta),
       COALESCE((SELECT pg.Monto_Devolucion FROM Pago pg WHERE pg.Cita_Folio_Cita = NEW.Folio_Cita), 0)
FROM Doctor d JOIN Especialidad e ON e.id_Especialidad = d.Especialidad_id_Especialidad
WHERE d.id_Doctor = NEW.Doctor_id_Doctor AND OLD.Estatus <> NEW.Estatus;
