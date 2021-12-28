// eslint-disable-next-line no-undef
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
  rules: {
    'prettier/prettier': 'error',

    // airbnb overrides ------------------------------------
    curly: ['error', 'multi-or-nest', 'consistent'],
    'no-console': 'off',
    'no-continue': 'off',
    // let's not disallow for...of loops :/
    'no-restricted-syntax': [
      'error',
      'ForInStatement',
      'LabeledStatement',
      'WithStatement',
    ],

    // import (part of airbnb) overrides ------------------
    'import/no-import-module-exports': 'off',
    'import/prefer-default-export': 'off',

    // @typescript-eslint/recommended overrides -----------
    '@typescript-eslint/lines-between-class-members': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: false },
    ],
  },
};
