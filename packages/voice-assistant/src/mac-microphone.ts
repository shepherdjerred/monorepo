export type AvfoundationAudioDevice = {
  readonly index: number;
  readonly name: string;
};

export function parseAvfoundationAudioDevices(
  output: string,
): AvfoundationAudioDevice[] {
  const devices: AvfoundationAudioDevice[] = [];
  let readingAudio = false;
  for (const line of output.split(/\r?\n/u)) {
    if (line.includes("AVFoundation audio devices:")) {
      readingAudio = true;
      continue;
    }
    if (!readingAudio) continue;
    const match = /\[(\d+)\][ \t]+/u.exec(line);
    if (match === null) continue;
    const indexText = match[1];
    const name = line.slice(match.index + match[0].length).trim();
    if (indexText === undefined || name.length === 0) continue;
    devices.push({ index: Number(indexText), name });
  }
  return devices;
}

export async function listAvfoundationAudioDevices(
  ffmpegPath: string,
): Promise<AvfoundationAudioDevice[]> {
  const subprocess = Bun.spawn(
    [
      ffmpegPath,
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const output = await new Response(subprocess.stderr).text();
  await subprocess.exited;
  const devices = parseAvfoundationAudioDevices(output);
  if (devices.length === 0) {
    throw new Error(
      `FFmpeg did not report any AVFoundation audio devices:\n${output}`,
    );
  }
  return devices;
}

export function buildAvfoundationCaptureCommand(
  ffmpegPath: string,
  deviceIndex: number,
): string[] {
  return [
    ffmpegPath,
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-f",
    "avfoundation",
    "-i",
    `:${String(deviceIndex)}`,
    "-ac",
    "1",
    "-ar",
    "24000",
    "-f",
    "s16le",
    "pipe:1",
  ];
}
