import type { Content } from "#src/model/content";
import { ManifestSchema } from "#src/parser/manifest";
import { parseManifest } from "#src/parser/parser";

/**
 * A hand-built, schema-validated corpus sized for ranking assertions:
 * distinct docs match "wave control" via title, child video titles, and
 * description only; champions cover the apostrophe cases; coaches have a
 * known distribution.
 */

type RawVideo = {
  role: string;
  title: string;
  desc: string;
  rDate: number;
  durSec: number;
  uuid: string;
  tId: number;
  tSS: string;
  cSS: string;
};

function makeVideo(options: {
  uuid: string;
  title: string;
  role: string;
  desc?: string;
  rDate?: number;
  durSec?: number;
}): RawVideo {
  return {
    role: options.role,
    title: options.title,
    desc: options.desc ?? "",
    rDate: options.rDate ?? 1_700_000_000_000,
    durSec: options.durSec ?? 400,
    uuid: options.uuid,
    tId: 1,
    tSS: "",
    cSS: "",
  };
}

function makeCommentary(options: {
  uuid: string;
  role: string;
  staff: string;
  yourChampion: string;
  theirChampion: string;
  rDate?: number;
  durSec?: number;
  carry?: string;
  type?: string;
}): Record<string, unknown> {
  return {
    role: options.role,
    rDate: options.rDate ?? 1_690_000_000_000,
    durSec: options.durSec ?? 900,
    uuid: options.uuid,
    tId: 2,
    tSS: "",
    staff: options.staff,
    matchLink: "https://www.leagueofgraphs.com/match/na/1",
    yourChampion: options.yourChampion,
    theirChampion: options.theirChampion,
    k: 5,
    d: 2,
    a: 7,
    gameTime: "25m30s",
    carry: options.carry ?? "Light",
    type: options.type ?? "Smurf",
    rune1: "",
    rune2: "",
    rune3: "",
    item1: "",
    item2: "",
    item3: "",
  };
}

function makeCourse(options: {
  uuid: string;
  title: string;
  role: string;
  rDate?: number;
  tags?: string[];
  recommended?: boolean;
}): Record<string, unknown> {
  return {
    title: options.title,
    uuid: options.uuid,
    desc: "",
    rDate: options.rDate ?? 1_710_000_000_000,
    role: options.role,
    courseImage: "https://example.com/a.png",
    courseImage2: "https://example.com/b.png",
    courseImage3: "https://example.com/c.png",
    tags: options.tags ?? [],
    recommended: options.recommended ?? false,
    override: false,
    overlay: "none",
  };
}

const RAW_MANIFEST = {
  timeStamp: 1_720_000_000_000,
  patch: {
    patchVal: "26.16",
    releaseDate: 1_710_000_000_000,
    patchUrl: "https://example.com/patch",
  },
  config: { game: "lol", tcoaching: "true", "": "" },
  videos: [
    makeVideo({
      uuid: "v-intro",
      title: "Intro To Botlane",
      role: "support",
      rDate: 1_712_000_000_000,
      durSec: 300,
    }),
    makeVideo({
      uuid: "v-trading",
      title: "Trading Stance",
      role: "support",
      rDate: 1_711_000_000_000,
      durSec: 350,
    }),
    makeVideo({
      uuid: "v-wave-fund",
      title: "Wave Control Fundamentals",
      role: "mid",
      rDate: 1_713_000_000_000,
      durSec: 500,
    }),
    makeVideo({
      uuid: "v-laning",
      title: "Laning Basics",
      role: "top",
      desc: "Everything about wave control and tempo for beginners.",
      rDate: 1_714_000_000_000,
      durSec: 800,
    }),
  ],
  commentaries: [
    makeCommentary({
      uuid: "c-kaisa",
      role: "adc",
      staff: "Sjorry",
      yourChampion: "Kai'Sa",
      theirChampion: "Fizz",
      rDate: 1_715_000_000_000,
      durSec: 1200,
      carry: "Heavy",
      type: "High Elo",
    }),
    makeCommentary({
      uuid: "c-ksante",
      role: "top",
      staff: "Hector",
      yourChampion: "K'Sante",
      theirChampion: "Garen",
      rDate: 1_716_000_000_000,
      durSec: 1100,
    }),
    makeCommentary({
      uuid: "c-graves",
      role: "jungle",
      staff: "Sjorry",
      yourChampion: "Graves",
      theirChampion: "Lee Sin",
      rDate: 1_717_000_000_000,
      durSec: 1000,
      carry: "Medium",
    }),
    makeCommentary({
      uuid: "c-lux",
      role: "support",
      staff: "Sam the Man",
      yourChampion: "Lux",
      theirChampion: "Ahri",
      rDate: 1_718_000_000_000,
      durSec: 950,
      type: "Earpiece",
    }),
  ],
  staff: [
    {
      name: "Sjorry",
      summonerName: "Sjorry",
      profileImage: "https://example.com/s.svg",
      profileImageWithRank: "https://example.com/s.png",
      playerPeakRank: 5,
    },
  ],
  courses: [
    makeCourse({
      uuid: "crs-wave",
      title: "Wave Control {support}",
      role: "support",
      rDate: 1_719_000_000_000,
      tags: ["Support", "Support - Wave Control"],
      recommended: true,
    }),
    makeCourse({
      uuid: "crs-macro",
      title: "Macro Mastery {mid}",
      role: "mid",
      rDate: 1_709_000_000_000,
    }),
    makeCourse({
      uuid: "crs-laning",
      title: "Laning 101 {top}",
      role: "top",
      rDate: 1_708_000_000_000,
    }),
  ],
  thisWeekData: [],
  carousel: [],
  tagInfo: [],
  videosToCourses: {
    "Wave Control {support}": {
      chapters: [
        {
          title: "Course Content",
          vids: [{ uuid: "v-intro" }, { uuid: "v-trading" }],
        },
      ],
    },
    "Macro Mastery {mid}": {
      chapters: [
        {
          title: "Course Content",
          vids: [{ uuid: "v-wave-fund" }],
        },
      ],
    },
    "Laning 101 {top}": {
      chapters: [
        {
          title: "Course Content",
          vids: [{ uuid: "v-laning" }],
        },
      ],
    },
  },
};

export function searchFixtureContent(): Content {
  return parseManifest(ManifestSchema.parse(RAW_MANIFEST));
}
