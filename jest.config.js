module.exports = {
  roots: ['tests'],
  testEnvironment: 'jsdom',
  testMatch: ['**/?(*.)+(spec).+(ts)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
}
