import { combatStatRows } from "./latest-combat-stats.mjs";
// Selection is independent of camera following. Every displayed value is sampled
// at the current replay time; participant footer statistics never supply values.
export function createLatestInspection(
  report,
  state,
  resourcePresentations,
  itemAssets = null,
) {
  if (Object.hasOwn(report, "inventoryEvents") && !itemAssets)
    throw Error("Inventory inspection requires item assets");
  if (
    !(resourcePresentations instanceof Map) ||
    report.heroes.some((h) => !resourcePresentations.has(h.entityId))
  )
    throw Error("Inspection requires each champion's resource presentation");
  const ids = new Set(
    [...report.heroes, ...report.worldEntities].map((e) => e.entityId),
  );
  let selected = null;
  return {
    select(entityId) {
      if (!ids.has(entityId))
        throw Error("Cannot inspect an unadmitted replay entity");
      selected = entityId;
    },
    clear() {
      selected = null;
    },
    sample(time) {
      if (selected === null) return null;
      const value = state.sampleEntity(selected, time),
        hero = report.heroes.find((h) => h.entityId === selected);
      const resource = hero ? resourcePresentations.get(selected) : null;
      let name;
      if (hero) name = hero.champion;
      else if (value.entityClass === "turret") name = "Turret";
      else if (value.entityClass === "lane-minion") {
        const spawn = report.worldEvents.find(
          (e) =>
            e.entityId === selected &&
            e.kind === "lane-minion-creation-candidate",
        );
        name = {
          4: "Melee minion",
          5: "Caster minion",
          6: "Siege minion",
          7: "Super minion",
        }[spawn?.unitType];
        if (!name) throw Error("Unbound inspection minion type");
      } else throw Error("Unsupported inspection class");
      return {
        entityId: selected,
        entityClass: value.entityClass,
        name,
        playerName: value.playerName,
        team: value.team,
        time: value.time,
        status: !value.present ? "Not spawned" : value.dead ? "Dead" : "Alive",
        currentHealth: value.currentHealth,
        maxHealth: value.maxHealth,
        level: value.level,
        resourceValue: value.resourceValue,
        resourceMax: value.resourceMax,
        resourceDisplay: !hero
          ? "not-applicable"
          : !resource.arIsShown
            ? "hidden-by-definition"
            : value.resourceMax === null
              ? "unavailable"
              : value.resourceMax <= 0
                ? "empty-capacity"
                : "shown",
        currentGold: value.currentGold,
        experience: value.experience,
        inventoryStatus: value.inventory.status,
        inventoryItems:
          value.inventory.status === "observed"
            ? value.inventory.slots
                .filter((row) => row.slot < 7 || row.item !== null)
                .map((row) => ({
                  ...row,
                  item: row.item
                    ? {
                        ...row.item,
                        presentation: itemAssets.get(row.item.itemId),
                      }
                    : null,
                }))
            : [],
        combatStatsStatus: value.combatStats.status,
        combatStats: combatStatRows(value.combatStats.values),
        additionalCombatStats: combatStatRows(value.combatStats.values, false),
        experienceProgressStatus: "curve-unbound",
      };
    },
  };
}

// Three's raycaster includes hidden descendants. Check the complete ancestor
// chain, submaterial visibility, and membership in the admitted world.
export function pickVisibleReplayEntity(intersections, admittedIds) {
  for (const hit of intersections) {
    let object = hit.object,
      id = null,
      visible = true;
    const material = Array.isArray(object.material)
      ? object.material[hit.face?.materialIndex]
      : object.material;
    if (material?.visible === false) continue;
    while (object) {
      if (object.visible === false) visible = false;
      if (object.userData?.replayEntityId !== undefined)
        id = object.userData.replayEntityId;
      object = object.parent;
    }
    if (visible && id !== null) {
      if (!admittedIds.has(id))
        throw Error("Picking encountered an unadmitted entity");
      return id;
    }
  }
  return null;
}

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }),
  number = (value) =>
    value === null ? "Unavailable" : formatter.format(value),
  clipped = (s, n) =>
    [...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s,
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );

export function inspectionPanelDrawing(model) {
  if (
    !model ||
    !["champion", "lane-minion", "turret"].includes(model.entityClass)
  )
    throw Error("Admitted inspection model required");
  const champion = model.entityClass === "champion",
    width = 720,
    itemRows =
      model.inventoryStatus === "observed"
        ? Math.ceil(model.inventoryItems.length / 7)
        : 1,
    itemHeight = model.inventoryStatus === "observed" ? itemRows * 94 + 22 : 70,
    statsHeight = model.combatStatsStatus === "observed" ? 144 : 0,
    height = champion ? 380 + itemHeight + statsHeight : 260,
    accent =
      model.team === 100
        ? "#70b5d8"
        : model.team === 200
          ? "#e18a84"
          : "#b7bb7a",
    ops = [],
    itemRegions = [],
    rect = (x, y, w, h, color) => ops.push({ kind: "rect", x, y, w, h, color }),
    text = (value, x, y, size, color = "#dce8ed", align = "left") =>
      ops.push({ kind: "text", value, x, y, size, color, align }),
    hp =
      model.currentHealth !== null &&
      model.maxHealth !== null &&
      model.maxHealth > 0,
    hpLabel = hp
      ? `${model.status === "Dead" ? "Last observed · " : ""}${number(model.currentHealth)} / ${number(model.maxHealth)} HP`
      : "HP unavailable",
    tenths = Math.floor(model.time * 10),
    time = `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
  rect(0, 0, width, height, "#79694b");
  rect(2, 2, width - 4, height - 4, "#0b1720");
  rect(2, 2, 5, height - 4, accent);
  text(clipped(model.name, 30), 24, 43, 29);
  text(
    model.status,
    696,
    43,
    22,
    model.status === "Dead" ? "#ec9991" : "#b5c8cc",
    "right",
  );
  text(
    clipped(
      model.playerName ??
        (model.team === null
          ? "Team unavailable"
          : model.team === 100
            ? "Blue team"
            : "Red team"),
      42,
    ),
    24,
    75,
    21,
    "#aabfc8",
  );
  text(time, 696, 75, 20, "#aabfc8", "right");
  rect(24, 96, 672, 28, "#020b10");
  if (hp)
    rect(
      26,
      98,
      668 * Math.max(0, Math.min(1, model.currentHealth / model.maxHealth)),
      24,
      model.status === "Dead" ? "#53626a" : accent,
    );
  text(hpLabel, 360, 117, 20, "#f0f5f3", "center");
  if (!champion) {
    text(
      model.status === "Dead"
        ? "Recorded health observation"
        : "Health at selected replay time",
      24,
      172,
      23,
    );
    text("Additional unit stats unavailable", 24, 224, 20, "#aabfc8");
  } else {
    text(
      model.resourceDisplay === "hidden-by-definition"
        ? "Primary resource hidden"
        : model.resourceDisplay === "empty-capacity"
          ? "No primary resource"
          : `Resource  ${model.resourceValue === null || model.resourceMax === null ? "Unavailable" : `${number(model.resourceValue)} / ${number(model.resourceMax)}`}`,
      24,
      163,
      22,
      "#aabfc8",
    );
    text("Level", 24, 211, 23, "#aabfc8");
    text(number(model.level), 190, 211, 25, "#e4d3a6", "right");
    text("Gold", 264, 211, 23, "#aabfc8");
    text(number(model.currentGold), 696, 211, 25, "#e4d3a6", "right");
    text("Experience", 24, 258, 23, "#aabfc8");
    text(number(model.experience), 696, 258, 25, "#bca3dc", "right");
    rect(24, 285, 672, itemHeight, "#14232b");
    if (model.inventoryStatus === "observed") {
      for (const [i, row] of model.inventoryItems.entries()) {
        const x = 36 + (i % 7) * 94,
          y = 297 + Math.floor(i / 7) * 94;
        rect(x, y, 80, 80, "#6b654e");
        rect(x + 2, y + 2, 76, 76, "#081219");
        if (row.item) {
          const asset = row.item.presentation;
          ops.push({
            kind: "image",
            key: asset.iconSha256,
            x: x + 3,
            y: y + 3,
            w: 74,
            h: 74,
          });
          if (row.item.count > 1) {
            rect(x + 47, y + 54, 30, 23, "#081219");
            text(
              String(row.item.count),
              x + 73,
              y + 73,
              21,
              "#ffffff",
              "right",
            );
          }
          itemRegions.push({
            x,
            y,
            w: 80,
            h: 80,
            label: `${asset.name ?? `Item ${asset.id} (name unavailable)`} ×${row.item.count}`,
          });
        } else if (row.status === "unobserved")
          text("?", x + 40, y + 53, 30, "#9fb2bc", "center");
        text(String(row.slot + 1), x + 5, y + 17, 15, "#dfd3aa");
      }
    } else text("Inventory unavailable", 360, 329, 23, "#9fb2bc", "center");
    if (statsHeight) {
      for (const [i, stat] of model.combatStats.entries()) {
        const column = i % 2,
          y = 325 + itemHeight + Math.floor(i / 2) * 36;
        text(stat.label, column ? 370 : 24, y, 20, "#aabfc8");
        text(stat.formatted, column ? 696 : 342, y, 22, "#e4d3a6", "right");
      }
    }
    text(
      statsHeight
        ? "Attack speed, KDA and CS unavailable"
        : "KDA, CS and combat stats unavailable",
      24,
      325 + itemHeight + statsHeight,
      20,
      "#aabfc8",
    );
    text(
      "XP progress unavailable",
      24,
      357 + itemHeight + statsHeight,
      20,
      "#aabfc8",
    );
  }
  return {
    width,
    height,
    ops,
    itemRegions,
    description: `${model.name}${model.playerName ? `, ${model.playerName}` : ""}, ${model.status}, ${hpLabel}, ${time}${champion ? `, level ${number(model.level)}, gold ${number(model.currentGold)}, experience ${number(model.experience)}. ${model.inventoryStatus === "observed" ? itemRegions.map((r) => r.label).join(", ") : "Inventory unavailable"}. ${statsHeight ? model.combatStats.map((row) => `${row.label} ${row.formatted}`).join(", ") : "Combat stats unavailable"}.` : ""}`,
  };
}

export function paintInspectionPanel(context, drawing, images = new Map()) {
  context.clearRect(0, 0, drawing.width, drawing.height);
  for (const op of drawing.ops) {
    context.fillStyle = op.color;
    if (op.kind === "rect") context.fillRect(op.x, op.y, op.w, op.h);
    else if (op.kind === "image") {
      if (!images.has(op.key)) throw Error("Inspection item image not loaded");
      context.drawImage(images.get(op.key), op.x, op.y, op.w, op.h);
    } else {
      context.font = `${op.size >= 25 ? "bold " : ""}${op.size}px Arial`;
      context.textAlign = op.align;
      context.fillText(op.value, op.x, op.y);
    }
  }
}

export function inspectionPanelSvg(drawing, images = new Map()) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}">${drawing.ops
    .map((op) => {
      if (op.kind === "image") {
        const data = images.get(op.key);
        if (
          typeof data !== "string" ||
          !data.startsWith("data:image/png;base64,")
        )
          throw Error("Inspection SVG requires an owned PNG image");
        return `<image x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" href="${data}"/>`;
      }
      return op.kind === "rect"
        ? `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.color}"/>`
        : `<text x="${op.x}" y="${op.y}" font-family="Arial" font-size="${op.size}" font-weight="${op.size >= 25 ? "bold" : "normal"}" text-anchor="${op.align === "right" ? "end" : op.align === "center" ? "middle" : "start"}" fill="${op.color}">${esc(op.value)}</text>`;
    })
    .join("")}</svg>`;
}
