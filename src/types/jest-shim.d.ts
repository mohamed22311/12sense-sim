import type { vi } from 'vitest';

// Declares the `jest` global installed by vitest.setup.ts, so `tsc` recognizes
// the vendored socket.test.ts's `jest.fn` calls without editing that test.
declare global {
  // eslint-disable-next-line no-var
  var jest: typeof vi;
}

export {};
