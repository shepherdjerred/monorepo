export type PatternMatch = {
  category: string;
  pattern: string;
  tier: 1 | 2 | 3;
};

export type SentimentResult = {
  score: number;
  matches: PatternMatch[];
};

type SentimentRule = {
  pattern: RegExp;
  category: string;
  tier: 1 | 2 | 3;
};

const TIER_WEIGHTS: Record<1 | 2 | 3, number> = {
  1: 0.4,
  2: 0.25,
  3: 0.15,
};

const RULES: SentimentRule[] = [
  // ── Tier 1: High-confidence dismissals ──
  // Reductive labels
  {
    pattern: /\b(stochastic parrot)s?\b/i,
    category: "reductive-label",
    tier: 1,
  },
  {
    pattern: /\b(glorified|spicy|fancy|luxury)\s+autocomplete\b/i,
    category: "reductive-label",
    tier: 1,
  },
  {
    pattern: /\bjust\s+(a\s+)?(next[- ]token|word)\s+predict(or|ion)\b/i,
    category: "reductive-label",
    tier: 1,
  },
  {
    pattern: /\bblurry\s+jpe?g\s+of\s+the\s+(web|internet)\b/i,
    category: "reductive-label",
    tier: 1,
  },
  { pattern: /\bELIZA\s+with\b/i, category: "reductive-label", tier: 1 },
  {
    pattern: /\bMarkov\s+chain\s+with\b/i,
    category: "reductive-label",
    tier: 1,
  },
  { pattern: /\bChinese\s+Room\b/i, category: "reductive-label", tier: 1 },

  // Slop vocabulary
  { pattern: /\bAI\s+slop\b/i, category: "slop", tier: 1 },
  {
    pattern: /\b(LLM|AI|GPT|Claude)\s+(garbage|trash|crap|bullshit)\b/i,
    category: "slop",
    tier: 1,
  },
  { pattern: /\bslop\s+(generator|era|garbage)\b/i, category: "slop", tier: 1 },
  { pattern: /\bslopaganda\b/i, category: "slop", tier: 1 },

  // Snake oil / grift
  {
    pattern: /\bAI\s+(snake[- ]oil|grift|scam|fraud)\b/i,
    category: "snake-oil",
    tier: 1,
  },
  {
    pattern: /\b(snake[- ]oil|grift(?:er)?).{0,30}(AI|LLM)\b/i,
    category: "snake-oil",
    tier: 1,
  },

  // ── Tier 2: Medium-confidence patterns ──
  // Categorical "can't understand/think/reason"
  {
    pattern:
      /\b(LLM|AI|GPT|Claude|model)s?\s+(can'?t|cannot|doesn'?t|does not|will never)\s+(actually\s+)?(understand|think|reason|comprehend)\b/i,
    category: "categorical-denial",
    tier: 2,
  },
  {
    pattern: /\bdoesn'?t\s+(actually\s+)?understand\s+(anything|what)\b/i,
    category: "categorical-denial",
    tier: 2,
  },
  {
    pattern: /\bno\s+(actual|real|genuine)\s+understanding\b/i,
    category: "categorical-denial",
    tier: 2,
  },
  {
    pattern: /\bzero\s+(actual\s+)?understanding\b/i,
    category: "categorical-denial",
    tier: 2,
  },

  // "Just regurgitates"
  {
    pattern: /\b(just\s+)?regurgitat(e|es|ing)\s+(its\s+)?training\s+data\b/i,
    category: "regurgitation",
    tier: 2,
  },
  {
    pattern: /\bjust\s+(reproduc|copy|plagiariz|parrot)(e|es|ing)\b/i,
    category: "regurgitation",
    tier: 2,
  },

  // Bubble/crash comparisons
  {
    pattern: /\bAI\s+(bubble|hype\s+bubble|winter)\b/i,
    category: "bubble",
    tier: 2,
  },
  {
    pattern:
      /\b(crypto|dot[- ]?com|blockchain)\s+(bubble|hype).{0,40}(AI|LLM)\b/i,
    category: "bubble",
    tier: 2,
  },
  {
    pattern:
      /\b(AI|LLM).{0,40}(crypto|dot[- ]?com|blockchain)\s+(bubble|hype|all\s+over\s+again)\b/i,
    category: "bubble",
    tier: 2,
  },

  // Vibe coding contempt
  {
    pattern:
      /\bvibe[- ]?cod(e|ing|er).{0,40}(unmaintainable|garbage|trash|slop|crap|mess)\b/i,
    category: "vibe-coding-contempt",
    tier: 2,
  },
  {
    pattern: /\bunmaintainable.{0,40}vibe[- ]?cod/i,
    category: "vibe-coding-contempt",
    tier: 2,
  },

  // Emperor's new clothes
  {
    pattern: /\bemperor'?s?\s+new\s+clothes\b/i,
    category: "mass-delusion",
    tier: 2,
  },
  {
    pattern: /\bemperor\s+has\s+no\s+clothes\b/i,
    category: "mass-delusion",
    tier: 2,
  },

  // Cargo cult
  {
    pattern: /\bcargo\s+cult\s+(programming|coding)\b/i,
    category: "cargo-cult",
    tier: 2,
  },

  // "Confidently wrong"
  {
    pattern: /\bconfidently\s+(wrong|incorrect|bullshit|lying)\b/i,
    category: "confidently-wrong",
    tier: 2,
  },

  // Hallucination absolutism
  {
    pattern:
      /\bhallucin(ate|ation)s?.{0,30}(useless|worthless|can'?t\s+trust|untrustable)\b/i,
    category: "hallucination-absolutism",
    tier: 2,
  },

  // AI bro ad hominem
  {
    pattern: /\bAI\s+(bro|fanboy|cultist|zealot|true\s+believer|booster)s?\b/i,
    category: "ad-hominem",
    tier: 2,
  },
  {
    pattern: /\b(drinking|drank)\s+the\s+(AI|LLM)\s+kool[- ]?aid\b/i,
    category: "ad-hominem",
    tier: 2,
  },

  // AI hype (standalone, not just "AI hype bubble")
  { pattern: /\bAI\s+hype\b/i, category: "bubble", tier: 2 },

  // Replacement doom
  {
    pattern:
      /\b(?:AI|LLM)s?.{0,30}(?:replace|replacing|obsolete|make.{0,15}obsolete)\b/i,
    category: "replacement-doom",
    tier: 2,
  },

  // Skill atrophy
  {
    pattern:
      /\b(?:skills?\s+(?:are\s+)?(?:atrophy|atrophying|eroding|deteriorating)|deskilling).{0,30}(?:AI|LLM|code|coding)\b/i,
    category: "skill-atrophy",
    tier: 2,
  },

  // ── Tier 3: Lower-confidence / contextual ──
  // Sarcastic templates
  {
    pattern: /\bjust\s+a\s+(wrapper|thin\s+wrapper)\s+(around|over)\b/i,
    category: "wrapper-dismissal",
    tier: 3,
  },
  {
    pattern: /\byour\s+moat\s+is\s+a\s+system\s+prompt\b/i,
    category: "wrapper-dismissal",
    tier: 3,
  },
  {
    pattern: /\bAI\s+winter\s+is\s+(coming|going\s+to\s+be)\b/i,
    category: "doom-prediction",
    tier: 3,
  },

  // "LLM/AI is just..."
  {
    pattern: /\b(LLM|AI|GPT|model)s?\s+(is|are)\s+just\b/i,
    category: "reductive-just",
    tier: 3,
  },

  // Professional gatekeeping
  {
    pattern:
      /\b(real|actual|senior)\s+(programmer|developer|engineer)s?\s+(don'?t|wouldn'?t)\s+(need|use)\b/i,
    category: "gatekeeping",
    tier: 3,
  },
  {
    pattern:
      /\bwriting\s+(the\s+)?code\s+(was|is)\s+never\s+the\s+hard\s+part\b/i,
    category: "gatekeeping",
    tier: 3,
  },

  // Absolutist "never" claims
  {
    pattern: /\b(LLM|AI)s?\s+will\s+never\b/i,
    category: "absolutist-never",
    tier: 3,
  },

  // Appeal to authority + dismissal
  {
    pattern:
      /\bas\s+someone\s+who\s+(actually\s+)?(works?\s+in|studied|graduated).{0,60}(stochastic|autocomplete|parrot|slop|overhyped|doesn'?t\s+understand)/i,
    category: "authority-dismissal",
    tier: 3,
  },

  // Vibe code(base) standalone (pejorative usage without requiring a second contempt word)
  {
    pattern: /\bvibe[- ]?code(?:base)?\b/i,
    category: "vibe-coding-dismissal",
    tier: 3,
  },

  // Trained AI to replace
  {
    pattern: /\btrained\s+(?:the\s+)?(?:AI|LLM).{0,20}replace/i,
    category: "replacement-doom",
    tier: 3,
  },

  // Contempt for AI users
  {
    pattern:
      /\b(?:craven|naive|deluded|foolish|pathetic).{0,20}AI\s+(?:user|proponent)/i,
    category: "user-contempt",
    tier: 3,
  },
];

// Keywords that indicate the comment is about AI/LLMs (used to decide whether to send to LLM)
const AI_KEYWORDS =
  /\b(?:AI|LLMs?|GPT|Claude|Gemini|ChatGPT|OpenAI|Anthropic|Copilot|Cursor|vibe[- ]?coding|agentic(?:\s+coding)?|machine\s+learning|deep\s+learning|neural\s+net|large\s+language\s+model|artificial\s+intelligence|generative\s+AI)\b/i;

export function hasAIKeywords(text: string): boolean {
  return AI_KEYWORDS.test(text);
}

export function scoreSentiment(text: string): SentimentResult {
  const matches: PatternMatch[] = [];
  let score = 0;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      matches.push({
        category: rule.category,
        pattern: rule.pattern.source,
        tier: rule.tier,
      });
      score += TIER_WEIGHTS[rule.tier];
    }
  }

  return { score: Math.min(score, 1), matches };
}

export function getThresholdValue(
  threshold: "low" | "medium" | "high",
): number {
  switch (threshold) {
    case "low":
      return 0.4;
    case "medium":
      return 0.6;
    case "high":
      return 0.8;
  }
}
