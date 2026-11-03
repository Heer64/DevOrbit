// [Sprint 1 · gaps] Shared lint rules (Sprint 1 plan line A: "lint/format rules").
// Run from the repository root: `npm run lint` (after `npm install` in the root folder).
// Core ESLint rules only, chosen to catch real mistakes (undefined names, unreachable code, duplicate keys...)
// without restyling existing code. Formatting is Prettier's job (.prettierrc.json).

const shared = [
  'AbortController',
  'AbortSignal',
  'Blob',
  'Buffer',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'TextDecoder',
  'TextEncoder',
  'URL',
  'URLSearchParams',
  'atob',
  'btoa',
  'clearInterval',
  'clearTimeout',
  'console',
  'crypto',
  'fetch',
  'globalThis',
  'performance',
  'queueMicrotask',
  'setInterval',
  'setTimeout',
  'structuredClone',
];
const node = ['process', 'setImmediate', 'clearImmediate', '__dirname', '__filename'];
const browser = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'File',
  'FileReader',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'Element',
  'HTMLElement',
  'Node',
  'Image',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IntersectionObserver',
  'MutationObserver',
  'ResizeObserver',
  'matchMedia',
  'getComputedStyle',
  'alert',
  'confirm',
  'WebSocket',
  'DOMParser',
  'DOMException',
];
const asGlobals = (names) => Object.fromEntries(names.map((name) => [name, 'readonly']));

// The frontend has a few `// eslint-disable-line react-hooks/exhaustive-deps` comments. ESLint reports a
// comment for a rule it does not know, so this declares that rule name without checking anything.
// To get the real React hook checks, install eslint-plugin-react-hooks and use its config instead.
const reactHooksPlaceholder = {
  rules: { 'exhaustive-deps': { meta: { type: 'suggestion', schema: [] }, create: () => ({}) } },
};

const rules = {
  // Mistakes
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-duplicate-imports': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-sparse-arrays': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-binary-expression': 'error',
  'no-empty-pattern': 'error',
  'no-loss-of-precision': 'error',
  'no-control-regex': 'error',
  'getter-return': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'for-direction': 'error',
  'no-debugger': 'error',
  // Safety
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  // Style that prevents bugs
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['warn', { destructuring: 'all' }],
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**', 'Documents/**'] },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: asGlobals([...shared, ...node]),
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules,
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    languageOptions: { globals: asGlobals([...shared, ...browser, 'process']) },
    plugins: { 'react-hooks': reactHooksPlaceholder },
  },
  {
    files: ['e2e/**/*.{js,mjs}'],
    languageOptions: { globals: asGlobals([...shared, ...node, ...browser]) },
  },
];
