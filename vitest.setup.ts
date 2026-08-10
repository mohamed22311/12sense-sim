import { vi } from 'vitest';

// `socket.test.ts` (a vendored fixture, unedited) calls `jest.fn` — the only
// Jest API it uses. `vi.fn` is API-compatible for this usage, so the global
// is shimmed here rather than editing the copied test.
(globalThis as unknown as { jest: typeof vi }).jest = vi;
