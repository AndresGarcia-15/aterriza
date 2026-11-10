# Guía rápida para la docente (1 página)

**Qué es:** una plataforma que evalúa el **aterrizaje de un salto de caída** (cajón de
30-40 cm) con 2 plantillas (4 FSR) y 3 IMU, y devuelve retroalimentación comprensible para el
deportista, basada en la escala LESS y la literatura citada en `docs/ciencia.md`.

**Cómo abrirla:** doble clic en `plataforma/Abrir Aterriza.command` (Mac) o en
`plataforma/Abrir Aterriza (Windows).cmd` (Windows); en Linux, `sh plataforma/iniciar.sh`. Se abre
el navegador en `http://127.0.0.1:8000`.

**Flujo (≈ 3 minutos):**
1. **Atleta** — elegir o crear el perfil (nombre, deporte, pierna dominante, estatura, masa).
2. **Preparación** — conectar (Demostración, ESP32 por USB o Wokwi); los 8 indicadores deben
   quedar en verde; tara guiada "quédate de pie, quieto 3-2-1".
3. **Evaluación** — el atleta 3D sigue el movimiento en vivo. Tras cada aterrizaje el sistema lo
   analiza solo, muestra una repetición en cámara lenta con el **fantasma de referencia** y una
   tarjeta con el índice y lo primero a corregir. Protocolo: 3 saltos válidos.
   *En Demostración:* botones *Controlado / Rígido / Asimétrico con valgo*.
4. **Resultado** — índice de técnica 0-100 y palabra (Excelente / Bien / Mejorable / A corregir),
   comparación 3D en el instante de máxima flexión con arcos de rodilla y tronco, mapa de
   plantillas con orden de apoyo, hasta 3 acciones priorizadas con botón **¿Por qué?**
   (explicación y cita), lo que hizo bien y el resultado por ítem.
5. **Progreso** — promedio, mejor salto, recomendación de la sesión (patrón en ≥ 2 de 3 saltos),
   tendencia entre sesiones y próxima meta. Exportar CSV o borrar al atleta.

**Modo profesional** (candado arriba a la derecha, PIN 2468): curvas crudas, comandos del
firmware, tabla de saltos con exportación CSV e informe PDF (imprimir), ajuste de umbrales con
versiones y configuración (divisor FSR, calibración, PIN).

**Qué esperar en la demostración** (verificado por pruebas automáticas):
controlado → *Excelente* (89) · rígido → *A corregir* (53) con "Flexiona más las rodillas" ·
asimétrico con valgo → *Mejorable* (66) con aviso de asimetría.

**Límites declarados:** no mide ancho de base, rotación de pies, valgo izquierdo ni fuerza real
(la carga es relativa a estar de pie). No es un diagnóstico médico ni predice lesiones.
