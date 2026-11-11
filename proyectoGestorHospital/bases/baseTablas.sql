-- Crear la base de datos
CREATE DATABASE IF NOT EXISTS gestor_citas;
USE gestor_citas;

-- Tabla base para la herencia de Usuarios
CREATE TABLE Usuario (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(100) UNIQUE NOT NULL,
    rol VARCHAR(50) NOT NULL
);

-- Tablas hijas de Usuario
CREATE TABLE Paciente (
    ID INT PRIMARY KEY,
    fechaNacimiento DATE NOT NULL,
    telefono VARCHAR(15),
    FOREIGN KEY (ID) REFERENCES Usuario(ID) ON DELETE CASCADE
);

CREATE TABLE Administrador (
    ID INT PRIMARY KEY,
    FOREIGN KEY (ID) REFERENCES Usuario(ID) ON DELETE CASCADE
);

CREATE TABLE Recepcionista (
    ID INT PRIMARY KEY,
    escritorioID INT NOT NULL,
    FOREIGN KEY (ID) REFERENCES Usuario(ID) ON DELETE CASCADE
);

CREATE TABLE Especialidad (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE Consultorio (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    numero INT NOT NULL UNIQUE
);

CREATE TABLE Doctor (
    ID INT PRIMARY KEY,
    especialidadID INT NOT NULL,
    consultorioID INT NOT NULL,
    FOREIGN KEY (ID) REFERENCES Usuario(ID) ON DELETE CASCADE,
    FOREIGN KEY (especialidadID) REFERENCES Especialidad(ID),
    FOREIGN KEY (consultorioID) REFERENCES Consultorio(ID)
);

CREATE TABLE HorarioDoctor (
    horarioID INT AUTO_INCREMENT PRIMARY KEY,
    doctorID INT NOT NULL,
    dia INT NOT NULL, -- 1=Lunes, 7=Domingo
    horaInicio INT NOT NULL,
    FOREIGN KEY (doctorID) REFERENCES Doctor(ID) ON DELETE CASCADE
);

CREATE TABLE Cita (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    doctorID INT NOT NULL,
    pacienteID INT NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    estado INT NOT NULL DEFAULT 1, -- 1 = Activa, 0 = Cancelada
    creadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- para el plazo de pago de 8 h
    -- 'activa' vale 1 si la cita está activa y NULL si está cancelada; MySQL ignora los NULL en
    -- las restricciones UNIQUE, así que una cita cancelada libera el horario.
    activa TINYINT GENERATED ALWAYS AS (IF(estado = 1, 1, NULL)) STORED,
    -- Última barrera contra horarios duplicados (el traslape parcial lo valida el servidor)
    UNIQUE KEY uq_cita_doctor (doctorID, fecha, hora, activa),
    UNIQUE KEY uq_cita_paciente (pacienteID, fecha, hora, activa),
    FOREIGN KEY (doctorID) REFERENCES Doctor(ID),
    FOREIGN KEY (pacienteID) REFERENCES Paciente(ID)
);

CREATE TABLE Pago (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    citaID INT NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (citaID) REFERENCES Cita(ID) ON DELETE CASCADE
);

CREATE TABLE Ticket (
    ticketID INT AUTO_INCREMENT PRIMARY KEY,
    pagoID INT NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (pagoID) REFERENCES Pago(ID) ON DELETE CASCADE
);