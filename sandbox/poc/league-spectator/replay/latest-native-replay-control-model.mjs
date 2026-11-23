// Original finite control outputs, driven by browser-owned input and SDK state.
// This boundary does not claim the original UI event services are initialized.
export function createNativeReplayControlModel(manifest, supportedRates) {
  if (
    manifest?.schema !== 1 ||
    manifest.kind !== "original-native-replay-controls-bridge" ||
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e" ||
    manifest.imageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
    manifest.rates?.length !== 6 ||
    manifest.buttons?.length !== 4 ||
    !Array.isArray(supportedRates) ||
    supportedRates.length === 0 ||
    new Set(supportedRates).size !== supportedRates.length
  )
    throw Error(
      "Closed original replay-control outputs and SDK rates required",
    );
  const rates = structuredClone(manifest.rates),
    buttons = structuredClone(manifest.buttons),
    actions = ["SkipBack", "Play", "SpeedDown", "SpeedUp"];
  for (const [index, rate] of rates.entries())
    if (
      rate.index !== index ||
      !Number.isFinite(rate.value) ||
      rate.value <= 0 ||
      typeof rate.label !== "string" ||
      rate.increase !== Math.min(5, index + 1) ||
      rate.decrease !== Math.max(0, index - 1)
    )
      throw Error("Original six-rate control table is incomplete");
  if (supportedRates.some((value) => !rates.some((row) => row.value === value)))
    throw Error("SDK rate is absent from the original control outputs");
  for (const [index, button] of buttons.entries()) {
    if (
      button.action !== actions[index] ||
      Object.keys(button.states).length !== 32
    )
      throw Error("Original four-action state table is incomplete");
    for (let input = 0; input < 32; input++) {
      const row = button.states[input.toString(2).padStart(5, "0")];
      if (
        !row ||
        !Number.isInteger(row.slot) ||
        row.slot < 0 ||
        row.slot > 7 ||
        !Array.isArray(row.visibleIds)
      )
        throw Error("Original button input has no native state output");
    }
  }
  function state(value) {
    if (
      typeof value?.playing !== "boolean" ||
      !Number.isFinite(value.timeSeconds) ||
      !Number.isFinite(value.durationSeconds) ||
      value.timeSeconds < 0 ||
      value.durationSeconds <= 0 ||
      value.timeSeconds > value.durationSeconds ||
      !supportedRates.includes(value.rate)
    )
      throw Error("Actual admitted replay-session state required");
    return rates.find((row) => row.value === value.rate);
  }
  return Object.freeze({
    buttons,
    snapshot(value, inputByAction = {}) {
      const current = state(value);
      return {
        rateLabel: current.label,
        buttons: buttons.map((button) => {
          const input = inputByAction[button.action] ?? {
            pressed: false,
            hovered: false,
          };
          if (
            typeof input.pressed !== "boolean" ||
            typeof input.hovered !== "boolean"
          )
            throw Error("Explicit browser button input required");
          // Enabled and the extra interaction byte retain original constructor
          // defaults1/0. Keyboard focus is independently exposed by CSS/HTML;
          // it is not relabeled as an unproved native input-provider byte.
          const selected = button.action === "Play" && value.playing,
            key = `${Number(input.pressed)}1${Number(input.hovered)}0${Number(selected)}`,
            target =
              button.action === "SpeedUp"
                ? rates[current.increase]
                : button.action === "SpeedDown"
                  ? rates[current.decrease]
                  : null;
          return {
            action: button.action,
            label:
              button.action === "Play"
                ? value.playing
                  ? "Pause"
                  : "Play"
                : button.action === "SkipBack"
                  ? "Back 15 seconds"
                  : button.action === "SpeedUp"
                    ? "Increase speed"
                    : "Decrease speed",
            selected,
            disabled: target !== null && !supportedRates.includes(target.value),
            ...button.states[key],
          };
        }),
      };
    },
    execute(action, session) {
      const value = session.getState(),
        current = state(value);
      if (action === "Play") {
        if (value.playing) session.pause();
        else session.play();
      } else if (action === "SkipBack") {
        return session.seek(
          nativeReplayJumpBack(value.timeSeconds, 0, value.durationSeconds),
        );
      } else if (action === "SpeedUp" || action === "SpeedDown") {
        const target =
          rates[action === "SpeedUp" ? current.increase : current.decrease];
        if (
          supportedRates.includes(target.value) &&
          target.value !== current.value
        )
          session.setRate(target.value);
      } else throw Error("Unadmitted native replay action");
    },
  });
}

export function nativeReplayJumpBack(clock, lower, upper) {
  if (
    ![clock, lower, upper].every(Number.isFinite) ||
    lower < 0 ||
    upper < lower
  )
    throw Error("Finite original clock/reader bounds required");
  return Math.min(
    Math.fround(upper),
    Math.max(Math.fround(lower), Math.fround(Math.fround(clock) - 15)),
  );
}

export function nativeReplayButtonRectangles(buttons, viewport) {
  const rectangles = new Map();
  for (const button of buttons) {
    const rows = button.rectangles.filter(
      (row) =>
        row.viewport[0] === viewport[0] && row.viewport[1] === viewport[1],
    );
    if (
      rows.length !== 1 ||
      rows[0].rect.length !== 4 ||
      !rows[0].rect.every(Number.isFinite)
    )
      throw Error("Original replay button hit region is unresolved");
    const original = rows[0].rect.map(
        (value, index) => value * viewport[index % 2],
      ),
      width = original[2] - original[0],
      height = original[3] - original[1];
    if (width <= 0 || height <= 0)
      throw Error("Nonpositive original replay button hit region");
    // Browser accessibility expansion about the authored hit-region center is
    // explicit. It is not labeled as original native hit-testing geometry.
    const x = Math.max(0, (24 - width) / 2),
      y = Math.max(0, (24 - height) / 2);
    rectangles.set(button.action, [
      original[0] - x,
      original[1] - y,
      original[2] + x,
      original[3] + y,
    ]);
  }
  const rows = [...rectangles.values()];
  for (let a = 0; a < rows.length; a++)
    for (let b = a + 1; b < rows.length; b++)
      if (
        Math.min(rows[a][2], rows[b][2]) > Math.max(rows[a][0], rows[b][0]) &&
        Math.min(rows[a][3], rows[b][3]) > Math.max(rows[a][1], rows[b][1])
      )
        throw Error("Expanded browser replay-control hit targets overlap");
  return rectangles;
}
