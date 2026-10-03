# Paradigmas
proyecto paradigmas
1.	 describir la funcionalidad:
o	¿Qué resuelve?
Resuelve al momento de generar o cancelar una cita. Esto ya que la inmutabilidad de los datos y las funciones puras benefician a operaciones que implican transiciones de estado y demás.
o	¿Quién la usa?
Las personas que agendan las citas. O sea, la recepcionista y el paciente
o	¿Qué datos recibe?
Estructura cita que contiene las siguientes características
	Estado (que difiere por cita entre un 1 y 0, refiriéndose a su disponibilidad)
	Fecha 
	Hora
	Doctor
	Num de consultorio
o	¿Cómo transformar los datos?
Las citas pasaran por 2 fases: disponible y no disponible
o	¿Qué devuelve?
La cita generada (Hora, fecha, doctor y el mensaje: “cita generada”, en caso de que no se haya generado se imprime en pantalla “Error al generar la cita”)
2.	Pseudocódigo 
o	Paradigma funcional
FUNCIÓN finDeCita(cita) -> entero
    RETORNAR cita.inicio + cita.duracion
 
FUNCIÓN seTraslapan(a, b) -> booleano
    RETORNAR a.medico = b.medico
         Y a.inicio < finDeCita(b)
         Y b.inicio < finDeCita(a)
 
FUNCIÓN validarCita(cita, jornada) -> Resultado
    validadores = [validarTipos, validarDuracion, validarJornada(jornada)]
    RETORNAR REDUCIR(validadores, encadenar, éxito(cita))
    // encadenar(res, v) = SI res.ok ENTONCES v(res.valor) SINO res
 
FUNCIÓN agendar(agenda, nueva, jornada) -> Resultado(agenda nueva | error)
    valida = validarCita(nueva, jornada)
    SI NO valida.ok            -> RETORNAR valida
    SI ALGUNA(agenda, c -> c.id = nueva.id)
                               -> RETORNAR fallo("Identificador duplicado")
    choques = FILTRAR(agenda, c -> seTraslapan(nueva, c))
    SI choques no vacío        -> RETORNAR fallo("Traslape con ...")
    RETORNAR éxito( ORDENAR( COPIA(agenda) + [nueva], por inicio ) )
 
FUNCIÓN huecosLibres(agenda, medico, duracionMin, jornada) -> lista de [ini, fin]
    delMedico = ORDENAR( FILTRAR(agenda, c -> c.medico = medico), por inicio )
    paso(acum, c) = {
        huecos: SI c.inicio > acum.cursor ENTONCES acum.huecos + [[acum.cursor, c.inicio]] SINO acum.huecos,
        cursor: MÁXIMO(acum.cursor, finDeCita(c))
    }
    final = REDUCIR(delMedico, paso, {huecos: [], cursor: jornada.inicio})
    todos = SI final.cursor < jornada.fin ENTONCES final.huecos + [[final.cursor, jornada.fin]] SINO final.huecos
    RETORNAR FILTRAR(todos, h -> h.fin - h.ini >= duracionMin)
 
PROCEDIMIENTO main()               // única parte con entrada/salida
    agenda = datos ficticios (o filas de SQL convertidas con MAPEAR)
    resultado = agendar(agenda, citaNueva, JORNADA)
    MOSTRAR resultado
		
3.	Implementación 
o	Implementación en javaScript 
Lenguaje: JavaScript. Los cálculos están en funciones puras; console.log solo aparece en main (). No se usa interfaz gráfica ni base de datos, se usan datos meramente ficticios.

El código se encuentra en el archivo agenda_funcional.js, mientras que los casos prueba se encuentran en pruebas_agendas.js.

Para ejecutar: node agenda_funcional.js y node pruebas_agenda.js
4.	Pruebas
o	Al ejecutar el programa lanza los siguientes resultados:
 

Los resultados se definieron en el código antes de ejecutar cada prueba. Los casos incluyen valores normales, limites (duración 0, sita contigua, cita que termina justo al cierre), datos vacíos (agenda vacía, jornada llena) e inválidos (duración, negativam texto en lugar de numero, identificador duplicado). La prueba P15 verifica que la agenda original no se modifica.

<img width="921" height="362" alt="image" src="https://github.com/user-attachments/assets/45644047-0677-4ec0-9a2b-905527c38c71" />

Resumen: 18 pruebas ejecutadas, 18 aprobadas y 0 fallidas
