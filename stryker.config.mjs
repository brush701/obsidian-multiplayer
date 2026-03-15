/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.json',
  mutate: [
    'src/auth.ts',
    'src/api.ts',
    'src/sharedTypes.ts',
    'src/util.ts',
  ],
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  timeoutMS: 30000,
  timeoutFactor: 2,
  cleanTempDir: 'always',
};
