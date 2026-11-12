-- Datos de ejemplo. Contraseña de TODOS los usuarios de ejemplo: Pass123!
-- Usuarios: Doctores = nombre de pila (Juan, María...), Recepcionista = Diana, Administrador = Admin,
-- Pacientes = Oscar, Teresa.  Las citas de ejemplo se calculan con CURDATE() para que siempre sean válidas.
USE gestor_citas;
SET NAMES utf8mb4;

INSERT INTO Especialidad (Nombre_Esp, Costo_Consulta) VALUES
('Cardiología', 800), ('Dermatología', 750), ('Ginecología', 700), ('Medicina General', 500),
('Nutriología', 450), ('Oftalmología', 850), ('Oncología', 1200), ('Ortopedia', 900),
('Pediatría', 600), ('Nefrología', 950);

INSERT INTO Consultorio (Numero_Consultorio) VALUES (101),(102),(103),(104),(105),(106),(107),(108),(109),(110);

INSERT INTO Empleado (Nombre, A_P, A_M, Tipo, Sueldo, Hora_Inicio, Hora_Fin) VALUES
('Juan',   'García',    'López',    'Doctor', 25000, '07:00', '14:00'),
('María',  'Martínez',  'Pérez',    'Doctor', 25000, '14:00', '21:00'),
('Carlos', 'Hernández', 'Gómez',    'Doctor', 30000, '07:00', '21:00'),
('Ana',    'Gómez',     'Díaz',     'Doctor', 25000, '07:00', '14:00'),
('Luis',   'López',     'Torres',   'Doctor', 25000, '14:00', '21:00'),
('Laura',  'Pérez',     'Ruiz',     'Doctor', 30000, '07:00', '21:00'),
('Jorge',  'González',  'Sánchez',  'Doctor', 25000, '07:00', '14:00'),
('Elena',  'Rodríguez', 'Ramírez',  'Doctor', 25000, '14:00', '21:00'),
('Pedro',  'Sánchez',   'Cruz',     'Doctor', 30000, '07:00', '21:00'),
('Sofía',  'Ramírez',   'Flores',   'Doctor', 25000, '07:00', '14:00'),
('Diana',  'Torres',    'Vargas',   'Recepcionista', 8000, '07:00', '14:00'),
('Roberto','Castro',    'Ríos',     'Recepcionista', 8000, '14:00', '21:00'),
('Admin',  'Hospital',  'General',  'Administrador', 20000, '07:00', '21:00');

INSERT INTO Doctor (Cedula_Profesional, CURP, Empleado_id_Empleado, Especialidad_id_Especialidad, Consultorio_id_Consultorio) VALUES
('CED1234561','GALJ800101HDFR01',1,1,1), ('CED1234562','MAPM820202MDFR02',2,2,2),
('CED1234563','HEGC850303HDFR03',3,3,3), ('CED1234564','GODA880404MDFR04',4,4,4),
('CED1234565','LOTL900505HDFR05',5,5,5), ('CED1234566','PERL920606MDFR06',6,6,6),
('CED1234567','GOSJ950707HDFR07',7,7,7), ('CED1234568','RORE980808MDFR08',8,8,8),
('CED1234569','SACP990909HDFR09',9,9,9), ('CED1234570','RAFS011010MDFR10',10,10,10);

INSERT INTO Recepcionista (Empleado_id_Empleado) VALUES (11), (12);
INSERT INTO Administrador (Empleado_id_Empleado) VALUES (13);

-- Usuarios del personal (empleados 1..13) y de los dos pacientes de ejemplo
INSERT INTO Usuario (Contrasenia, Empleado_id_Empleado) VALUES
(SHA2('Pass123!',256),1),(SHA2('Pass123!',256),2),(SHA2('Pass123!',256),3),(SHA2('Pass123!',256),4),
(SHA2('Pass123!',256),5),(SHA2('Pass123!',256),6),(SHA2('Pass123!',256),7),(SHA2('Pass123!',256),8),
(SHA2('Pass123!',256),9),(SHA2('Pass123!',256),10),(SHA2('Pass123!',256),11),(SHA2('Pass123!',256),12),
(SHA2('Pass123!',256),13),
(SHA2('Pass123!',256),NULL),(SHA2('Pass123!',256),NULL);

INSERT INTO Paciente (A_P, A_M, Nombre, Calle, Colonia, Numero, Ciudad, Usuario_id_Usuario) VALUES
('Cruz','Alonso','Oscar','Av. Solidaridad','Centro','12','Chalco',14),
('Mora','Blancas','Teresa','Zaragoza','San Juan','45','CDMX',15);

-- Historial: dos citas ya atendidas (en el pasado) con receta, ticket y bitácora.
INSERT INTO Cita (Fecha, Horario, Duracion, Fecha_Registro, Estatus, Paciente_id_Paciente, Doctor_id_Doctor) VALUES
(DATE_SUB(CURDATE(), INTERVAL 10 DAY), '09:00:00', 30, DATE_SUB(NOW(), INTERVAL 15 DAY), 'Atendida', 1, 1),
(DATE_SUB(CURDATE(), INTERVAL 9 DAY),  '15:30:00', 30, DATE_SUB(NOW(), INTERVAL 14 DAY), 'Atendida', 2, 2);
INSERT INTO Pago (Cita_Folio_Cita, Monto, Pagado, Fecha_Pago) VALUES
(1, 800, 1, DATE_SUB(NOW(), INTERVAL 14 DAY)), (2, 750, 1, DATE_SUB(NOW(), INTERVAL 13 DAY));
INSERT INTO Receta (Diagnostico, Tratamiento, Observacion, Cita_Folio_Cita) VALUES
('Hipertensión leve', 'Tomar medicamento indicado | Duración: 30 días', 'Monitorear presión semanal', 1),
('Dermatitis', 'Aplicar crema hidratante | Duración: 5 días', 'Evitar sol directo', 2);
INSERT INTO Receta_Medicamento (Receta_Folio_Recetas, Descripcion) VALUES
(1, 'Losartán 50mg, 1 pastilla cada 24h'), (2, 'Loratadina 10mg, 1 pastilla cada 12h');
INSERT INTO Ticket (Pago_id_Pago, Fecha, Hora, Subtotal) VALUES
(1, DATE_SUB(CURDATE(), INTERVAL 10 DAY), '09:40:00', 800), (2, DATE_SUB(CURDATE(), INTERVAL 9 DAY), '16:10:00', 750);
