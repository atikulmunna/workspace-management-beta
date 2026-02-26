import type { Config } from 'jest'

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    // setupFiles runs before the test framework is installed — perfect for env vars
    setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
    // clearMocks: clears call history only, does NOT reset implementations or Once queues.
    // This prevents test pollution while letting each test set up its own mocks cleanly.
    clearMocks: true,
    verbose: true,
}

export default config
