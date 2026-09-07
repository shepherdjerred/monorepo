import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      // Deliberate layer violations, rejected by `check-architecture` rather
      // than linted. This list overrides the shared config's defaults, which
      // already exclude them.
      "**/architecture-fixtures/**/*",
      "**/generated/**/*",
      "**/dist/**/*",
      "**/build/**/*",
      "**/.cache/**/*",
      "**/node_modules/**/*",
      "**/*.md",
      "**/*.mdx",
      "**/*.mjs",
      "**/*.js",
      "**/*.cjs",
    ],
  }),
  { rules: { "no-console": "off" } },
  {
    // Single-writer rule for the userbot's outbound voice track.
    //
    // `WebRtcConnWrapper.sendAudioFrame` is one packetizer, one SSRC and one RTP timestamp
    // sequence. Two writers on it do not mix — they interleave two Opus streams into noise — and
    // the failure is silent, because both writers succeed. `StreamerLike.openAssistantAudio` makes
    // a second writer hard to reach; this makes it impossible to land one without noticing.
    //
    // This is an eslint rule rather than an `architecture.config.ts` boundary because
    // `@shepherdjerred/architecture` is dependency-cruiser-based and reasons about *imports*: it
    // can say "layer A may not depend on layer B", not "this identifier may only be referenced
    // here". Its fixture harness also refuses any file under `architecture-fixtures/` that does not
    // match a declared boundary's prefix, so the negative fixture could not live there either.
    files: ["src/**/*.ts"],
    ignores: ["src/streamer/voice-audio-mixer.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Calling it, or passing it along.
          selector: "MemberExpression[property.name='sendAudioFrame']",
          message:
            "Only voice-audio-mixer.ts may send audio frames — a second writer on the voice connection's single RTP timestamp interleaves two Opus streams into garbage. Route audio through the mixer's ports.",
        },
        {
          // Declaring the surface, which is how a second writer starts: an object satisfying
          // `AudioFrameSink` handed to something other than the mixer.
          selector: "Property[key.name='sendAudioFrame']",
          message:
            "Only voice-audio-mixer.ts may implement an audio frame sink — anything else handed to `playStream`'s audioSink becomes a second writer on the voice connection. Route audio through the mixer's ports.",
        },
        {
          selector: "MethodDefinition[key.name='sendAudioFrame']",
          message:
            "Only voice-audio-mixer.ts may implement an audio frame sink — anything else handed to `playStream`'s audioSink becomes a second writer on the voice connection. Route audio through the mixer's ports.",
        },
      ],
    },
  },
];

export default config;
