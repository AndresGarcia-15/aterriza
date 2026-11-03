/**
 * Fichas de cada componente del sistema (se abren al hacer clic sobre él en la
 * vista 3D del hardware o del atleta). Cada dato lleva su unidad.
 */
import { FSR_INFO, IMU_INFO, SAT_RAW, hwNow, tilt, volts } from './banco'
import { useLive } from './store'

export interface Ficha {
  id: string
  titulo: string
  modelo: string
  que: string            // qué es
  rol: string            // qué hace dentro de Aterriza
  donde?: string         // dónde va sobre el cuerpo (vista del atleta)
  specs: [string, string][]
  conexion?: [string, string][]
  estado?: string        // aviso puntual (p. ej. pendiente de instalar)
  ahora?: () => string | null
}

const fsrFicha = (k: number): Ficha => {
  const s = FSR_INFO[k]
  const talon = k % 2 === 0
  return {
    id: `fsr${k}`,
    titulo: `FSR · ${s.nombre}`,
    modelo: 'Interlink FSR 402 · resistor sensible a la fuerza',
    que: 'Una película cuya resistencia baja cuando se presiona. En un divisor de voltaje con una resistencia fija, más fuerza da más voltaje en el pin.',
    rol: talon
      ? 'Marca cuándo apoya el talón. Comparado con el antepié dice si el aterrizaje fue antepié → talón (lo correcto) o de talón primero, y aporta al reparto de carga izquierda / derecha.'
      : 'Suele ser el primer contacto. Su momento de carga contra el del talón da el orden de apoyo (ms) y su lectura entra en la carga de impacto y el reparto entre piernas.',
    donde: talon ? 'Bajo el centro del talón, dentro del calzado, sobre la plantilla.' : 'Bajo la cabeza de los metatarsianos (la "almohadilla" del antepié).',
    specs: [
      ['Área activa', 'Ø 12,7 mm'],
      ['Rango útil', '≈ 0,2 – 20 N por sensor'],
      ['Divisor', 'FSR a 3,3 V · 1 kΩ a GND'],
      ['Lectura', '0 – 4095 cuentas (ADC 12 bits) ≈ 0 – 3,3 V'],
      ['Saturación', `≥ ${SAT_RAW} cuentas`],
      ['Suavizado', 'promedio móvil de 3 muestras (30 ms)'],
      ['Unidad en la app', '× carga de pie (sin calibrar a newtons)'],
    ],
    conexion: [
      ['Pin', `GPIO ${s.gpio} (ADC1, canal ${s.gpio - 28})`],
      ['Muestreo', '100 Hz · 4 lecturas promediadas por muestra'],
    ],
    ahora: () => {
      const hw = hwNow()
      if (!hw) return null
      const r = hw.raw[k]
      return `${r} cuentas · ≈ ${volts(r).toFixed(2).replace('.', ',')} V${r >= SAT_RAW ? ' · saturado' : ''}`
    },
  }
}

const imuFicha = (n: number): Ficha => {
  const m = IMU_INFO[n]
  const roles: Record<string, [string, string]> = {
    T: [
      'Inclinación del muslo en el plano sagital (°). Junto con la de la pierna da el ángulo de rodilla; sumada a la del tronco aproxima la flexión de cadera.',
      'Cara anterolateral del muslo derecho, a mitad de camino entre la cadera y la rodilla. Eje X impreso hacia la cadera, Z saliendo de la piel. Banda elástica firme.',
    ],
    P: [
      'Inclinación de la pierna (°). Rodilla = −(pierna − muslo), relativa a la tara de pie. Su inclinación frontal aproxima el valgo dinámico de la rodilla derecha.',
      'Cara anterior de la tibia derecha, en el tercio medio (donde no hay músculo que se mueva). Eje X hacia la rodilla, Z saliendo de la piel.',
    ],
    L: [
      'Flexión del tronco (°) e inclinación lateral (°). Son los ítems de tronco del protocolo LESS.',
      'Zona lumbar baja (L3 – L5), centrada sobre la columna. Eje X hacia la cabeza, Z hacia atrás (saliendo de la piel).',
    ],
  }
  return {
    id: `imu-${m.id}`,
    titulo: `IMU · ${m.nombre}`,
    modelo: 'MPU6050 (acelerómetro + giroscopio) con magnetómetro QMC5883P',
    que: 'Unidad inercial de 6 ejes más magnetómetro. El firmware fusiona acelerómetro y giroscopio (filtro Mahony) para saber hacia dónde apunta el segmento, también durante el impacto.',
    rol: roles[m.id][0],
    donde: roles[m.id][1],
    specs: [
      ['Acelerómetro', '±16 g · 2048 LSB/g'],
      ['Giroscopio', '±2000 °/s · 16,4 LSB/(°/s)'],
      ['Magnetómetro', '±8 G · 3750 LSB/G (no entra en la fusión)'],
      ['Filtro interno', 'paso bajo de 44 Hz'],
      ['Fusión', 'Mahony, Kp = 1 · ignora el acelerómetro si |a| se aleja > 0,15 g de 1 g'],
    ],
    conexion: [
      ['Bus', `SDA ${m.sda} / SCL ${m.scl} · ${m.bus}`],
      ['Dirección', '0x68 (magnetómetro 0x2C en modo bypass)'],
      ['Velocidad', m.bus.includes('software') ? '≈ 150 – 200 kHz' : '400 kHz'],
    ],
    estado: m.opcional ? 'Pendiente de instalar: mientras falte, los ítems de tronco quedan «no disponibles». Al conectarla el firmware la detecta solo (la busca cada 3 s).' : undefined,
    ahora: () => {
      const hw = hwNow()
      if (!hw?.ok) return null
      if (!hw.ok[n]) return m.opcional ? 'no conectada' : 'sin señal I2C'
      const t = tilt(hw.q?.[n])
      return `|a| ${(hw.a?.[n] ?? 0).toFixed(2).replace('.', ',')} g · giro ${Math.round(hw.g?.[n] ?? 0)} °/s · inclinación ${t === null ? '—' : Math.round(t)}°`
    },
  }
}

export const FICHAS: Record<string, Ficha> = {
  esp32: {
    id: 'esp32',
    titulo: 'ESP32 · el cerebro del sistema',
    modelo: 'ESP32-WROOM-32D en placa de desarrollo con USB-C',
    que: 'Microcontrolador de dos núcleos con Wi-Fi y Bluetooth. Un núcleo muestrea los sensores a ritmo fijo; el otro solo transmite.',
    rol: 'Cada 10 ms lee las 4 plantillas y las 3 IMU, fusiona la orientación de cada segmento, calcula rodilla y tronco y envía una línea CSV al computador. También guarda las calibraciones aunque se apague.',
    donde: 'En un cinturón o riñonera a la cintura, atrás y a la derecha, para que no estorbe la caída.',
    specs: [
      ['CPU', '2 núcleos Xtensa LX6 · 240 MHz'],
      ['Muestreo', '100 Hz (periodo de 10 ms)'],
      ['Tiempo por muestra', '≈ 1,8 ms (máx. medido 3,3 ms de 10 ms)'],
      ['ADC', '12 bits · 0 – 4095 cuentas · atenuación 11 dB'],
      ['I2C', '2 por hardware (muslo, pierna) + 1 por software (lumbar)'],
      ['Firmware', 'v0.2.0 · FreeRTOS'],
    ],
    conexion: [
      ['Alimentación', '5 V por USB · lógica a 3,3 V'],
      ['Datos', 'USB serie a 921 600 baud'],
    ],
    ahora: () => {
      const st = useLive.getState().status
      return st?.estado === 'conectado' ? `${Math.round(st.hz)} Hz · ${st.perdidas} muestras perdidas` : null
    },
  },
  'plantilla-izq': {
    id: 'plantilla-izq',
    titulo: 'Plantilla instrumentada · izquierda',
    modelo: '2 × FSR 402 (talón y antepié)',
    que: 'Una plantilla que va dentro del calzado con dos sensores de fuerza en las zonas que primero reciben el impacto.',
    rol: 'Detecta el despegue y el contacto (de ahí sale el tiempo de vuelo), el orden de apoyo antepié → talón, la simultaneidad entre pies y el reparto de carga.',
    donde: 'Dentro del zapato izquierdo, con los sensores bajo el talón y bajo el antepié.',
    specs: [
      ['Sensores', '2 FSR 402'],
      ['Detección de vuelo', 'suma < 8 % de la carga de pie'],
      ['Contacto', 'suma > 15 % de la carga de pie, tras 80 – 1500 ms de vuelo'],
      ['Carga', '× carga de pie (relativa)'],
    ],
  },
  'plantilla-der': {
    id: 'plantilla-der',
    titulo: 'Plantilla instrumentada · derecha',
    modelo: '2 × FSR 402 (talón y antepié)',
    que: 'Igual a la izquierda. La pierna derecha es además la que lleva las IMU de muslo y pierna.',
    rol: 'Contacto, orden de apoyo, simultaneidad con el pie izquierdo y reparto de carga (LSI, %).',
    donde: 'Dentro del zapato derecho.',
    specs: [
      ['Sensores', '2 FSR 402'],
      ['Simetría', 'LSI = menor / mayor carga en los primeros 300 ms (%)'],
      ['Simultaneidad', 'diferencia de contacto entre pies (ms)'],
    ],
  },
  usb: {
    id: 'usb',
    titulo: 'Cable USB-C · datos al computador',
    modelo: 'Serie USB (CP210x) a 921 600 baud',
    que: 'Lleva la energía a la placa y los datos al computador.',
    rol: 'Por cada muestra viaja una línea CSV de 36 columnas: tiempo, 4 plantillas, 9 valores por IMU, rodilla, tronco y banderas de estado. La plataforma la lee, detecta los saltos y los analiza.',
    specs: [
      ['Velocidad', '921 600 baud (115 200 no alcanza)'],
      ['Línea', '≈ 230 bytes · 36 columnas'],
      ['Caudal', '≈ 23 kB/s a 100 Hz'],
      ['Comandos', 't tara · g giroscopio · a acelerómetro · m magnetómetro · i estado'],
    ],
  },
  'bus-T': {
    id: 'bus-T',
    titulo: 'Bus I2C · IMU del muslo',
    modelo: '4 hilos: 3,3 V, GND, SDA, SCL',
    que: 'Cable de datos digital compartido por el MPU6050 y su magnetómetro.',
    rol: 'Cada 10 ms el ESP32 pide 14 bytes (aceleración, temperatura y giro) y cada 20 ms 6 bytes del magnetómetro.',
    specs: [
      ['Velocidad', '400 kHz'],
      ['Pines', 'SDA 21 / SCL 22 (Wire)'],
      ['Largo recomendado', '< 1 m, trenzado con GND'],
      ['Si hay errores', 'bajar a 100 kHz en config.h'],
    ],
  },
  'bus-P': {
    id: 'bus-P',
    titulo: 'Bus I2C · IMU de la pierna',
    modelo: '4 hilos: 3,3 V, GND, SDA, SCL',
    que: 'Segundo controlador I2C por hardware del ESP32.',
    rol: 'Lleva las lecturas de la pierna. Ir en un bus propio evita que los magnetómetros, que tienen la misma dirección, choquen.',
    specs: [
      ['Velocidad', '400 kHz'],
      ['Pines', 'SDA 18 / SCL 19 (Wire1)'],
      ['Largo recomendado', '< 1 m, trenzado con GND'],
    ],
  },
  'bus-L': {
    id: 'bus-L',
    titulo: 'Bus I2C · IMU lumbar',
    modelo: 'I2C por software (bit-banging)',
    que: 'El ESP32 solo tiene dos controladores I2C: el tercero se genera por programa.',
    rol: 'Reservado para la IMU lumbar. Mientras no esté, el firmware la busca cada 3 s sin afectar el muestreo.',
    specs: [
      ['Velocidad', '≈ 150 – 200 kHz'],
      ['Pines', 'SDA 16 / SCL 17 (RX2 / TX2)'],
    ],
    estado: 'Pendiente de instalar.',
  },
  'cable-fsr': {
    id: 'cable-fsr',
    titulo: 'Línea analógica de las plantillas',
    modelo: 'Divisor de voltaje FSR + 1 kΩ',
    que: 'Dos hilos por sensor: 3,3 V hacia el FSR y la salida del divisor hacia un pin analógico.',
    rol: 'El ESP32 mide el voltaje con su ADC. Sin presión el FSR casi no conduce (≈ 0 V); al pisar baja su resistencia y sube el voltaje.',
    specs: [
      ['Resistencia fija', '1 kΩ (con 10 kΩ se satura con poca fuerza)'],
      ['Pines', 'GPIO 32, 33, 34, 35 (ADC1: siguen funcionando con Wi-Fi)'],
      ['Piso del ADC', '≈ 0,14 V: por debajo lee 0 cuentas'],
    ],
  },
}
FSR_INFO.forEach((_, k) => (FICHAS[`fsr${k}`] = fsrFicha(k)))
IMU_INFO.forEach((_, n) => (FICHAS[`imu-${IMU_INFO[n].id}`] = imuFicha(n)))
