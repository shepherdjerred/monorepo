/**
 * Panel to configure rank before/after match for testing promotion/demotion scenarios
 */
import { useMemo, useId } from "react";
import { z } from "zod";
import type { Rank, Tier, Division } from "@scout-for-lol/data";
import {
  wasPromoted,
  wasDemoted,
  divisionToString,
  TierSchema,
  DivisionSchema,
} from "@scout-for-lol/data";

const TIERS: Tier[] = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger",
];

const DIVISIONS: Division[] = [1, 2, 3, 4];

// Tiers that don't have divisions (only LP matters)
const APEX_TIERS: Tier[] = ["master", "grandmaster", "challenger"];

function isApexTier(tier: Tier): boolean {
  return APEX_TIERS.includes(tier);
}

function tierDisplayName(tier: Tier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export type RankConfig = {
  enabled: boolean;
  rankBefore: Rank;
  rankAfter: Rank;
};

type RankConfigPanelProps = {
  config: RankConfig;
  onChange: (config: RankConfig) => void;
};

type RankEditorProps = {
  label: string;
  rank: Rank;
  onChange: (rank: Rank) => void;
  idPrefix: string;
};

function RankEditor({ label, rank, onChange, idPrefix }: RankEditorProps) {
  const isApex = isApexTier(rank.tier);
  const tierId = `${idPrefix}-tier`;
  const divisionId = `${idPrefix}-division`;
  const lpId = `${idPrefix}-lp`;

  const handleTierChange = (value: string) => {
    const parsed = TierSchema.safeParse(value);
    if (parsed.success) {
      const newTier = parsed.data;
      onChange({
        ...rank,
        tier: newTier,
        // Reset division to 1 for apex tiers
        division: isApexTier(newTier) ? 1 : rank.division,
      });
    }
  };

  const handleDivisionChange = (value: string) => {
    const parsed = DivisionSchema.safeParse(Number(value));
    if (parsed.success) {
      onChange({ ...rank, division: parsed.data });
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-surface-600 uppercase tracking-wide">
        {label}
      </span>
      <div className="grid grid-cols-3 gap-2">
        {/* Tier */}
        <div>
          <label
            htmlFor={tierId}
            className="text-xs text-surface-500 mb-1 block"
          >
            Tier
          </label>
          <select
            id={tierId}
            value={rank.tier}
            onChange={(e) => {
              handleTierChange(e.target.value);
            }}
            className="select text-sm w-full"
          >
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tierDisplayName(tier)}
              </option>
            ))}
          </select>
        </div>

        {/* Division */}
        <div>
          <label
            htmlFor={divisionId}
            className="text-xs text-surface-500 mb-1 block"
          >
            Division
          </label>
          <select
            id={divisionId}
            value={rank.division}
            onChange={(e) => {
              handleDivisionChange(e.target.value);
            }}
            disabled={isApex}
            className="select text-sm w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {DIVISIONS.map((div) => (
              <option key={div} value={div}>
                {divisionToString(div)}
              </option>
            ))}
          </select>
        </div>

        {/* LP */}
        <div>
          <label htmlFor={lpId} className="text-xs text-surface-500 mb-1 block">
            LP
          </label>
          <input
            id={lpId}
            type="number"
            min={0}
            max={isApex ? 9999 : 100}
            value={rank.lp}
            onChange={(e) => {
              const value = Math.max(0, Number(e.target.value));
              onChange({ ...rank, lp: value });
            }}
            className="input text-sm w-full"
          />
        </div>
      </div>
    </div>
  );
}

type PresetButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  colorClass?: string;
};

function PresetButton({
  label,
  active,
  onClick,
  colorClass = "bg-surface-100",
}: PresetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
        active
          ? `${colorClass} ring-2 ring-brand-500 ring-offset-1`
          : `${colorClass} hover:bg-surface-200 text-surface-700`
      }`}
    >
      {label}
    </button>
  );
}

// Preset configurations
type Preset = "promotion" | "demotion" | "lp-gain" | "lp-loss" | "custom";

const PresetSchema = z.enum([
  "promotion",
  "demotion",
  "lp-gain",
  "lp-loss",
  "custom",
]);

function getPreset(before: Rank, after: Rank): Preset {
  if (wasPromoted(before, after)) {
    return "promotion";
  }
  if (wasDemoted(before, after)) {
    return "demotion";
  }
  if (
    after.lp > before.lp &&
    before.tier === after.tier &&
    before.division === after.division
  ) {
    return "lp-gain";
  }
  if (
    after.lp < before.lp &&
    before.tier === after.tier &&
    before.division === after.division
  ) {
    return "lp-loss";
  }
  return "custom";
}

function applyPreset(
  preset: Preset,
  currentBefore: Rank,
): { before: Rank; after: Rank } {
  const base: Rank = { ...currentBefore };

  switch (preset) {
    case "promotion": {
      // Promote within tier or to next tier
      if (base.division === 1) {
        // Promote to next tier
        const tierIndex = TIERS.indexOf(base.tier);
        if (tierIndex < TIERS.length - 1) {
          const nextTier = TIERS[tierIndex + 1];
          if (nextTier) {
            return {
              before: { ...base, lp: 100 },
              after: {
                ...base,
                tier: nextTier,
                division: isApexTier(nextTier) ? 1 : 4,
                lp: 0,
              },
            };
          }
        }
      }
      // Promote within tier (e.g., Gold 2 -> Gold 1)
      const newDivision = DivisionSchema.safeParse(
        Math.max(1, base.division - 1),
      );
      return {
        before: { ...base, lp: 100 },
        after: {
          ...base,
          division: newDivision.success ? newDivision.data : 1,
          lp: 0,
        },
      };
    }

    case "demotion": {
      // Demote within tier or to previous tier
      if (base.division === 4) {
        // Demote to previous tier
        const tierIndex = TIERS.indexOf(base.tier);
        if (tierIndex > 0) {
          const prevTier = TIERS[tierIndex - 1];
          if (prevTier) {
            return {
              before: { ...base, lp: 0 },
              after: { ...base, tier: prevTier, division: 1, lp: 75 },
            };
          }
        }
      }
      // Demote within tier
      const newDivision = DivisionSchema.safeParse(
        Math.min(4, base.division + 1),
      );
      return {
        before: { ...base, lp: 0 },
        after: {
          ...base,
          division: newDivision.success ? newDivision.data : 4,
          lp: 75,
        },
      };
    }

    case "lp-gain":
      return {
        before: { ...base, lp: 50 },
        after: { ...base, lp: 72 },
      };

    case "lp-loss":
      return {
        before: { ...base, lp: 50 },
        after: { ...base, lp: 32 },
      };

    case "custom":
      return { before: base, after: base };
  }
}

export function RankConfigPanel({ config, onChange }: RankConfigPanelProps) {
  const baseId = useId();

  // Derive preset from current config (no useEffect needed)
  const currentPreset = useMemo(
    () => getPreset(config.rankBefore, config.rankAfter),
    [config.rankBefore, config.rankAfter],
  );

  const handlePresetClick = (preset: Preset) => {
    const parsed = PresetSchema.safeParse(preset);
    if (!parsed.success || preset === "custom") {
      return;
    }
    const { before, after } = applyPreset(preset, config.rankBefore);
    onChange({ ...config, rankBefore: before, rankAfter: after });
  };

  const statusText = useMemo(() => {
    if (wasPromoted(config.rankBefore, config.rankAfter)) {
      return "🎉 PROMOTED";
    }
    if (wasDemoted(config.rankBefore, config.rankAfter)) {
      return "📉 DEMOTED";
    }
    if (config.rankAfter.lp > config.rankBefore.lp) {
      return `+${(config.rankAfter.lp - config.rankBefore.lp).toString()} LP`;
    }
    if (config.rankAfter.lp < config.rankBefore.lp) {
      return `${(config.rankAfter.lp - config.rankBefore.lp).toString()} LP`;
    }
    return "No change";
  }, [config.rankBefore, config.rankAfter]);

  const statusClass = useMemo(() => {
    if (wasPromoted(config.rankBefore, config.rankAfter)) {
      return "text-victory-600 bg-victory-50";
    }
    if (wasDemoted(config.rankBefore, config.rankAfter)) {
      return "text-defeat-600 bg-defeat-50";
    }
    return "text-surface-600 bg-surface-100";
  }, [config.rankBefore, config.rankAfter]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-surface-200/50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-surface-900">
            Rank Context
          </h2>
          <p className="text-sm text-surface-500 mt-0.5">
            Configure rank before/after for the review
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => {
              onChange({ ...config, enabled: e.target.checked });
            }}
            className="w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-surface-600">Override</span>
        </label>
      </div>

      <div
        className={`p-4 space-y-4 ${config.enabled ? "" : "opacity-50 pointer-events-none"}`}
      >
        {/* Quick presets */}
        <div>
          <span className="text-xs font-medium text-surface-600 uppercase tracking-wide mb-2 block">
            Quick Presets
          </span>
          <div className="flex flex-wrap gap-2">
            <PresetButton
              label="Promotion"
              active={currentPreset === "promotion"}
              onClick={() => {
                handlePresetClick("promotion");
              }}
              colorClass="bg-victory-50 text-victory-700"
            />
            <PresetButton
              label="Demotion"
              active={currentPreset === "demotion"}
              onClick={() => {
                handlePresetClick("demotion");
              }}
              colorClass="bg-defeat-50 text-defeat-700"
            />
            <PresetButton
              label="LP Gain"
              active={currentPreset === "lp-gain"}
              onClick={() => {
                handlePresetClick("lp-gain");
              }}
              colorClass="bg-blue-50 text-blue-700"
            />
            <PresetButton
              label="LP Loss"
              active={currentPreset === "lp-loss"}
              onClick={() => {
                handlePresetClick("lp-loss");
              }}
              colorClass="bg-amber-50 text-amber-700"
            />
          </div>
        </div>

        {/* Rank editors */}
        <div className="grid grid-cols-2 gap-4">
          <RankEditor
            label="Before Match"
            rank={config.rankBefore}
            onChange={(rankBefore) => {
              onChange({ ...config, rankBefore });
            }}
            idPrefix={`${baseId}-before`}
          />
          <RankEditor
            label="After Match"
            rank={config.rankAfter}
            onChange={(rankAfter) => {
              onChange({ ...config, rankAfter });
            }}
            idPrefix={`${baseId}-after`}
          />
        </div>

        {/* Status indicator */}
        <div
          className={`text-center py-2 px-4 rounded-lg text-sm font-medium ${statusClass}`}
        >
          {statusText}
        </div>
      </div>
    </div>
  );
}

/** Default rank config */
export function createDefaultRankConfig(): RankConfig {
  return {
    enabled: false,
    rankBefore: {
      tier: "gold",
      division: 2,
      lp: 75,
      wins: 50,
      losses: 45,
    },
    rankAfter: {
      tier: "gold",
      division: 1,
      lp: 0,
      wins: 51,
      losses: 45,
    },
  };
}
