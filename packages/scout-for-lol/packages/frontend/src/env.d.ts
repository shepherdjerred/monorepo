/// <reference types="astro/client" />

// Vite/Astro raw import support (from vite/client.d.ts)
// astro/client references vite/types/import-meta.d.ts but NOT vite/client.d.ts,
// so the ?raw module declaration must be provided explicitly
declare module '*?raw' {
  const content: string;
  export default content;
}
