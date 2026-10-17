export default {
  testEnvironment: 'node',
  // Native ES modules: no Babel transform (tests run with --experimental-vm-modules).
  transform: {},
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  // Report tests build their scenario through the API (about 40 requests, 2 to 4 seconds);
  // the default 5 s left no margin on a busy machine or CI runner.
  testTimeout: 20_000,
};
