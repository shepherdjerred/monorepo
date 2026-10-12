import { z } from "zod";
import { mkdir } from "node:fs/promises";

const ChampionSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      passive: z.object({
        image: z.object({ full: z.string().regex(/^[\w.-]+\.png$/) }),
      }),
      spells: z
        .array(
          z.object({
            image: z.object({ full: z.string().regex(/^[\w.-]+\.png$/) }),
          }),
        )
        .length(4),
    }),
  ),
});

/** Pinned to the same local snapshot as champion descriptions and ability facts. */
export async function downloadAbilityIcons(version: string): Promise<void> {
  const root = `${import.meta.dir}/../src/data-dragon/assets`;
  const champions = z
    .object({
      data: z.record(
        z.string(),
        z.object({ id: z.string(), modernKey: z.string().optional() }),
      ),
    })
    .parse(await Bun.file(`${root}/champion.json`).json());
  await mkdir(`${root}/img/ability`, { recursive: true });
  const jobs = Object.values(champions.data)
    .filter((entry) => entry.modernKey === undefined)
    .flatMap((entry) =>
      ["passive", "Q", "W", "E", "R"].map((slot, index) => ({
        champion: entry.id,
        slot,
        index,
      })),
    );
  for (let offset = 0; offset < jobs.length; offset += 20) {
    await Promise.all(
      jobs.slice(offset, offset + 20).map(async ({ champion, slot, index }) => {
        const data = ChampionSchema.parse(
          await Bun.file(`${root}/champion/${champion}.json`).json(),
        ).data[champion];
        if (data === undefined) throw new Error(`Missing champion ${champion}`);
        const image =
          index === 0
            ? data.passive.image.full
            : data.spells[index - 1]?.image.full;
        if (image === undefined)
          throw new Error(`Missing ${champion} ${slot} image`);
        const url = `https://ddragon.leagueoflegends.com/cdn/${version}/img/${index === 0 ? "passive" : "spell"}/${image}`;
        const response = await fetch(url);
        if (response.status !== 200)
          throw new Error(
            `Ability icon ${champion} ${slot}: HTTP ${response.status.toString()}`,
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (
          bytes[0] !== 137 ||
          bytes[1] !== 80 ||
          bytes[2] !== 78 ||
          bytes[3] !== 71
        )
          throw new Error(`Invalid PNG for ${champion} ${slot}`);
        await Bun.write(`${root}/img/ability/${champion}-${slot}.png`, bytes);
      }),
    );
  }
  console.log(
    `Downloaded ${jobs.length.toString()} ability icons for ${version}`,
  );
}

if (import.meta.main) {
  const { version } = z
    .object({ version: z.string() })
    .parse(
      await Bun.file(
        `${import.meta.dir}/../src/data-dragon/assets/version.json`,
      ).json(),
    );
  await downloadAbilityIcons(version);
}
