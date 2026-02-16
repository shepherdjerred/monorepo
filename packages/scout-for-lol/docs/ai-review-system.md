# AI Review System

The AI review system generates match analysis and art prompts using OpenAI's GPT models. This document covers the complete pipeline from match data to Discord post.

## Pipeline Overview

```mermaid
flowchart TB
    subgraph Input["Input Data"]
        MATCH["CompletedMatch"]
        TIMELINE["Match Timeline"]
        PLAYER["Player Config"]
    end

    subgraph Curation["Data Curation"]
        CURATE["Curate Match Data"]
        TIMELINE_CURATE["Curate Timeline Events"]
        LANE_CONTEXT["Load Lane Primer"]
        PERSONALITY["Load Personality"]
    end

    subgraph AI["AI Generation"]
        ANALYSIS["GPT-4o-mini<br/>Match Analysis"]
        ART_PROMPT["GPT-5.1<br/>Art Prompt"]
        IMAGE_GEN["Image Generation<br/>(Optional)"]
    end

    subgraph Output["Output"]
        S3["Save to S3"]
        DISCORD["Post to Discord"]
    end

    MATCH --> CURATE
    TIMELINE --> TIMELINE_CURATE
    PLAYER --> PERSONALITY

    CURATE --> ANALYSIS
    TIMELINE_CURATE --> ANALYSIS
    LANE_CONTEXT --> ANALYSIS
    PERSONALITY --> ANALYSIS

    ANALYSIS --> ART_PROMPT
    PERSONALITY --> ART_PROMPT

    ART_PROMPT --> IMAGE_GEN

    ANALYSIS --> S3
    ART_PROMPT --> S3
    IMAGE_GEN --> S3

    ANALYSIS --> DISCORD
    IMAGE_GEN --> DISCORD
```

## AI Models Used

| Model         | Purpose        | Temperature | Max Tokens | Cost (per 1M)        |
| ------------- | -------------- | ----------- | ---------- | -------------------- |
| `gpt-4o-mini` | Match analysis | 0.4         | 3000       | $0.15 in / $0.60 out |
| `gpt-5.1`     | Art prompt     | 0.8         | 600        | $1.25 in / $10 out   |

## Match Analysis

### Input Construction

The analysis prompt is built from multiple sources:

```mermaid
flowchart LR
    subgraph Sources
        SYSTEM["System Prompt"]
        CURATED["Curated Match Data"]
        TIMELINE["Timeline Summary"]
        LANE["Lane Primer"]
    end

    subgraph Prompt
        FINAL["Final Prompt"]
    end

    SYSTEM --> FINAL
    CURATED --> FINAL
    TIMELINE --> FINAL
    LANE --> FINAL
```

### System Prompt Structure

```text
You are a League of Legends analyst creating a match review.

Focus on:
- Game flow and key moments
- Player performance in their lane
- Specific improvement suggestions

Format:
- ~220 words total
- Summary paragraph
- 3-5 bullet points with numbers
- 1-2 improvement ideas
```

### Data Curation

The `curateMatchData()` function extracts relevant stats:

```typescript
interface CuratedMatchData {
  player: {
    champion: string;
    lane: string;
    kda: { kills: number; deaths: number; assists: number };
    cs: number;
    gold: number;
    damage: number;
    visionScore: number;
  };
  team: {
    outcome: "Victory" | "Defeat";
    totalKills: number;
    objectives: { dragons: number; barons: number; towers: number };
  };
  enemy: {
    laner: { champion: string; kda: object };
  };
  gameDuration: number;
}
```

### Timeline Curation

Key events extracted from match timeline:

| Event Type              | Extracted Info                     |
| ----------------------- | ---------------------------------- |
| `CHAMPION_KILL`         | Killer, victim, assists, timestamp |
| `BUILDING_DESTROYED`    | Tower/inhibitor, team, timestamp   |
| `ELITE_MONSTER_KILL`    | Dragon/Baron, team, timestamp      |
| `CHAMPION_SPECIAL_KILL` | Multi-kills, timestamp             |

### Lane Context

Each lane has a primer loaded from `packages/data/src/prompts/lanes/`:

```text
# Top Lane Context

Focus areas:
- Wave management and freezing
- Teleport usage and map impact
- Split-push pressure
- Team fight frontlining

Key metrics to evaluate:
- CS differential at 10/15 minutes
- Solo kills and deaths
- Tower plates taken
- Teleport effectiveness
```

## Art Prompt Generation

### Input Sources

```mermaid
flowchart LR
    REVIEW["Match Analysis"]
    STYLE["Art Style"]
    THEMES["Art Themes"]
    HINTS["Personality Image Hints"]

    REVIEW --> PROMPT["Art Prompt"]
    STYLE --> PROMPT
    THEMES --> PROMPT
    HINTS --> PROMPT
```

### Art Styles

Available styles from `packages/data/src/review/art-styles.ts`:

| Style          | Description                  |
| -------------- | ---------------------------- |
| `anime`        | Japanese animation aesthetic |
| `digital-art`  | Modern digital illustration  |
| `oil-painting` | Classical oil painting style |
| `watercolor`   | Soft watercolor aesthetic    |
| `comic-book`   | Bold comic book style        |
| `pixel-art`    | Retro pixel art              |

### Art Themes

| Theme             | Elements                  |
| ----------------- | ------------------------- |
| `epic-battle`     | Action, combat, intensity |
| `serene-victory`  | Peaceful triumph          |
| `dramatic-defeat` | Emotional loss            |
| `team-unity`      | Cooperation, synergy      |
| `solo-carry`      | Individual dominance      |

### Prompt Output

The art prompt generator produces ~120 words describing:

- Scene composition
- Character positioning
- Lighting and mood
- Visual style elements
- Champion-specific details

## Personality System

### Structure

Personalities are defined in `packages/data/src/prompts/personalities/`:

```text
personalities/
├── aaron/
│   ├── metadata.json    # Style configuration
│   └── instructions.txt # Writing style guide
└── default/
    ├── metadata.json
    └── instructions.txt
```

### Metadata Schema

```typescript
interface PersonalityMetadata {
  name: string;
  description: string;
  style: string; // Writing voice
  themes: string[]; // Preferred themes
  imagePrompts: string[]; // Art direction hints
  personalityImageHints: string; // Visual character
}
```

### Instructions File

Free-form text describing the personality's:

- Tone and voice
- Analysis focus areas
- Vocabulary preferences
- Humor/seriousness balance

## Storage

### S3 Structure

```text
s3://bucket/
├── matches/
│   └── {matchId}.json           # Raw match data
├── reports/
│   └── {matchId}-{queue}.png    # Report image
└── ai-reviews/
    └── {matchId}-{queue}/
        ├── analysis.json        # AI analysis + metadata
        ├── art-prompt.json      # Art prompt + metadata
        └── debug.json           # Full request/response
```

### Analysis JSON Schema

```typescript
interface StoredAnalysis {
  matchId: string;
  queueType: string;
  player: string;
  analysis: string;
  model: string;
  tokens: { input: number; output: number };
  cost: number;
  generatedAt: string;
}
```

## Error Handling

### Graceful Degradation

```mermaid
flowchart TD
    START[Start Review]
    START --> CHECK_KEY{OpenAI key?}

    CHECK_KEY -->|No| SKIP_AI[Skip AI features]
    CHECK_KEY -->|Yes| TRY_ANALYSIS[Try analysis]

    TRY_ANALYSIS --> ANALYSIS_OK{Success?}
    ANALYSIS_OK -->|No| LOG_ANALYSIS[Log error]
    ANALYSIS_OK -->|Yes| TRY_ART[Try art prompt]

    TRY_ART --> ART_OK{Success?}
    ART_OK -->|No| LOG_ART[Log error]
    ART_OK -->|Yes| SAVE[Save to S3]

    LOG_ANALYSIS --> CONTINUE[Continue without AI]
    LOG_ART --> CONTINUE
    SKIP_AI --> CONTINUE
    SAVE --> CONTINUE

    CONTINUE --> POST[Post to Discord]
```

### Token Optimization

To reduce costs and stay within limits:

- JSON data is minified before sending
- Only relevant match data is included
- Timeline is summarized to key events
- Output length is constrained via prompts

## Configuration

### Environment Variables

| Variable         | Required | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `OPENAI_API_KEY` | No       | Enables AI features                |
| `GEMINI_API_KEY` | No       | Google Gemini (not currently used) |

### Fallback Behavior

| Missing Config   | Behavior                        |
| ---------------- | ------------------------------- |
| No OpenAI key    | Skip analysis, post report only |
| Analysis fails   | Continue with report            |
| Art prompt fails | Continue without art            |
| Image gen fails  | Continue without image          |

## Extending the System

### Adding a New Personality

1. Create directory: `packages/data/src/prompts/personalities/{name}/`
2. Add `metadata.json` with style configuration
3. Add `instructions.txt` with writing guide
4. Personality will be auto-discovered

### Adding Art Styles/Themes

Edit `packages/data/src/review/art-styles.ts`:

```typescript
export const ART_STYLES = [
  // ... existing styles
  { id: "new-style", name: "New Style", description: "..." },
];
```

## Cost Tracking

### Per-Review Estimate

| Component         | Tokens (approx) | Cost        |
| ----------------- | --------------- | ----------- |
| Analysis input    | ~2000           | $0.0003     |
| Analysis output   | ~400            | $0.00024    |
| Art prompt input  | ~600            | $0.003      |
| Art prompt output | ~150            | $0.00225    |
| **Total**         |                 | **~$0.006** |

### Monitoring

Costs are logged to S3 with each generation for tracking and optimization.
