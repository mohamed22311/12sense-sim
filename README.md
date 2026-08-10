# Twelve Senses — 3D Simulation

An interactive 3D demo of the Twelve Senses context-aware alert routing: a night-shift factory
where a critical machine alert is routed to each worker through the **safest modality** (haptic /
audio / visual) based on their live state. Built with React + Three.js (@react-three/fiber) + Vite.

## Alert routing rules (for SME review)

The routing decision is a small, deterministic, fully-tested pure function in
[`src/logic/routing.ts`](src/logic/routing.ts). Modality is chosen from the worker's **motion** and
the ambient **noise** only:

| Motion | Noise (dB) | Primary | Channels | Suppressed |
|---|---|---|---|---|
| Moving | > 70 (high) | haptic | haptic | visual, audio |
| Moving | ≤ 70 (low) | haptic | haptic, audio | visual |
| Stationary | > 70 (high) | haptic | haptic, visual | audio |
| Stationary | ≤ 70 (low) | visual | visual, audio | haptic |

For **moving + high noise** the alert is **haptic-only**, per the charter — audio can't be heard
over high noise, so it's suppressed. This is gated behind the `AUDIO_IN_HIGH_NOISE_MOTION` flag in
`src/logic/routing.ts` (set it to `true` to also play audio there).

**Safe fallback**: missing/NaN noise is treated as *high*, and unknown motion as *moving* — both
bias toward the haptic wrist channel rather than assuming a glanceable screen is safe.

## Develop & test

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build
npm run test       # watch-mode unit tests (Vitest)
npm run test:run   # single test run
npm run coverage   # test run with coverage report
```

---

## React + TypeScript + Vite (template notes)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
