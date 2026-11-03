# Aterriza · interfaz web

React 19 + TypeScript + Vite, con three.js (React Three Fiber + drei) para el atleta y el
banco de pruebas en 3D, Tailwind CSS v4, Zustand y Motion.

```bash
npm ci            # dependencias
npm run dev       # desarrollo en http://localhost:5173 (la API debe correr en :8000)
npm run lint      # ESLint
npm test          # Vitest
npm run build     # tipos (tsc) + compilación a dist/, que sirve el backend
npm run e2e       # Playwright contra la plataforma en :8000
```

Estructura de `src/`:

| Carpeta | Contenido |
|---|---|
| `pages/` | Pantallas: Inicio, Preparar, Evaluar, Resultado, Progreso, Banco, Pro |
| `three/` | Escena 3D: atleta (rig Mixamo), banco de hardware, sensores sobre el cuerpo, explorador de piezas |
| `components/` | UI compartida y las marcas gráficas propias (`marks.tsx`) |
| `lib/` | API, WebSocket en vivo, estado global, fichas técnicas de cada componente |
