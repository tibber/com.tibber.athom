/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/build/', '<rootDir>/.homeybuild/'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
};
