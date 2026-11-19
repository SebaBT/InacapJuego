# Pabellón B — música

Una sola pieza de terror suave, en ocho estados. No son ocho canciones: es la
misma pieza de ocho compases y las capas entran y salen según lo que pasa en la
partida. La melodía nunca se reinicia al cambiar de estado.

- **Tempo:** 72 BPM base; persecución sube a 160 BPM y cercanía a 148 BPM. 4/4,
  8 compases (la vuelta dura 26,7 s a 72 y 12 s a 160).
- **Tonalidad:** La menor; victoria la lleva a La mayor.
- **Sin samples:** todo se sintetiza con WebAudio (20 capas).
- **Archivos:** `score-engine.js` (motor y partitura), `index.html` (página para
  escuchar), `demo.js` (interfaz), `demo.bundle.js` (demo ya compilada).

## Escucharlo

Abre `music/index.html` con doble clic. La demo funciona desde `file://` porque
usa el bundle clásico. Pulsa **Comenzar** o cualquier estado; el navegador pide
un gesto para habilitar el audio.

La barra superior permite iniciar/detener, cambiar el volumen y lanzar un
**Recorrido** automático que pasa por todos los estados con sus transiciones.
El botón **Alerta** (o la tecla `A`) prueba el aviso de peligro. Los atajos
`1`–`8` cambian de estado y `Espacio` inicia o detiene.

Si editas `demo.js`, recompila el bundle:

```bash
node music/build.mjs
```

`score-engine.js` no necesita compilación si lo importas desde el juego.

## Los ocho estados

| Estado | Qué hace la música |
| --- | --- |
| `menu` | Drone, caja de música completa y aire. Sin pulso ni bajo. |
| `paused` | No es una pista: es el estado anterior con filtro a 680 Hz, pulso apagado y menos volumen. |
| `ambient` | Entran el bajo pizzicato y un pulso lento; la melodía se vuelve más espaciada. |
| `chase` | Sube a **160 BPM**: arpegio de clave, redoblante, tambores, galope, coro, theremin, sirena, metales y fragmentos de la melodía. |
| `near` | Sube a **148 BPM**: corazón por negra, subgraves, coro, sirena, tambores lejanos, aliento y una segunda menor. La caja se desafina 30 cents. |
| `lose` | Todo cae: filtro cerrado, caja desafinada 55 cents, un golpe grave y la melodía arrastrándose. |
| `win` | La misma melodía en modo mayor, campanas y cuerdas que resuelven. |
| `truewin` | Versión completa: campanas, cuerdas mayores, pad y aire. |

La lógica es la de Balatro: mismo material, misma armonía, distinta instrumentación.
La excepción deliberada es el tempo: persecución y cercanía aceleran la pieza, y un
redoble tapa el cambio. Al volver a ambiente o a un desenlace, retoma los 72 BPM
sin reiniciar la melodía.

Persecución tiene un arco de 8 compases: el redoblante entra en 0–1 y 4–5, el coro
en 0, 2 y 6, el theremin desde el 2, los metales marcan los contratiempos desde el 2
y el crash abre los bloques de cuatro. La clave mantiene el arpegio de semicorcheas
durante todo el arco salvo el compás 6, para que la vuelta respire.

## Integración actual en Pabellón B

El juego ya usa el motor a través de `src/music.js`:

- Arranca en el primer gesto del jugador (`unlockGameAudio`).
- Traduce `GAME_PHASES`, `THREAT_STAGES`, la distancia al monstruo y el resultado
  de la partida a los ocho estados.
- Sigue el volumen y el mute del control de sonido existente.
- `paused` es un tratamiento sobre la pieza que estaba sonando.
- Con `roid` o `flash`, cuando La Veladora huye o queda aturdida, vuelve a `ambient`.
- El estado actual queda visible en `#game[data-music]` para depurar.

La lógica de decisión está aislada en `resolveMusicState()` y cubierta por
`tests/music.test.js`.

## Integrarlo al juego

```js
import { createHorrorScore } from '../music/score-engine.js';

// Comparte el AudioContext y el destino que ya usa el juego.
const score = createHorrorScore({
  audioContext: juegoCtx,
  destination: juegoMaster,
  volume: 0.72,
  state: 'menu'
});

// Después del primer gesto del jugador.
score.start();

// Cada cambio de fase o de amenaza.
score.setState('ambient');   // acecho / exploración
score.setState('chase');     // cacería
score.setState('near');      // el monstruo está encima
score.setState('paused');    // recuerda el estado anterior
score.setState('ambient');   // al reanudar, vuelve a la mezcla que corresponda
score.setState('lose');      // derrota
score.setState('win');       // victoria
score.setState('truewin');   // victoria completa
```

Sugerencia de mapeo con las fases actuales:

- `menu`, `intro` → `menu`
- `playing` + Acecho → `ambient`
- `playing` + Alerta → `ambient` o `chase` según la distancia
- `playing` + Cacería o Frenesí → `chase`
- monstruo a menos de ~4 m → `near` (tiene prioridad sobre `chase`)
- cambio de `THREAT_STAGES` → `score.alert(etapa + 1)` sin cambiar de estado
  (llámalo sólo cuando cambie la etapa, no en cada fotograma)
- `paused` → `paused`
- `ending` + `victory` → `win`
- `ending` + `victory_complete` → `truewin`
- `ending` + cualquier derrota → `lose`

El motor acepta un `AudioContext` existente para no abrir un segundo contexto.
Si lo creas tú, `dispose()` no cierra el contexto compartido.

## API

```js
const score = createHorrorScore(options);
```

Opciones: `audioContext`, `destination`, `volume` (0–1), `state`, `reverb`.

Métodos:

- `start()` — construye el grafo y arranca el reloj.
- `stop()` — silencia y detiene el reloj; `start()` vuelve a empezar el loop.
- `setState(name)` — `menu`, `paused`, `ambient`, `chase`, `near`, `lose`, `win`, `truewin`.
- `alert(level)` — aviso de peligro de 1 a 4 (dos tonos alternos A4/E5; desde 3 suma latido, desde 4 suma golpe grave). No cambia la mezcla.
- `setVolume(value)` / `getVolume()`.
- `subscribe(fn)` — recibe `{ state, baseState, paused, running }`.
- `getAnalyser()` — analizador para un medidor.
- `dispose()`.

Las transiciones usan `setTargetAtTime` (0,5–1,4 s) y los cambios de patrón se
aplican en el siguiente paso del secuenciador, así que no hay clics ni cortes.

## Detalles de mezcla

Cada estado es una mezcla de 20 capas: `drone`, `box`, `bass`, `pad`, `strings`,
`stringsMajor`, `tick`, `heart`, `drum`, `drive`, `roll`, `arp`, `choir`, `lead`,
`sub`, `siren`, `horn`, `bell`, `air`, `breath`. Los valores están
en `STATE_CONFIG` dentro de `score-engine.js`; la tabla de la demo se genera con
esos mismos números.

El master pasa por un limitador suave y un filtro paso bajo que se cierra en
pausa y derrota. El volumen de la pieza es deliberadamente bajo: terror suave,
no sustos.
