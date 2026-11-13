import { defineConfig } from 'vitest/config';

// A relative base keeps the build working under the GitHub Pages path /gloamward/.
export default defineConfig({
  base: './',
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 180000 },
});
