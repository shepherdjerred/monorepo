import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import path from "node:path";
import { z } from "zod";

export const currentInventoryReplaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";

const ordinarySlots = [
  "ITEM0",
  "ITEM1",
  "ITEM2",
  "ITEM3",
  "ITEM4",
  "ITEM5",
  "ITEM6",
] as const;
const itemId = z.number().int().positive().max(0xff_ff_ff_ff);
const iconAsset = z.object({
  itemId,
  icon: z.string().regex(/^item-icons\/[1-9]\d{0,9}\.png$/u),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
const sceneInventory = z.object({
  championInventory: z.object({ items: z.array(iconAsset).min(1) }),
});
const manifestFiles = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f\d]{64}$/u),
    }),
  ),
});

const footerSlot = z
  .string()
  .regex(/^\d{1,10}$/u)
  .transform(Number);
const footerRoster = z
  .array(
    z.object({
      SKIN: z.string().min(1),
      TEAM: z.enum(["100", "200"]),
      ITEM0: footerSlot,
      ITEM1: footerSlot,
      ITEM2: footerSlot,
      ITEM3: footerSlot,
      ITEM4: footerSlot,
      ITEM5: footerSlot,
      ITEM6: footerSlot,
    }),
  )
  .length(10);

function digest(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function readTerminalSlots(roflPath: string) {
  const bytes = await Bun.file(roflPath).bytes();
  if (bytes.byteLength < 32)
    throw new Error("Original replay has no complete inventory footer.");
  const end = bytes.byteLength - 4;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = header.getUint32(end, true);
  if (
    length === 0 ||
    length > 4 * 1024 * 1024 ||
    header.getUint32(0) !== 0x52_49_4f_54 ||
    header.getUint16(4, true) !== 2 ||
    end - length < 271 + header.getUint8(14)
  )
    throw new Error("Original replay footer has invalid inventory bounds.");
  const { statsJson } = z
    .object({ statsJson: z.string() })
    .parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(end - length, end),
        ),
      ),
    );
  return footerRoster.parse(JSON.parse(statsJson));
}

type ItemIcon = z.infer<typeof iconAsset> & { sha256: string };

async function readItemIcons(root: string, manifestPath: string) {
  const { files } = manifestFiles.parse(await Bun.file(manifestPath).json());
  const {
    championInventory: { items },
  } = sceneInventory.parse(
    await Bun.file(path.join(root, "scene.json")).json(),
  );
  const inventory = new Map(
    files
      .filter((file) => file.path.startsWith("item-icons/"))
      .map((file) => [file.path, file]),
  );
  expect(inventory.size).toBe(items.length);
  const icons = new Map<number, ItemIcon>();
  for (const item of items) {
    const file = inventory.get(item.icon);
    if (
      file === undefined ||
      icons.has(item.itemId) ||
      item.icon !== `item-icons/${item.itemId.toString()}.png`
    )
      throw new Error(
        "Current inventory icon is absent from its exact manifest.",
      );
    const bytes = await Bun.file(path.join(root, file.path)).bytes();
    expect(bytes.byteLength).toBe(file.bytes);
    expect(digest(bytes)).toBe(file.sha256);
    const header = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    expect(header.getUint32(0)).toBe(0x89_50_4e_47);
    expect(header.getUint32(16)).toBe(item.width);
    expect(header.getUint32(20)).toBe(item.height);
    icons.set(item.itemId, { ...item, sha256: file.sha256 });
  }
  return icons;
}

function slot(list: Locator, index: number) {
  return list.locator(`[data-replay-item-slot="${index.toString()}"]`);
}

async function assertItem(itemSlot: Locator, item: ItemIcon | undefined) {
  if (item === undefined) {
    await expect(itemSlot.locator("img")).toHaveCount(0);
    return;
  }
  const image = itemSlot.getByRole("img", { name: item.name, exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^blob:/u);
}

export async function observeRecordedItemBlobs(page: Page) {
  await page.addInitScript(() => {
    const createObjectURL = globalThis.URL.createObjectURL.bind(globalThis.URL);
    const images = new Map<string, Blob>();
    Object.defineProperty(globalThis, "__scoutRecordedItemBlobs", {
      value: images,
    });
    globalThis.URL.createObjectURL = (data) => {
      const url = createObjectURL(data);
      if (data instanceof globalThis.Blob && data.type === "image/png")
        images.set(url, data);
      return url;
    };
  });
}

async function assertBlob(image: Locator, expected: ItemIcon) {
  const actual = await image.evaluate(async (element) => {
    const source = element.getAttribute("src");
    if (source?.startsWith("blob:") !== true)
      throw new Error("Rendered replay item has no verified blob URL.");
    const images: unknown = Object.getOwnPropertyDescriptor(
      globalThis,
      "__scoutRecordedItemBlobs",
    )?.value;
    if (!(images instanceof Map))
      throw new TypeError("Recorded item image observer is absent.");
    const imageBlob: unknown = images.get(source);
    if (!(imageBlob instanceof globalThis.Blob))
      throw new TypeError("Rendered replay item blob was not observed.");
    const bytes = await imageBlob.arrayBuffer();
    const iconHash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(iconHash), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  });
  expect(actual).toBe(expected.sha256);
}

async function assertCount(itemSlot: Locator, item: ItemIcon, count: number) {
  await assertItem(itemSlot, item);
  await expect(itemSlot).toHaveText(count > 1 ? count.toString() : "");
}

type Seek = (page: Page, seconds: number) => Promise<void>;

async function verifyOpeningInventory(
  page: Page,
  seek: Seek,
  ring: ItemIcon,
  potion: ItemIcon,
) {
  const anivia = page.getByRole("list", { name: "Anivia items" });
  const first = slot(anivia, 0);
  const second = slot(anivia, 1);
  // Native opcode 840 at 2.758765 s, followed by opcode 226 at 4.129942 s.
  await seek(page, 2.7);
  await assertItem(first, undefined);
  await assertItem(second, undefined);
  await seek(page, 2.8);
  await assertCount(first, ring, 1);
  await assertCount(second, potion, 2);
  await assertBlob(
    first.getByRole("img", { name: ring.name, exact: true }),
    ring,
  );
  await seek(page, 4.2);
  await assertCount(first, potion, 2);
  await assertCount(second, ring, 1);
  // Native opcode 1143 reduces the moved stack at 114.027865 s.
  await seek(page, 114);
  await assertCount(first, potion, 2);
  await seek(page, 114.1);
  await assertCount(first, potion, 1);
  await seek(page, 4.1);
  await assertCount(first, ring, 1);
  await assertCount(second, potion, 2);
}

export async function createCurrentInventoryVerifier(fixture: {
  root: string;
  manifestPath: string;
  roflPath: string;
}) {
  const [icons, terminal] = await Promise.all([
    readItemIcons(fixture.root, fixture.manifestPath),
    readTerminalSlots(fixture.roflPath),
  ]);
  function icon(id: number) {
    const item = icons.get(id);
    if (item === undefined)
      throw new Error("Expected current replay item asset.");
    return item;
  }
  return {
    async verifySamples(page: Page, seek: Seek, testInfo: TestInfo) {
      const jhin = page.getByRole("list", { name: "Jhin items" });
      const potion = icon(2003);
      await verifyOpeningInventory(page, seek, icon(1056), potion);
      const potionSlot = slot(jhin, 1);
      await seek(page, 516.7);
      await assertItem(potionSlot, potion);
      await assertBlob(
        potionSlot.getByRole("img", { name: potion.name, exact: true }),
        potion,
      );
      await seek(page, 516.8);
      await assertItem(potionSlot, undefined);
      await seek(page, 516.7);
      await assertItem(potionSlot, potion);
      await page
        .getByRole("group", { name: "Replay roster scores" })
        .screenshot({
          path: testInfo.outputPath("recorded-current-roster-inventory.png"),
        });
      await seek(page, 0);
    },
    async verifyEnd(page: Page) {
      for (const player of terminal) {
        const table = page.getByRole("table", {
          name: player.TEAM === "100" ? "Blue team roster" : "Red team roster",
        });
        const list = table.getByRole("list", {
          name: `${player.SKIN} items`,
          exact: true,
        });
        await expect(list.locator("[data-replay-item-slot]")).toHaveCount(7);
        await Promise.all(
          ordinarySlots.map(async (key, index) => {
            const id = player[key];
            const item = id === 0 ? undefined : icon(id);
            const itemSlot = slot(list, index);
            await assertItem(itemSlot, item);
            if (item !== undefined)
              await assertBlob(itemSlot.locator("img"), item);
          }),
        );
      }
    },
  };
}
