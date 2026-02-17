import { RuleTester } from "@typescript-eslint/rule-tester";
import { noDtoNaming } from "./no-dto-naming";

const ruleTester = new RuleTester();

ruleTester.run("no-dto-naming", noDtoNaming, {
  valid: [
    "type RawMatch = { id: string };",
    "type RawParticipant = { name: string };",
    "const RawMatchSchema = z.object({ id: z.string() });",
    "const RawParticipantSchema = z.object({ name: z.string() });",
    "type Match = { id: string };",
    "type Participant = { name: string };",
    "const MatchSchema = z.object({ id: z.string() });",
    "type DtoHandler = { handle: () => void };",
  ],
  invalid: [
    {
      code: "type MatchDto = { id: string };",
      errors: [
        {
          messageId: "useDtoSuffix",
          data: { name: "MatchDto", suggested: "RawMatch" },
        },
      ],
    },
    {
      code: "type ParticipantDto = { name: string };",
      errors: [
        {
          messageId: "useDtoSuffix",
          data: { name: "ParticipantDto", suggested: "RawParticipant" },
        },
      ],
    },
    {
      code: "interface SummonerLeagueDto { tier: string; }",
      errors: [
        {
          messageId: "useDtoSuffix",
          data: { name: "SummonerLeagueDto", suggested: "RawSummonerLeague" },
        },
      ],
    },
    {
      code: "const MatchDtoSchema = z.object({ id: z.string() });",
      errors: [
        {
          messageId: "schemaDtoSuffix",
          data: { name: "MatchDtoSchema", suggested: "RawMatchSchema" },
        },
      ],
    },
    {
      code: "const TimelineDtoSchema = z.object({ frames: z.array(z.unknown()) });",
      errors: [
        {
          messageId: "schemaDtoSuffix",
          data: { name: "TimelineDtoSchema", suggested: "RawTimelineSchema" },
        },
      ],
    },
  ],
});
