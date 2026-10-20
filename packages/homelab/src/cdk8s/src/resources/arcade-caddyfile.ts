import { marioKartCaddyfile } from "./mario-kart-caddyfile.ts";

/** Keep Pokémon bookmarks on their original root-only redirect listener. */
export function arcadeCaddyfile(upstream: string): string {
  return `${marioKartCaddyfile(upstream)}
http://:8081 {
  handle /health {
    respond "ok" 200
  }
  handle {
    header Cache-Control "no-store"
    redir https://arcade.sjer.red 307
  }
}
`;
}
