import noPhysicalDirection from './rules/no-physical-direction.js';

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: '@lm/eslint-plugin' },
  rules: {
    'no-physical-direction': noPhysicalDirection,
  },
};

export default plugin;
