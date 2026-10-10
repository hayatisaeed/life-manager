// Vite's `?raw` imports, used by tests that check code against the spec docs.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
