import { Coins, Compass, Skull, Sparkles, Swords, Trophy } from "lucide-react";
import type {
  PlayerCombatSummary,
  PlayerGameplayCard,
} from "@shepherdjerred/storm-stats/shared/player-contract.ts";
import {
  formatDecimal,
  formatInt,
  formatKdr,
  formatRelativeTime,
  formatTitleIdentifier,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { ShareBreakdownPanel } from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import { CombatFeedTable } from "@shepherdjerred/storm-stats/client/components/combat-feed-table.tsx";

const RETRO_SKILLS_CANONICAL = [
  "mining",
  "woodcutting",
  "excavation",
  "farming",
  "fishing",
  "combat",
  "archery",
  "defense",
  "agility",
  "enchanting",
  "alchemy",
] as const;

export function PlayerGameplayPanel({
  gameplay,
}: {
  readonly gameplay: PlayerGameplayCard | null;
}) {
  if (gameplay === null) {
    return (
      <div className="panel">
        <p className="panel-subtitle">
          No Storm plugin gameplay snapshot has been captured for this player
          yet.
        </p>
      </div>
    );
  }

  const skillKeys = new Set<string>([
    ...RETRO_SKILLS_CANONICAL,
    ...Object.keys(gameplay.skills),
  ]);
  const skillEntries = [...skillKeys].map((skill) => ({
    skill,
    level: gameplay.skills[skill] ?? 0,
  }));
  skillEntries.sort((left, right) => right.level - left.level);

  const trackEntries = Object.entries(gameplay.tracks);
  trackEntries.sort((left, right) => right[1] - left[1]);

  const arenaEntries = Object.entries(gameplay.arenaBestWaves);
  arenaEntries.sort((left, right) => right[1] - left[1]);

  return (
    <div className="stack-lg">
      <section aria-label="Player gameplay metrics" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Economy Balance</span>
            <Coins size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(gameplay.coins)} coins</div>
          <div className="kpi-detail">
            Snapshot {formatRelativeTime(gameplay.capturedAt)}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Town &amp; Claims</span>
            <Compass size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{gameplay.townName ?? "Wilderness"}</div>
          <div className="kpi-detail">
            {gameplay.townRole === null
              ? "No town membership"
              : `${formatTitleIdentifier(gameplay.townRole)} · ${formatInt(gameplay.townClaims)} chunks`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total Skill Power</span>
            <Sparkles size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(gameplay.powerLevel)}</div>
          <div className="kpi-detail">
            Signature:{" "}
            <strong>
              {gameplay.topSkill === null
                ? "—"
                : `${formatTitleIdentifier(gameplay.topSkill)} (${formatInt(gameplay.topSkillLevel)})`}
            </strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Quests Completed</span>
            <Trophy size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(gameplay.questsCompleted)}</div>
          <div className="kpi-detail">Counted Storm quests finished</div>
        </div>
      </section>

      <div className="panel">
        <div className="panel-header">
          <h2>Retro Skills Breakdown</h2>
          <span className="panel-subtitle">
            Power Level {formatInt(gameplay.powerLevel)} across{" "}
            {formatInt(skillEntries.length)} skills
          </span>
        </div>
        <div className="skills-grid">
          {skillEntries.map((entry) => (
            <div key={entry.skill} className="skill-tile">
              <span>{formatTitleIdentifier(entry.skill)}</span>
              <span className="pill pill-purple">
                Lv {formatInt(entry.level)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-3">
        <div className="panel">
          <div className="panel-header">
            <h2>Search &amp; Destroy (RWF)</h2>
            <Swords size={16} aria-hidden="true" />
          </div>
          <div className="share-list">
            <div className="share-row-head">
              <span>Matches Played</span>
              <strong>{formatInt(gameplay.rwfMatches)}</strong>
            </div>
            <div className="share-row-head">
              <span>Wins / Losses</span>
              <span>
                <strong className="pill pill-regular">
                  {formatInt(gameplay.rwfWins)}W
                </strong>{" "}
                /{" "}
                <span className="pill pill-inactive">
                  {formatInt(gameplay.rwfLosses)}L
                </span>
              </span>
            </div>
            <div className="share-row-head">
              <span>Kills / Deaths</span>
              <span className="mono">
                {formatInt(gameplay.rwfKills)} / {formatInt(gameplay.rwfDeaths)}{" "}
                ({formatKdr(gameplay.rwfKills, gameplay.rwfDeaths)} K/D)
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Mob Arena Best Waves</h2>
            <Trophy size={16} aria-hidden="true" />
          </div>
          {arenaEntries.length === 0 ? (
            <p className="panel-subtitle">No Mob Arena waves recorded yet.</p>
          ) : (
            <div className="share-list">
              {arenaEntries.map(([arena, wave]) => (
                <div key={arena} className="share-row-head">
                  <span>{formatTitleIdentifier(arena)}</span>
                  <span className="pill pill-active">
                    Wave {formatInt(wave)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Progression Tracks</h2>
          </div>
          {trackEntries.length === 0 ? (
            <p className="panel-subtitle">
              No progression tracks unlocked yet.
            </p>
          ) : (
            <div className="share-list">
              {trackEntries.map(([track, tier]) => (
                <div key={track} className="share-row-head">
                  <span>{formatTitleIdentifier(track)}</span>
                  <strong>Tier {formatInt(tier)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlayerCombatPanel({
  combat,
}: {
  readonly combat: PlayerCombatSummary;
}) {
  return (
    <div className="stack-lg">
      <section aria-label="Player combat summary" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Survival PvP K/D</span>
            <Swords size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatDecimal(combat.kdr, 2)}</div>
          <div className="kpi-detail">
            <strong>{formatInt(combat.pvpKills)}</strong> kills /{" "}
            <strong>{formatInt(combat.pvpDeaths)}</strong> deaths
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Mobs Defeated</span>
            <Trophy size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(combat.mobKills)}</div>
          <div className="kpi-detail">
            Killed by mobs: <strong>{formatInt(combat.mobDeaths)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Environmental Deaths</span>
            <Skull size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(combat.envDeaths)}</div>
          <div className="kpi-detail">Fall, lava, void &amp; hazard deaths</div>
        </div>
      </section>

      <ShareBreakdownPanel
        title="Favorite Weapons"
        subtitle="Share of player combat kills"
        items={combat.favoriteWeapons.map((weapon) => ({
          key: weapon.weapon,
          label: formatTitleIdentifier(weapon.weapon),
          sharePercent: weapon.sharePercent,
          detail: `${formatInt(weapon.kills)} kills`,
        }))}
      />

      <div className="panel">
        <div className="panel-header">
          <h2>Recent Combat Log</h2>
          <span className="panel-subtitle">
            Latest {formatInt(combat.recentCombat.length)} combat encounters
          </span>
        </div>
        <CombatFeedTable
          rows={combat.recentCombat}
          caption="Player recent combat log"
        />
      </div>
    </div>
  );
}
