# 🏥 Gestor de Citas Médicas (MVP)

Proyecto escolar para la materia de **Paradigmas de Programación**. Consiste en un sistema de gestión de citas hospitalarias diseñado bajo un enfoque multiparadigma, destacando el uso del **Paradigma Funcional** para la lógica crítica de validación y agendamiento.

---

## 👥 Datos del Equipo
* **Escuela:** Escuela Superior de Cómputo (ESCOM) - IPN[cite: 1]
* **Grupo:** 3CV4[cite: 1]
* **Integrantes:**
  * Pérez López Carlos Alberto[cite: 1]
  * Chávez Gutiérrez Geraldine[cite: 1]
  * Téllez Torres Miriam[cite: 1]
* **Profesora:** Guadalupe Ana Gabriela Martínez Hernández[cite: 1]

---

## 🚀 Tecnologías Utilizadas
* **Backend:** Node.js, Express.js
* **Paradigma Funcional:** JavaScript (Funciones puras, inmutabilidad, orden superior, composición).
* **Base de Datos:** MySQL (con script DDL de configuración libre de archivos `.bak` para asegurar compatibilidad).
* **Frontend:** HTML5, CSS3, JavaScript (Fetch API).

---

## ⚙️ Enfoque del Paradigma Funcional
La lógica central del sistema implementa principios funcionales estrictos:
1. **Inmutabilidad:** Las agendas y listas de citas no se modifican directamente; cada operación de agendamiento retorna una nueva estructura ordenada.
2. **Funciones Puras:** Validaciones de traslapes, cálculo de finalización de citas y restricciones de tiempo que dependen exclusivamente de sus entradas sin efectos secundarios.
3. **Funciones de Orden Superior (HOF):** Uso intensivo de métodos como `map`, `filter`, `reduce` y canalización de validadores.

---

## 📂 Estructura del Repositorio
```text
├── agenda_funcional.js    # Núcleo de lógica funcional y validaciones puras
├── pruebas_agenda.js      # Suite de pruebas unitarias (casos normales, límites e inválidos)
├── server.js              # Servidor Express y conexión con base de datos
├── index.html             # Interfaz web del usuario para agendar citas
├── database.sql           # Script SQL para la creación e inicialización de tablas
└── README.md              # Documentación del proyecto
