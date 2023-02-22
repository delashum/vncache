module.exports = {
  roots: ['src'],
  testEnvironment: 'jsdom',
  testMatch: ['**/?(*.)+(spec).+(ts)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
}
