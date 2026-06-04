const config = {
  projects: [
    {
      displayName: 'backend',
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/backend/src/**/*.test.ts', '<rootDir>/backend/src/**/*.spec.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      moduleNameMapper: {
        '^@workspace/db$': '<rootDir>/backend/src/_shared/db/index.ts',
        '^@workspace/api-zod$': '<rootDir>/backend/src/_shared/api-zod/index.ts'
      },
      globals: {
        'ts-jest': {
          useESM: true
        }
      }
    },
    {
      displayName: 'frontend',
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/frontend/src/**/*.test.ts',
        '<rootDir>/frontend/src/**/*.test.tsx',
        '<rootDir>/frontend/src/**/*.spec.ts',
        '<rootDir>/frontend/src/**/*.spec.tsx'
      ],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/frontend/src/$1'
      },
      globals: {
        'ts-jest': {
          useESM: true
        }
      }
    }
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/']
};

module.exports = config;
