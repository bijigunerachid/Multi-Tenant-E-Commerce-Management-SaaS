export default {
  testEnvironment: 'node',
  // Native ES modules: no Babel transform (tests run with --experimental-vm-modules).
  transform: {},
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
};
