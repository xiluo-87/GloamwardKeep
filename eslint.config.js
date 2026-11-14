import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/', 'coverage/', 'blocky-pack/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/sim/**', 'src/data/**'], rules: { 'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded Rng.' }] } },
];
