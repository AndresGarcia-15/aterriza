# Base científica del motor de retroalimentación

Única fuente de umbrales y mensajes: `backend/feedback/rules.yaml` (versionado; cada
cambio desde el Modo profesional guarda la versión anterior en `feedback/historial/`).
La interfaz no afirma nada fuera de esta tabla. **Herramienta educativa de técnica; no es
un diagnóstico médico.** El índice se llama "índice de técnica", nunca "riesgo de lesión".

## Variables, criterios y fuentes

| # | Variable (regla) | Cómo se mide | Cumple | Parcial | Peso | Fuente |
|---|---|---|---|---|---|---|
| 1 | Rodilla en el contacto (`rodilla_contacto`) | `knee_flex` en el primer instante de carga | > 30° | ≥ 10° (op.) | 14 | LESS ítem 1 (Padua et al., 2009) |
| 2 | Recorrido de rodilla (`rodilla_desplazamiento`) | pico − contacto, 500 ms | > 45° | ≥ 30° (op.) | 18 | LESS ítem 4 |
| 3 | Tronco en el contacto (`tronco_contacto`) | `trunk_flex` en el contacto | ≥ 10° (op.) | ≥ 3° (op.) | 8 | LESS ítem 3; Blackburn & Padua 2008, 2009 |
| 4 | Tronco tras el contacto (`tronco_desplazamiento`) | pico − contacto | ≥ 10° (op.) | ≥ 5° (op.) | 6 | LESS ítem 6 |
| 5 | Cadera (`cadera`) | tronco + inclinación del muslo (IMU) | contacto ≥ 10° y aumento ≥ 10° (op.) | una de las dos | 8 | LESS ítems 2 y 5 |
| 6 | Patrón de apoyo (`apoyo`) | orden antepié → talón en las plantillas | antepié ≥ 5 ms antes (op.) | ±5 ms (pie plano) | 8 | LESS ítem 7; Standing & Maulder 2015 |
| 7 | Simetría de contacto (`simetria_contacto`) | diferencia izq./der. del inicio de carga | < 30 ms | < 60 ms (op.) | 5 | LESS ítem 8 |
| 8 | Simetría de carga (`simetria_carga`) | LSI de la carga de los primeros 300 ms | ≥ 90 % | ≥ 80 % (op.) | 10 | Criterio LSI de retorno al deporte (op.) |
| 9 | Tronco lateral (`tronco_lateral`) | eje frontal de la IMU lumbar | < 5° (op.) | < 10° (op.) | 5 | LESS ítem 9 |
| 10 | Valgo dinámico der. (`valgo`) | inclinación frontal de la pierna derecha | < 5° (op.) | < 10° (op.) | 8 | LESS ítems 10 y 15 (indicador, no diagnóstico) |
| 11 | Carga de impacto | pico y tasa, relativos a la carga de pie | menor es mejor | — | (en 12) | Leppänen et al. 2017 |
| 12 | Rigidez global (`rigidez`) | promedio de ítem 2 y carga relativa (≤ 4,25 baja; ≤ 4,5 media, op.) | suave | media | 10 | LESS ítem 16; Leppänen et al. 2017 |

"op." = **operativo**: el equipo lo definió para volver medible un criterio cualitativo del
protocolo; es ajustable en el Modo profesional y debe revisarse con datos
reales. Los cortes de carga del ítem 12 son provisionales hasta calibrar los FSR contra una
plataforma de fuerza (hoy la carga es *relativa a la carga de pie*, no newtons).

**Índice (0-100)** = Σ peso × (1 cumple · 0,5 parcial · 0 no cumple) / Σ pesos medibles.
Categorías: ≥ 85 Excelente · ≥ 70 Bien · ≥ 55 Mejorable · < 55 A corregir. No se usan los cortes
del puntaje total de LESS (pendiente verificarlos en el artículo original).

**Acciones:** un consejo por grupo (rodillas, tronco, pies, simetría, valgo, tronco lateral),
ordenados por Σ(peso × severidad), máximo 3. **Sesión:** recomendación principal = grupo que
aparece en ≥ 2 de los últimos 3 saltos válidos. **Confianza baja** (salto no válido): FSR
saturados > 20 % del aterrizaje, error de IMU, sin tara/calibrando o > 5 paquetes perdidos.

## Lo que NO se mide con este hardware
Ancho de la base, rotación de los pies, valgo de la pierna izquierda (sin IMU: se dibuja en
espejo y marcada como *estimada*) y fuerza de reacción del suelo real.

## Notas metodológicas
- Los ángulos son **relativos a la postura de pie** (tara del firmware). La flexión anatómica
  real de pie (~0-5°) no se suma: los valores son conservadores.
- Muslo, valgo e inclinación lateral se calculan en el PC con una réplica del filtro Mahony del
  firmware (`backend/app/orientation.py`), a partir de las columnas crudas de las IMU.
  Los signos (`THIGH_SIGN`, `VALGUS_SIGN`) se verificaron con el gemelo digital; con hardware
  real se confirman con el "test de ejes" del README del firmware.
- Orden de apoyo: instante en que cada región supera el 25 % de su carga de pie, interpolado
  entre muestras (resolución menor que el periodo de 10 ms).
- Aterrizaje de referencia (fantasma): escenario *controlado* del gemelo digital, ajustado para
  cumplir rodilla ≥ 30° en el contacto y ≥ 75° de pico y tronco ≥ 10° (`backend/app/reference.py`).

## Referencias
- Padua DA, Marshall SW, Boling MC, et al. The Landing Error Scoring System (LESS) is a valid and
  reliable clinical assessment tool of jump-landing biomechanics. *Am J Sports Med*. 2009;37(10):1996-2002.
- Padua DA, DiStefano LJ, Beutler AI, et al. The Landing Error Scoring System as a screening tool
  for an anterior cruciate ligament injury-prevention program in elite-youth soccer athletes.
  *J Athl Train*. 2015;50(6):589-595.
- Leppänen M, Pasanen K, Krosshaug T, et al. Sagittal plane hip, knee, and ankle biomechanics and
  the risk of anterior cruciate ligament injury: a prospective study. *Am J Sports Med*.
  2017;45(2):386-393. (HR 0,55 por cada 10° más de flexión máxima de rodilla; HR 1,26 por cada
  100 N más de pico vGRF; AUC 0,6-0,7: **no** se promete predicción de lesión).
- Blackburn JT, Padua DA. Influence of trunk flexion on hip and knee joint kinematics during a
  controlled drop landing. *Clin Biomech*. 2008;23(3):313-319.
- Blackburn JT, Padua DA. Sagittal-plane trunk position, landing forces, and quadriceps
  electromyographic activity. *J Athl Train*. 2009;44(2):174-179.
- Standing RJ, Maulder PS. A comparison of the habitual landing strategies from differing drop
  heights of parkour practitioners (traceurs) and recreationally trained individuals.
  *J Sports Sci Med*. 2015;14(4):723-731. (Estudio observacional pequeño: apoyo, no prueba única.)
