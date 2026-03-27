import { z } from "zod/v4";

export const FunctionParamSchema = z.object({
  name: z.string(),
  type: z.string(),
});

export const FunctionSignatureSchema = z.object({
  name: z.string(),
  params: z.array(FunctionParamSchema),
  returnType: z.string(),
});

export const TestCaseSchema = z.object({
  args: z.array(z.unknown()),
  expected: z.unknown(),
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
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.array(z.string()),
  description: z.string(),
  parts: z.array(QuestionPartSchema).min(1).max(4),
  constraints: z.array(z.string()),
  functionSignature: FunctionSignatureSchema,
  source: z.string(),
  escalationPattern: EscalationPatternSchema,
});

export type LeetcodeQuestion = z.infer<typeof LeetcodeQuestionSchema>;
export type QuestionPart = z.infer<typeof QuestionPartSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type Hint = z.infer<typeof HintSchema>;
export type FunctionSignature = z.infer<typeof FunctionSignatureSchema>;
export type FunctionParam = z.infer<typeof FunctionParamSchema>;
export type TransitionCriteria = z.infer<typeof TransitionCriteriaSchema>;

// System Design schemas

export const ScoringAnchorSchema = z.object({
  1: z.string(),
  2: z.string(),
  3: z.string(),
  4: z.string(),
});

export const SystemDesignCategorySchema = z.enum([
  "distributed-systems",
  "api-design",
  "data-pipeline",
  "storage",
  "real-time",
  "ml-system",
]);

export const SystemDesignDifficultySchema = z.enum([
  "junior",
  "mid",
  "senior",
  "staff",
]);

export const SystemDesignPhaseSchema = z.enum([
  "requirements",
  "estimation",
  "api-design",
  "data-model",
  "high-level",
  "deep-dive",
  "trade-offs",
]);

export const SystemDesignQuestionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  category: SystemDesignCategorySchema,
  difficulty: SystemDesignDifficultySchema,
  prompt: z.string(),
  requirements: z.object({
    functional: z.array(z.string()),
    nonFunctional: z.array(z.string()),
    scale: z.object({
      users: z.string().optional(),
      qps: z.string().optional(),
      storage: z.string().optional(),
    }),
  }),
  phases: z.object({
    requirements: z.object({
      keyQuestions: z.array(z.string()),
      timeTarget: z.number(),
    }),
    estimation: z.object({
      keyCalculations: z.array(z.string()),
      timeTarget: z.number(),
    }),
    apiDesign: z.object({
      expectedEndpoints: z.array(z.string()),
      timeTarget: z.number(),
    }),
    dataModel: z.object({
      expectedEntities: z.array(z.string()),
      timeTarget: z.number(),
    }),
    highLevel: z.object({
      expectedComponents: z.array(z.string()),
      timeTarget: z.number(),
    }),
    deepDive: z.object({
      suggestedTopics: z.array(z.string()),
      timeTarget: z.number(),
    }),
  }),
  rubric: z.object({
    requirementGathering: z.object({
      checklist: z.array(z.string()),
      anchors: ScoringAnchorSchema,
    }),
    highLevelDesign: z.object({
      checklist: z.array(z.string()),
      anchors: ScoringAnchorSchema,
    }),
    deepDive: z.object({
      checklist: z.array(z.string()),
      anchors: ScoringAnchorSchema,
    }),
    tradeoffs: z.object({
      checklist: z.array(z.string()),
      anchors: ScoringAnchorSchema,
    }),
  }),
  commonMistakes: z.array(z.string()),
  source: z.string(),
});

export type SystemDesignQuestion = z.infer<typeof SystemDesignQuestionSchema>;
export type ScoringAnchor = z.infer<typeof ScoringAnchorSchema>;
export type SystemDesignCategory = z.infer<typeof SystemDesignCategorySchema>;
export type SystemDesignDifficulty = z.infer<typeof SystemDesignDifficultySchema>;
export type SystemDesignPhase = z.infer<typeof SystemDesignPhaseSchema>;
