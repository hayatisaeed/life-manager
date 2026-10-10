// Vite's `?raw` imports, used by tests for fixtures and spec checks.
declare module '*?raw' {
  const text: string;
  export default text;
}
