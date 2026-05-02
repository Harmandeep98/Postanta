export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-await-in-loop': 'error',
      semi: ['error', 'never'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
