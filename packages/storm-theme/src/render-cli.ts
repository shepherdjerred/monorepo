import { CardSchema, renderCard } from "./render.ts";
const input = CardSchema.parse(JSON.parse(await Bun.stdin.text()));
await Bun.write(Bun.stdout, await renderCard(input));
