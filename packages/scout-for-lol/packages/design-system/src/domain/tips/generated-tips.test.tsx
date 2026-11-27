import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ComboRef, ComboRow } from "#src/domain/tips/combo-row.tsx";
import { GeneratedTipList } from "#src/domain/tips/generated-tip-list.tsx";
import {
  ahri,
  ahriIntoZed,
  ahriMiddle,
  cassiopeiaMiddle,
  generatedFactLoader,
  generatedFiles,
  jaxJungle,
  jaxStandInComboRef,
  storySets,
  talonIntoCassiopeia,
  zedIntoAhri,
} from "#src/domain/tips/generated-tips.fixtures.ts";
import { splitTipText } from "#src/domain/tips/tip-text-segments.ts";
import { TipText } from "#src/domain/tips/tip-text.tsx";
import { GameFactProvider } from "#src/domain/tooltips/game-fact.tsx";
import type { GameFactKind } from "@scout-for-lol/data/game-facts/schema.ts";
import type { TextRef } from "@scout-for-lol/data/tips/output/champion-tips.ts";

const loader = generatedFactLoader();

function html(node: ReactNode): string {
  return renderToStaticMarkup(
    <GameFactProvider loader={loader}>{node}</GameFactProvider>,
  );
}

type Entity = { kind: GameFactKind; key: string };

/** Everything the stories can open: references, combo steps and the stand-in note's. */
function storyEntities(): Entity[] {
  const steps = storySets
    .flatMap((set) =>
      "combos" in set ? set.combos.flatMap((combo) => combo.sequence) : [],
    )
    .flatMap((step) => (step === "attack" ? [] : [step]));
  return [
    ...storySets.flatMap((set) => refsOf(set)),
    ...jaxStandInComboRef.refs,
    ...steps,
  ];
}

function refsOf(set: (typeof storySets)[number]): TextRef[] {
  return [
    ...set.tips.flatMap((tip) => tip.refs),
    ...("combos" in set
      ? set.combos.flatMap((combo) => [...combo.whenRefs, ...combo.textRefs])
      : set.comboRefs.flatMap((comboRef) => comboRef.refs)),
  ];
}

describe("the generated champion files", () => {
  test.each(generatedFiles.map((file) => [file.champion, file] as const))(
    "%s: every reference fits its text without overlap",
    (_champion, file) => {
      const sets = [...file.general, ...file.matchups];
      for (const set of sets) {
        for (const tip of set.tips) {
          expect(() => splitTipText(tip.text, tip.refs)).not.toThrow();
        }
      }
      for (const combo of file.general.flatMap((set) => set.combos)) {
        expect(() => splitTipText(combo.when, combo.whenRefs)).not.toThrow();
        expect(() => splitTipText(combo.text, combo.textRefs)).not.toThrow();
      }
    },
  );

  test("every step and reference a story shows has a generated fact, and so do its parts", async () => {
    const wanted = new Map<string, Entity>();
    for (const entity of storyEntities()) {
      wanted.set(`${entity.kind}/${entity.key}`, entity);
    }
    const signal = new AbortController().signal;
    const missing: string[] = [];
    // A tooltip layer opens the parts of its fact, so those need files too.
    const queue = [...wanted.values()];
    while (queue.length > 0) {
      const next = queue.pop();
      if (next === undefined) break;
      const fact = await loader(next.kind, next.key, { signal }).catch(() => {
        missing.push(`${next.kind}/${next.key}`);
      });
      for (const part of fact?.parts ?? []) {
        const id = `${part.kind}/${part.key}`;
        if (!wanted.has(id)) {
          wanted.set(id, part);
          queue.push(part);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("TipText", () => {
  test("renders each reference as a tooltip trigger and the rest as text", () => {
    const tip = ahriMiddle.tips[1];
    if (tip === undefined) throw new Error("Ahri has no second tip");
    const markup = html(
      createElement(TipText, { text: tip.text, refs: tip.refs }),
    );
    expect(markup.match(/scout-tip-text__ref/g)).toHaveLength(tip.refs.length);
    expect(markup).toContain(">Charm</button>");
    expect(markup).toContain("stops at the first enemy it hits");
  });

  test("only the first mention of an entity in a tip is a trigger; later ones stay in the text", () => {
    const tip = generatedFiles
      .flatMap((file) => [...file.general, ...file.matchups])
      .flatMap((set) => set.tips)
      .find(
        (candidate) =>
          new Set(candidate.refs.map((ref) => `${ref.kind}/${ref.key}`)).size <
          candidate.refs.length,
      );
    if (tip === undefined) {
      throw new Error("No generated tip names an entity twice");
    }
    const entities = new Set(tip.refs.map((ref) => `${ref.kind}/${ref.key}`));
    const markup = html(
      createElement(TipText, { text: tip.text, refs: tip.refs }),
    );
    expect(markup.match(/scout-tip-text__ref/g)).toHaveLength(entities.size);
    const plain = markup
      .replaceAll(/<[^>]+>/g, "")
      .replaceAll("&#x27;", "'")
      .replaceAll("&quot;", '"');
    expect(plain).toBe(tip.text);
  });

  test("throws on a span that does not fit, in the page and not only in dev", () => {
    expect(() =>
      html(
        createElement(TipText, {
          text: "Charm",
          refs: [{ kind: "ability", key: "Ahri-E", start: 0, end: 9 }],
        }),
      ),
    ).toThrow(/runs past/);
  });
});

describe("GeneratedTipList", () => {
  test("leaves out hidden tips", () => {
    const hidden = talonIntoCassiopeia.tips.filter(
      (tip) => tip.hidden === true,
    );
    expect(hidden).toHaveLength(1);
    const markup = html(
      createElement(GeneratedTipList, { tips: talonIntoCassiopeia.tips }),
    );
    expect(markup.match(/<li /g)).toHaveLength(
      talonIntoCassiopeia.tips.length - hidden.length,
    );
    expect(markup).not.toContain(hidden[0]?.text.slice(0, 20));
  });

  test("leads each tip with the abilities it names, once each", () => {
    const markup = html(
      createElement(GeneratedTipList, { tips: ahriMiddle.tips }),
    );
    const rows = markup.split("<li ").slice(1);
    expect(rows).toHaveLength(ahriMiddle.tips.length);
    // The third tip names Charm, Fox-Fire and Orb of Deception: two lead it.
    expect(rows[2]?.match(/scout-generated-tips__icon"/g)).toHaveLength(2);
    // The first names one ability.
    expect(rows[0]?.match(/scout-generated-tips__icon"/g)).toHaveLength(1);
  });

  test("the other side is a closed disclosure showing its first tip", () => {
    const first = zedIntoAhri.tips.find((tip) => tip.hidden !== true);
    const markup = html(
      createElement(GeneratedTipList, {
        tips: ahriIntoZed.tips,
        reverse: {
          label: "Playing Zed into Ahri",
          champion: "Zed",
          tips: zedIntoAhri.tips,
        },
      }),
    );
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("Playing Zed into Ahri");
    expect(markup).toContain(`“${first?.text ?? ""}”`);
  });

  test("a side whose tips are all hidden renders no disclosure", () => {
    const markup = html(
      createElement(GeneratedTipList, {
        tips: ahriIntoZed.tips,
        reverse: {
          label: "Playing Zed into Ahri",
          champion: "Zed",
          tips: zedIntoAhri.tips.map((tip) => ({
            ...tip,
            hidden: true as const,
          })),
        },
      }),
    );
    expect(markup).not.toContain("<details");
  });

  test("the story files hold what the stories assume", () => {
    expect(ahri.champion).toBe("Ahri");
    expect(ahriMiddle.combos).toEqual([]);
  });
});

describe("ComboRow and ComboRef", () => {
  test("shows the name, category, every step, the when line and the text", () => {
    const combo = jaxJungle.combos[1];
    if (combo === undefined) throw new Error("Jax has no second combo");
    const markup = html(createElement(ComboRow, { combo }));
    expect(markup).toContain(combo.name);
    expect(markup).toContain("scout-badge");
    expect(markup.match(/scout-combo-step[ "]/g)).toHaveLength(
      combo.sequence.length,
    );
    expect(markup.match(/scout-combo-sequence__chevron/g)).toHaveLength(
      combo.sequence.length - 1,
    );
    expect(markup).toContain("scout-combo-row__when");
    expect(markup).toContain("scout-combo-row__text");
  });

  test("a basic attack and a summoner spell are steps", () => {
    const withAttack = jaxJungle.combos.find((combo) =>
      combo.sequence.includes("attack"),
    );
    const withSpell = cassiopeiaMiddle.combos.find((combo) =>
      combo.sequence.some(
        (step) => step !== "attack" && step.kind === "summoner-spell",
      ),
    );
    if (withAttack === undefined || withSpell === undefined) {
      throw new Error("The fixtures lack an attack step or a spell step");
    }
    expect(html(createElement(ComboRow, { combo: withAttack }))).toContain(
      'aria-label="Basic attack"',
    );
    // The spell's icon and name arrive with its fact, so the first render has
    // the placeholder name.
    expect(html(createElement(ComboRow, { combo: withSpell }))).toContain(
      "Summoner spell 2202",
    );
  });

  test("a combo reference shows the combo's name and the side's note", () => {
    const markup = html(
      createElement(ComboRef, {
        comboRef: jaxStandInComboRef,
        combos: jaxJungle.combos,
      }),
    );
    expect(markup).toContain("Dodge then stun");
    expect(markup).toContain("scout-combo-ref__note");
    expect(markup).toContain(">Counter Strike</button>");
  });

  test("a reference to a combo that is not there throws", () => {
    expect(() =>
      html(
        createElement(ComboRef, {
          comboRef: { ...jaxStandInComboRef, comboId: "top:Jax:combo:9" },
          combos: jaxJungle.combos,
        }),
      ),
    ).toThrow(/is not in the champion's combos/);
  });
});
