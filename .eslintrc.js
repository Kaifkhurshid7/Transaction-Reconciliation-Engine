/**
 * ESLint Configuration — Crypto Reconciliation Engine
 *
 * Enforces consistent code style and catches common errors.
 * Run with: npm run lint
 */
module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  rules: {
    // Prevent accidental console.log in production code (use logger instead)
    'no-console': 'warn',

    // Allow unused variables prefixed with underscore (common for Express middleware signatures)
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Enforce immutability where possible
    'prefer-const': 'error',
    'no-var': 'error',

    // Prevent subtle type coercion bugs
    eqeqeq: ['error', 'always'],

    // Require braces for all control flow (prevents single-line bugs)
    curly: 'error',
  },
};
