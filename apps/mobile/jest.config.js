/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  clearMocks: true,
  // TZ is set before this process starts by scripts/jest-mexico-city.js.
  setupFilesAfterEnv: ['<rootDir>/jest.timezone.js'],
};
