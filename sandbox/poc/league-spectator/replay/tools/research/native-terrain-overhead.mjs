export function projectChampionTop(position, topY, matrix, width, height) {
  const [x, groundY, z] = position;
  const y = groundY + topY;
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!(
    clipW > 0 &&
    Math.abs(clipX) <= clipW &&
    Math.abs(clipY) <= clipW &&
    Math.abs(clipZ) <= clipW
  ))
    return undefined;
  return [
    ((clipX / clipW + 1) * width) / 2,
    ((clipY / clipW + 1) * height) / 2,
  ];
}

export function createChampionOverhead(canvas) {
  const document = canvas.ownerDocument;
  const overlay = document.createElement("div");
  overlay.dataset.scoutChampionOverhead = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;isolation:isolate";
  canvas.after(overlay);
  const rows = new Map();

  function draw(frame, sample, models, matrix, width, height, ratio) {
    const visible = new Set();
    if (sample !== undefined) {
      for (const { participantId, position } of frame.markers) {
        const model = models.get(participantId);
        if (model === undefined) continue;
        const data = sample(participantId, frame.timeSeconds);
        if (data === undefined) continue;
        const point = projectChampionTop(
          position,
          model.topY,
          matrix,
          width,
          height,
        );
        if (point === undefined) continue;
        const x = point[0] / ratio;
        const y = (height - point[1]) / ratio;
        if (x < 32 || x > width / ratio - 32 || y < 40) continue;

        visible.add(participantId);
        let row = rows.get(participantId);
        if (row === undefined) {
          const label = document.createElement("div");
          label.dataset.participantId = String(participantId);
          label.style.cssText =
            "position:absolute;top:0;left:0;white-space:nowrap;text-align:center;font:600 11px/15px system-ui;color:#f4f7fa;text-shadow:0 1px 3px #101820";
          // Visibility changes recreate rows, so use a stable paint order.
          label.style.zIndex = String(participantId);
          const name = document.createElement("span");
          name.dataset.scoutChampionName = "";
          const level = document.createElement("span");
          level.dataset.scoutChampionLevel = "";
          level.style.cssText =
            "margin-left:4px;padding:0 3px;border-radius:3px;background:#172834;color:#e1eff9";
          const resource = document.createElement("progress");
          resource.dataset.scoutChampionResource = "";
          resource.style.cssText =
            "display:block;width:54px;height:4px;margin:2px auto 0;color-scheme:dark";
          label.append(name, level, resource);
          overlay.append(label);
          row = { label, name, level, resource };
          rows.set(participantId, row);
        }
        const { label, name, level, resource } = row;
        if (name.textContent !== data.name) name.textContent = data.name;
        const levelText = data.level === undefined ? "" : String(data.level);
        if (level.textContent !== levelText) level.textContent = levelText;
        const hideLevel = data.level === undefined;
        if (level.hidden !== hideLevel) level.hidden = hideLevel;
        const gauge = data.resource;
        const hasResource = gauge !== undefined && gauge.max > 0;
        const resourceDisplay = hasResource ? "block" : "none";
        if (resource.style.display !== resourceDisplay)
          resource.style.display = resourceDisplay;
        if (hasResource) {
          if (!resource.hasAttribute("max") || resource.max !== gauge.max)
            resource.max = gauge.max;
          if (
            !resource.hasAttribute("value") ||
            resource.value !== gauge.current
          )
            resource.value = gauge.current;
        }
        const transform = `translate(${x}px, ${y - 12}px) translate(-50%, -100%)`;
        if (row.transform !== transform) {
          label.style.transform = transform;
          row.transform = transform;
        }
      }
    }
    for (const [participantId, { label }] of rows) {
      if (visible.has(participantId)) continue;
      label.remove();
      rows.delete(participantId);
    }
  }

  return { draw, dispose: () => overlay.remove() };
}
