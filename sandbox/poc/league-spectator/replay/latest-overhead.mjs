// Initial League-style geometry over observed values. Exact-build HUD textures,
// fonts, resource styling, shields and zoom/occlusion remain separate work.
export function championPlateDrawing(
  name,
  team,
  state,
  resourcePresentation = null,
) {
  if (typeof name !== "string" || ![100, 200].includes(team))
    throw Error("Invalid champion plate identity");
  const available =
      state.currentHealth !== null &&
      state.maxHealth !== null &&
      state.maxHealth > 0,
    fraction = available
      ? Math.max(0, Math.min(1, state.currentHealth / state.maxHealth))
      : 0,
    color = team === 100 ? "#5eadd4" : "#db5e62",
    ops = [],
    rect = (x, y, w, h, color) => ops.push({ kind: "rect", x, y, w, h, color }),
    text = (value, x, y, size, color) =>
      ops.push({ kind: "text", value, x, y, size, color });
  text(name, 128, 23, 21, "#eeeeea");
  rect(17, 34, 238, 29, "#070b0c");
  rect(18, 35, 236, 27, "#635d48");
  rect(20, 37, 232, 23, "#152d36");
  rect(22, 39, 29, 19, "#14222b");
  text(state.level === null ? "—" : String(state.level), 36, 55, 17, "#d8e9ed");
  rect(54, 39, 196, 19, "#081319");
  if (available) {
    rect(55, 40, 194 * fraction, 17, color);
    rect(55, 40, 194 * fraction, 3, team === 100 ? "#a1d8ef" : "#f3a4a1");
    const ticks = Math.min(128, Math.ceil(state.maxHealth / 100));
    for (let i = 1; i < ticks; i++) {
      const x = 55 + (194 * i * 100) / state.maxHealth;
      if (x >= 249) break;
      rect(x, 40, 1, i % 10 === 0 ? 17 : 8, "#10232b");
    }
  } else text("HP unavailable", 151, 54, 13, "#9bacb2");
  let resourceStatus = "not-bound";
  if (resourcePresentation) {
    if (!resourcePresentation.arIsShown)
      resourceStatus = "hidden-by-definition";
    else if (state.resourceValue === null || state.resourceMax === null)
      resourceStatus = "unavailable";
    else if (state.resourceMax <= 0) resourceStatus = "empty-capacity";
    else if (resourcePresentation.arDisplayAsPips)
      resourceStatus = "pips-unimplemented";
    else {
      const fraction = Math.max(
        0,
        Math.min(1, state.resourceValue / state.resourceMax),
      );
      rect(53, 62, 198, 11, "#070b0c");
      rect(55, 64, 194, 7, "#11212d");
      rect(
        55,
        64,
        194 * fraction,
        7,
        resourcePresentation.arType === 0 ? "#5799ca" : "#b65160",
      );
      const increment = resourcePresentation.arIncrements;
      if (increment > 0) {
        let segments = Math.ceil(state.resourceMax / increment);
        if (resourcePresentation.arMaxSegments > 0)
          segments = Math.min(segments, resourcePresentation.arMaxSegments);
        if (segments > 128)
          throw Error("Resource segment count exceeds admitted presentation");
        for (let i = 1; i < segments; i++)
          rect(
            55 + (194 * i * increment) / state.resourceMax,
            64,
            1,
            7,
            "#16232c",
          );
      }
      resourceStatus = "continuous-preview";
    }
  }
  return {
    width: 256,
    height: 80,
    visible: !state.dead,
    available,
    resourceStatus,
    ops,
  };
}

// Dimensions/palette are preview geometry. HP and lifetime come from sampled
// class-specific state. Unknown minion allegiance stays neutral until recovered.
export function unitPlateDrawing(state) {
  if (!["lane-minion", "turret"].includes(state.entityClass))
    throw Error("Unsupported unit overhead class");
  const tower = state.entityClass === "turret",
    width = tower ? 256 : 128,
    height = tower ? 28 : 16,
    border = tower ? 4 : 3,
    available =
      state.currentHealth !== null &&
      state.maxHealth !== null &&
      state.maxHealth > 0,
    fraction = available
      ? Math.max(0, Math.min(1, state.currentHealth / state.maxHealth))
      : 0,
    color =
      state.team === 100
        ? "#5eadd4"
        : state.team === 200
          ? "#db5e62"
          : "#b7bb7a",
    innerWidth = width - border * 2,
    innerHeight = height - border * 2,
    ops = [
      { kind: "rect", x: 0, y: 0, w: width, h: height, color: "#080c0e" },
      {
        kind: "rect",
        x: 1,
        y: 1,
        w: width - 2,
        h: height - 2,
        color: "#595b4d",
      },
      {
        kind: "rect",
        x: border,
        y: border,
        w: innerWidth,
        h: innerHeight,
        color: "#14252b",
      },
    ];
  if (available) {
    ops.push({
      kind: "rect",
      x: border,
      y: border,
      w: innerWidth * fraction,
      h: innerHeight,
      color,
    });
    ops.push({
      kind: "rect",
      x: border,
      y: border,
      w: innerWidth * fraction,
      h: 2,
      color: "#d5e1d2",
    });
  }
  return {
    width,
    height,
    visible:
      state.present && !state.dead && available && state.currentHealth > 0,
    available,
    allegianceStatus:
      state.team === null ? "unresolved-neutral-palette" : "recorded-team",
    ops,
  };
}

export function paintChampionPlate(context, drawing) {
  context.clearRect(0, 0, drawing.width, drawing.height);
  if (!drawing.visible) return;
  for (const op of drawing.ops) {
    context.fillStyle = op.color;
    if (op.kind === "rect") context.fillRect(op.x, op.y, op.w, op.h);
    else {
      context.font = `bold ${op.size}px Arial`;
      context.textAlign = "center";
      context.strokeStyle = "#071014";
      context.lineWidth = 3;
      context.strokeText(op.value, op.x, op.y);
      context.fillText(op.value, op.x, op.y);
    }
  }
}

export function championPlateSvg(drawing) {
  const esc = (s) =>
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}">${
    !drawing.visible
      ? ""
      : drawing.ops
          .map((op) =>
            op.kind === "rect"
              ? `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.color}"/>`
              : `<text x="${op.x}" y="${op.y}" font-family="Arial" font-weight="bold" font-size="${op.size}" text-anchor="middle" fill="${op.color}" stroke="#071014" stroke-width="3" paint-order="stroke">${esc(op.value)}</text>`,
          )
          .join("")
  }</svg>`;
}
