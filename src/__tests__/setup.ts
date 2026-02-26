/**
 * Runs before every test file (via jest.config.ts `setupFiles`).
 * Sets required environment variables BEFORE any module is imported,
 * so config/index.ts `required()` guards don't throw during tests.
 */
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-chars-long'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/workspace_test'
process.env.APP_URL = 'http://localhost:3000'
