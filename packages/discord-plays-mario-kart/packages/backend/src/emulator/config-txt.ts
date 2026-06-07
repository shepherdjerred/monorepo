// Positional config.txt for the N64Wasm core (see N64Wasm script.js
// writeConfig): 15 gamepad + 19 keyboard mappings (0 = unmapped — we inject
// input programmatically), 3 save flags, then feature flags. The two that
// matter for the headless host: disableAudioSync=0 (so main() returns after
// init and we drive _runMainLoop ourselves) and forceAngry=1 (software RDP).
export function buildConfigTxt({ angrylion }: { angrylion: boolean }): string {
  const lines: string[] = [];
  for (let i = 0; i < 15 + 19; i++) lines.push("0"); // input mappings (unmapped)
  lines.push("0", "0", "0"); // eep / sra / fla present
  lines.push("0"); // showFPS
  lines.push("0"); // swapSticks
  lines.push("0"); // disableAudioSync = 0 -> manual _runMainLoop stepping
  lines.push("0", "0", "0"); // invert 2P/3P/4P
  lines.push("0"); // mobile mode
  lines.push(angrylion ? "1" : "0"); // angrylion software renderer
  lines.push("0"); // mouse mode
  lines.push("0"); // use vbo
  lines.push("0"); // rice plugin
  return lines.join("\r\n") + "\r\n";
}
