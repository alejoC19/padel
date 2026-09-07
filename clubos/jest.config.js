/**
 * Configuración de Jest para ClubOS.
 *
 * Dos tipos de test conviven:
 *   *.spec.ts      → unit. Prueban lógica real sin base de datos. Rápidos.
 *   *.int-spec.ts  → integración. Requieren Postgres de test. Corren en serie.
 *
 * `npm test`        corre todo
 * `npm run test:unit`  solo unit (no necesita base)
 * `npm run test:int`   solo integración (necesita DATABASE_URL de test)
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.int-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.dto.ts',
  ],
  coverageDirectory: 'coverage',
  // Integración puede tardar (arranca contenedores / hace I/O real).
  testTimeout: 30_000,
  clearMocks: true,
};
