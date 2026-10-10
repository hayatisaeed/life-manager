/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: 'src/**/*.stories.{ts,tsx}',
  outDir: 'build-ladle',
  viteConfig: '.ladle/vite.config.ts',
  // Light/dark and LTR/RTL toggles are Ladle built-ins; keep them enabled (docs/DESIGN.md §6).
  addons: {
    theme: { enabled: true, defaultState: 'light' },
    rtl: { enabled: true, defaultState: false },
  },
};
