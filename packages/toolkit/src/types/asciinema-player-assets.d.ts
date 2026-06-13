/**
 * Bun text imports (`with { type: "text" }`) for the vendored asciinema-player
 * bundle. Bun inlines these as strings at build time (`bun build --compile`),
 * so the player ships inside the toolkit binary with no runtime dependency on
 * node_modules or a CDN.
 */
declare module "asciinema-player/dist/bundle/asciinema-player.min.js" {
  const text: string;
  export default text;
}

declare module "asciinema-player/dist/bundle/asciinema-player.css" {
  const text: string;
  export default text;
}
