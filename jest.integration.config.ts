import type { Config } from 'jest'

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/integration/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.ts'],
    testTimeout: 30_000,   // real DB ops can take a moment
    forceExit: true,
    verbose: true,
}

export default config
