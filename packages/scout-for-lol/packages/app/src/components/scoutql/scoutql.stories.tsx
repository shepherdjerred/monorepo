import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownAnswer } from "./markdown-answer.tsx";
import { ChartImage } from "./chart-image.tsx";

const ANSWER = `Across the last **30 days** your Ranked Solo/Duo games break down like this:

- 24 games, 15 wins, 9 losses (62.5% win rate)
- Best champion: **Ahri** at 7-2 with a 4.1 KDA
- Worst champion: Lee Sin at 2-6

Your vision score per minute climbed from 0.7 to 1.1 after the patch.`;

const TABLE_ANSWER = `### Champion breakdown

| Champion | Games | Win rate | KDA |
| --- | --- | --- | --- |
| Ahri | 9 | 78% | 4.1 |
| Jinx | 7 | 57% | 3.4 |
| Lee Sin | 8 | 25% | 1.9 |

Totals cover Ranked Solo/Duo only.`;

const CODE_ANSWER = `The query Scout ran for this answer:

\`\`\`scoutql
matches
  where queue = "solo" and player = "bald"
  select champion, count(*) as games, avg(kda) as kda
  group by champion
\`\`\`

Inline identifiers such as \`player.alias\` are quoted the same way.

> Heads up: only matches Scout already ingested are counted — a game still
> being processed shows up on the next run.`;

const STREAMING_ANSWER = `Looking at the Baron fight at 27:
the enemy jungler started Baron at 26:4`;

const CHART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 200" role="img">
  <rect width="480" height="200" fill="#12141a"/>
  <polyline fill="none" stroke="#4f8cff" stroke-width="3" points="20,170 90,150 160,120 230,126 300,88 370,60 450,34"/>
  <polyline fill="none" stroke="#ff6b6b" stroke-width="3" points="20,172 90,158 160,142 230,136 300,124 370,112 450,96"/>
  <line x1="20" y1="180" x2="460" y2="180" stroke="#39414f" stroke-width="2"/>
  <line x1="20" y1="20" x2="20" y2="180" stroke="#39414f" stroke-width="2"/>
</svg>`;

const CHART_SRC = `data:image/svg+xml,${encodeURIComponent(CHART_SVG)}`;

const meta = {
  title: "ScoutQL",
  component: MarkdownAnswer,
  tags: ["autodocs"],
} satisfies Meta<typeof MarkdownAnswer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Answer: Story = {
  args: { children: ANSWER },
};

export const TableAnswer: Story = {
  args: { children: TABLE_ANSWER },
};

export const CodeAndQuote: Story = {
  args: { children: CODE_ANSWER },
};

export const Streaming: Story = {
  args: { children: STREAMING_ANSWER },
};

export const ServerChart: Story = {
  args: { children: "" },
  render: () => (
    <figure className="max-w-xl space-y-2">
      <figcaption className="text-sm text-scout-subtle">
        Team gold difference, rendered server-side and fetched with the session
        cookie.
      </figcaption>
      <ChartImage src={CHART_SRC} alt="Team gold over the course of the game" />
    </figure>
  ),
};

export const MissingChart: Story = {
  args: { children: "" },
  render: () => (
    <figure className="max-w-xl space-y-2">
      <figcaption className="text-sm text-scout-subtle">
        A chart that has not been generated yet renders nothing at all — no
        broken image icon.
      </figcaption>
      <ChartImage
        src="/api/charts/competition/not-generated-yet.png"
        alt="Competition standings over time"
      />
    </figure>
  ),
};
