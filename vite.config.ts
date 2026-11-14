import { defineConfig } from 'vitest/config';

// A relative base keeps the build working under the GitHub Pages path /gloamward/.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { game: 'index.html', cameraPreview: 'camera-preview.html', renderBenchmark: 'render-benchmark.html', artReview: 'art-review.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 180000 },
});
