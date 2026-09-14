import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownContent } from "./markdown-content.tsx";

const meta = {
  title: "Domain/MarkdownContent",
  component: MarkdownContent,
  tags: ["autodocs"],
} satisfies Meta<typeof MarkdownContent>;

export default meta;

type Story = StoryObj<typeof meta>;

const reportSummary = `## Weekly report — Bearded Lyfe #NA1

Twelve Ranked Solo/Duo games, **eight wins**, net **+61 LP**. Promoted from
Emerald III to Emerald II on Thursday.

### Highlights

- Best game: **Ahri** 14/2/9 in 27 minutes, mid lane.
- Worst game: **Yasuo** 2/11/3 after an early jungle invade.
- Most played role: mid lane, seven of twelve games.
`;

const championTable = `## Champion breakdown

| Champion | Games | Win rate | KDA | Avg LP |
| --- | ---: | ---: | ---: | ---: |
| Ahri | 7 | 71% | 4.8 | +9 |
| Syndra | 3 | 67% | 3.1 | +6 |
| Orianna | 2 | 50% | 2.4 | -1 |
| Yasuo | 1 | 0% | 0.5 | -22 |
`;

const patchNotes = `## Patch 25.18 — what changed for your pool

### Buffs

1. **Ahri** — R cooldown lowered at ranks 2 and 3.
2. **Lee Sin** — Q damage now scales with bonus AD.

### Nerfs

- ~~Kraken Slayer~~ attack speed reduced to 25%.
- Grasp of the Undying heals for less on ranged champions.

> Champion pool changes land in reports the next time Scout ingests a match.
`;

const exploreAnswer = `## Which champion carried the most games?

**Ahri** — seven games, five wins, and the highest average damage share of the
pool. The generated ScoutQL for this answer was:

\`\`\`sql
select champion, count(*) as games, avg(damage_share) as share
from matches
where queue = 'RANKED_SOLO_5x5'
group by champion
order by share desc
\`\`\`

Ask a follow-up to narrow the window to a single split, or open the
[full weekly report](/app/reports/weekly) for per-game detail.
`;

const dareRules = `## Dare: first blood or bust

Terms agreed by both sides:

1. The challenger plays **jungle** in Ranked Solo/Duo.
2. The dare settles on the **same game** — cross-game progress does not count.
3. Stake: **250 Bucks** from the challenger, pile-ons welcome until the game
   starts.

If the game is remade, the dare returns to *pending* and the stake is released.
`;

export const ReportSummary: Story = { args: { source: reportSummary } };

export const ChampionTable: Story = { args: { source: championTable } };

export const PatchNotes: Story = { args: { source: patchNotes } };

export const ExploreAnswer: Story = { args: { source: exploreAnswer } };

export const DareTerms: Story = { args: { source: dareRules } };
