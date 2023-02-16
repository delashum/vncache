module.exports = {
  roots: ['src'],
  testEnvironment: 'jsdom',
  testMatch: ['**/?(*.)+(spec).+(ts)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
}
