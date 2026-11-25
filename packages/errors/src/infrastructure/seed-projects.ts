export type CanonicalProjectSeed = {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly publicKey: string;
};

function joinPublicKey(left16: string, right16: string): string {
  return `${left16}${right16}`;
}

/**
 * Canonical homelab error-tracking projects.
 * DSN public keys are non-secret client identifiers compiled into shipped web,
 * desktop, and server bundles so SDKs can route envelopes to the project ID.
 */
export const CANONICAL_PROJECTS: readonly CanonicalProjectSeed[] = [
  {
    id: 1,
    slug: "scout-for-lol",
    name: "Scout for LoL",
    publicKey: joinPublicKey("337945d2208840dc", "a4a573be311a1bbb"),
  },
  {
    id: 2,
    slug: "sjerred",
    name: "sjer.red",
    publicKey: joinPublicKey("41fb03e17fb24ceb", "98a910ad7dea3572"),
  },
  {
    id: 3,
    slug: "better-skill-capped",
    name: "Better Skill Capped",
    publicKey: joinPublicKey("34fcb766ca0f4949", "9b001635c5cc5cb2"),
  },
  {
    id: 4,
    slug: "home-assistant-workflows",
    name: "Home Assistant Workflows",
    publicKey: joinPublicKey("c4fa494451574b98", "bf475744e38f0610"),
  },
  {
    id: 5,
    slug: "starlight",
    name: "Starlight",
    publicKey: joinPublicKey("fb2f07bfb3544bd2", "bd279a1ce5f1e247"),
  },
  {
    id: 6,
    slug: "clauderon",
    name: "Clauderon",
    publicKey: joinPublicKey("5c677804366f491d", "82c272e36edbbdce"),
  },
  {
    id: 7,
    slug: "birmel",
    name: "Birmel",
    publicKey: joinPublicKey("4fec575b459a4afe", "9b1230d29313a64c"),
  },
  {
    id: 9,
    slug: "sentinel",
    name: "Sentinel",
    publicKey: joinPublicKey("ad8122c27ca941c0", "bc03553b3d1d741f"),
  },
  {
    id: 10,
    slug: "tasknotes-app",
    name: "TaskNotes App",
    publicKey: joinPublicKey("af299d1967744476", "b01584b14d811556"),
  },
  {
    id: 11,
    slug: "tasknotes-api",
    name: "TaskNotes API",
    publicKey: joinPublicKey("9dd9e0f13aaa4483", "9c4797d358478bf7"),
  },
  {
    id: 12,
    slug: "temporal",
    name: "Temporal",
    publicKey: joinPublicKey("5631d27e8c23446c", "b988ff1c653fdb1c"),
  },
  {
    id: 14,
    slug: "streambot",
    name: "Streambot",
    publicKey: joinPublicKey("1b31570e20774ac4", "99e67c3673490591"),
  },
  {
    id: 15,
    slug: "trmnl-dashboard",
    name: "TRMNL Dashboard",
    publicKey: joinPublicKey("1bd138ebe13640f1", "ae8a4df3b86eca79"),
  },
  {
    id: 16,
    slug: "glitter-boys-launcher",
    name: "Glitter Boys launcher",
    publicKey: joinPublicKey("a1a635c3208a45a3", "bd8c431543a31223"),
  },
  {
    id: 17,
    slug: "scout-desktop-client",
    name: "Scout desktop client",
    publicKey: joinPublicKey("b8bedd02e8cf4166", "92a4b550ab76bfc1"),
  },
];
