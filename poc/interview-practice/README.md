# interview-practice

AI-powered coding interview practice CLI that simulates a realistic FAANG interviewer. The AI hides information, asks follow-ups, gives hints only when you're stuck, and adapts pacing to your progress.

## Installation

```bash
# From the monorepo root
bun install

# Run directly
bun run packages/interview-practice/src/index.ts

# Or build a standalone binary
cd packages/interview-practice
bun run build
./dist/interview-practice
```

## Quickstart

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start a practice session (random medium question, TypeScript)
interview-practice leetcode start -d medium -l ts

# Start with a specific question
interview-practice leetcode start -q two-sum -l java

# Resume a previous session
interview-practice leetcode resume <session-id>

# View past sessions
interview-practice leetcode history

# List available questions
interview-practice questions list

# Generate a new question with AI
interview-practice questions generate \
  --title "Sliding Window Maximum" \
  --description "Find the maximum in each sliding window of size k" \
  --difficulty hard \
  --tags "sliding-window,deque"
```

## Session Commands

During an interview session, use these commands:

| Command | Description |
|---------|-------------|
| `/run` | Run your solution against hidden tests |
| `/hint` | Request a hint (affects scoring) |
| `/score` | Show current assessment |
| `/time` | Show remaining time |
| `/quit` | End the session |
| (anything else) | Talk to the interviewer |

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `anthropic` | AI provider: `anthropic`, `openai`, or `google` |
| `CONVERSATION_MODEL` | per-provider default | Model to use for conversation |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `GOOGLE_API_KEY` | - | Google Generative AI key |
| `DATA_DIR` | `~/.interview-practice` | Data directory for sessions and questions |
| `LEETCODE_TIME_MINUTES` | `25` | Default session duration |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Question Format

Questions are stored as JSON files in `~/.interview-practice/questions/leetcode/`. Each question uses a multi-part structure with IO-based testing:

```json
{
  "id": "uuid",
  "title": "Two Sum",
  "slug": "two-sum",
  "difficulty": "easy",
  "tags": ["array", "hash-map"],
  "description": "Given an array of integers...",
  "parts": [
    {
      "partNumber": 1,
      "prompt": "Find two numbers that add up to target",
      "internalNotes": "Look for O(n) hash map solution",
      "hints": [
        { "level": "subtle", "content": "Think about what complement means" },
        { "level": "moderate", "content": "A hash map can store values you've seen" }
      ],
      "testCases": [
        { "input": "2 7 11 15\n9", "expected": "0 1" }
      ],
      "followUps": ["What if there are multiple valid pairs?"],
      "expectedApproach": "Hash map storing value -> index",
      "expectedComplexity": { "time": "O(n)", "space": "O(n)" },
      "transitionCriteria": {
        "minApproachQuality": "optimal",
        "mustExplainComplexity": true,
        "transitionPrompt": "What if the input array is sorted?"
      }
    }
  ],
  "constraints": ["2 <= nums.length <= 10^4"],
  "io": {
    "inputFormat": "int[] nums, int target",
    "outputFormat": "int[]",
    "parseHint": "first line: space-separated array, second line: target"
  },
  "source": "leetcode",
  "escalationPattern": "constraint-addition"
}
```

## Supported Languages

TypeScript, Java, Python, Go, Rust, and C++. Starter code is auto-generated from the question's IO schema.

## How It Works

1. The CLI selects a question and scaffolds a workspace with starter code
2. You open the solution file in your editor and the CLI in your terminal
3. The AI interviewer presents the problem and engages in natural conversation
4. Tests are always hidden -- the AI sees results but you only see pass/fail counts
5. The interviewer hints at failing cases verbally without revealing test details
6. At the end, you receive scores on Communication, Problem Solving, Technical skill, and Testing

## Post-Session Report

When a session ends, a summary report is displayed showing:
- Duration, turns, hints given, tests run
- Token usage and estimated API cost
- Test pass/fail statistics

Export the report as JSON with `--export-report <path>`:

```bash
interview-practice leetcode resume <id> --export-report report.json
```

## Development

```bash
bun run typecheck    # Type checking
bun test             # Run tests
bunx eslint . --fix  # Lint
```
