export function openReplay(buffer: ArrayBuffer): {
  build: string;
  protocol: string;
  durationMilliseconds: number;
  roster: { champion: string; team: number }[];
};
