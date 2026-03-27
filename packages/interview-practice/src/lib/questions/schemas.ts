import { z } from "zod/v4";

export const IOSchema = z.object({
  inputFormat: z.string(),
  outputFormat: z.string(),
  parseHint: z.string().optional(),
});

export const TestCaseSchema = z.object({
  input: z.string(),
  expected: z.string(),
  explanation: z.string().optional(),
});

export const HintSchema = z.object({
  level: z.enum(["subtle", "moderate", "explicit"]),
  content: z.string(),
});

export const TransitionCriteriaSchema = z.object({
  minApproachQuality: z.enum(["working", "optimal", "explained"]),
  mustExplainComplexity: z.boolean(),
  transitionPrompt: z.string(),
});

export const QuestionPartSchema = z.object({
  partNumber: z.number().int().min(1),
  prompt: z.string(),
  internalNotes: z.string(),
  hints: z.array(HintSchema),
  testCases: z.array(TestCaseSchema),
  followUps: z.array(z.string()),
  expectedApproach: z.string(),
  expectedComplexity: z.object({
    time: z.string(),
    space: z.string(),
  }),
  transitionCriteria: TransitionCriteriaSchema.optional(),
});

export const EscalationPatternSchema = z.enum([
  "constraint-addition",
  "static-to-dynamic",
  "existence-to-enumeration",
  "single-to-distributed",
  "concrete-to-symbolic",
  "specific-to-general",
]);

export const LeetcodeQuestionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.array(z.string()),
  description: z.string(),
  parts: z.array(QuestionPartSchema).min(1).max(4),
  constraints: z.array(z.string()),
  io: IOSchema,
  source: z.string(),
  escalationPattern: EscalationPatternSchema,
});

export type LeetcodeQuestion = z.infer<typeof LeetcodeQuestionSchema>;
export type QuestionPart = z.infer<typeof QuestionPartSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type Hint = z.infer<typeof HintSchema>;
export type IOSpec = z.infer<typeof IOSchema>;
export type TransitionCriteria = z.infer<typeof TransitionCriteriaSchema>;
