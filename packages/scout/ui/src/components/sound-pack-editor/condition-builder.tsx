/* eslint-disable max-lines -- Component contains multiple related condition editors that benefit from co-location */
/**
 * Condition Builder Component
 *
 * UI for building rule conditions (player, champion, multikill, objective, etc.)
 */

import { useState } from "react";
import type { RuleCondition, MultikillType, ObjectiveType, DragonType } from "@shepherdjerred/scout-data";
import type { Champion } from "@shepherdjerred/scout-ui/types/adapter.ts";

type ConditionBuilderProps = {
  /** Current conditions */
  conditions: RuleCondition[];
  /** Called when conditions are updated */
  onChange: (conditions: RuleCondition[]) => void;
  /** Available champions for autocomplete */
  champions: Champion[];
  /** Local player name (if available) */
  localPlayerName?: string | undefined;
};

const MULTIKILL_TYPES: { value: MultikillType; label: string }[] = [
  { value: "double", label: "Double Kill" },
  { value: "triple", label: "Triple Kill" },
  { value: "quadra", label: "Quadra Kill" },
  { value: "penta", label: "Penta Kill" },
];

const OBJECTIVE_TYPES: { value: ObjectiveType; label: string }[] = [
  { value: "tower", label: "Tower" },
  { value: "inhibitor", label: "Inhibitor" },
  { value: "dragon", label: "Dragon" },
  { value: "baron", label: "Baron" },
  { value: "herald", label: "Rift Herald" },
];

const DRAGON_TYPES: { value: DragonType; label: string }[] = [
  { value: "infernal", label: "Infernal" },
  { value: "mountain", label: "Mountain" },
  { value: "ocean", label: "Ocean" },
  { value: "cloud", label: "Cloud" },
  { value: "hextech", label: "Hextech" },
  { value: "chemtech", label: "Chemtech" },
  { value: "elder", label: "Elder" },
];

type ConditionType = RuleCondition["type"];

const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "champion", label: "Champion" },
  { value: "multikill", label: "Multi-kill" },
  { value: "objective", label: "Objective" },
  { value: "dragonType", label: "Dragon Type" },
  { value: "stolen", label: "Stolen" },
  { value: "team", label: "Team" },
  { value: "gameResult", label: "Game Result" },
];

export function ConditionBuilder({ conditions, onChange, champions, localPlayerName }: ConditionBuilderProps) {
  const [newConditionType, setNewConditionType] = useState<ConditionType>("player");

  const addCondition = () => {
    let newCondition: RuleCondition;

    switch (newConditionType) {
      case "player":
        newCondition = { type: "player", field: "killer", players: [] };
        break;
      case "champion":
        newCondition = { type: "champion", field: "killerChampion", champions: [] };
        break;
      case "multikill":
        newCondition = { type: "multikill", killTypes: [] };
        break;
      case "objective":
        newCondition = { type: "objective", objectives: [] };
        break;
      case "dragonType":
        newCondition = { type: "dragonType", dragons: [] };
        break;
      case "stolen":
        newCondition = { type: "stolen", isStolen: true };
        break;
      case "team":
        newCondition = { type: "team", team: "ally" };
        break;
      case "gameResult":
        newCondition = { type: "gameResult", result: "victory" };
        break;
    }

    onChange([...conditions, newCondition]);
  };

  const updateCondition = (index: number, updated: RuleCondition) => {
    const newConditions = [...conditions];
    newConditions[index] = updated;
    onChange(newConditions);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {/* Existing conditions */}
      {conditions.map((condition, index) => (
        <ConditionCard
          key={index}
          condition={condition}
          onChange={(updated) => {
            updateCondition(index, updated);
          }}
          onRemove={() => {
            removeCondition(index);
          }}
          champions={champions}
          localPlayerName={localPlayerName}
        />
      ))}

      {/* Add condition */}
      <div className="flex items-center gap-2">
        <select
          value={newConditionType}
          onChange={(e) => {
            const value = e.currentTarget.value;
            // Validate the value before setting
            if (
              value === "player" ||
              value === "champion" ||
              value === "multikill" ||
              value === "objective" ||
              value === "dragonType" ||
              value === "stolen" ||
              value === "team" ||
              value === "gameResult"
            ) {
              setNewConditionType(value);
            }
          }}
          className="px-2 py-1 border rounded text-sm bg-white"
        >
          {CONDITION_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>
              {ct.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addCondition}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          Add Condition
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Condition Card
// =============================================================================

type ConditionCardProps = {
  condition: RuleCondition;
  onChange: (condition: RuleCondition) => void;
  onRemove: () => void;
  champions: Champion[];
  localPlayerName?: string | undefined;
};

function ConditionCard({ condition, onChange, onRemove, champions, localPlayerName }: ConditionCardProps) {
  const renderConditionContent = () => {
    switch (condition.type) {
      case "player":
        return <PlayerConditionEditor condition={condition} onChange={onChange} localPlayerName={localPlayerName} />;
      case "champion":
        return <ChampionConditionEditor condition={condition} onChange={onChange} champions={champions} />;
      case "multikill":
        return <MultikillConditionEditor condition={condition} onChange={onChange} />;
      case "objective":
        return <ObjectiveConditionEditor condition={condition} onChange={onChange} />;
      case "dragonType":
        return <DragonTypeConditionEditor condition={condition} onChange={onChange} />;
      case "stolen":
        return <StolenConditionEditor condition={condition} onChange={onChange} />;
      case "team":
        return <TeamConditionEditor condition={condition} onChange={onChange} />;
      case "gameResult":
        return <GameResultConditionEditor condition={condition} onChange={onChange} />;
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between">
        <div className="flex-1">{renderConditionContent()}</div>
        <button
          type="button"
          onClick={onRemove}
          className="ml-2 p-1 text-red-500 hover:bg-red-50 rounded"
          title="Remove condition"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Individual Condition Editors
// =============================================================================

function PlayerConditionEditor({
  condition,
  onChange,
  localPlayerName,
}: {
  condition: Extract<RuleCondition, { type: "player" }>;
  onChange: (condition: RuleCondition) => void;
  localPlayerName?: string | undefined;
}) {
  const [newPlayer, setNewPlayer] = useState("");

  const addPlayer = () => {
    if (newPlayer.trim() && !condition.players.includes(newPlayer.trim())) {
      onChange({
        ...condition,
        players: [...condition.players, newPlayer.trim()],
      });
      setNewPlayer("");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Player</span>
        <select
          value={condition.field}
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value === "killer" || value === "victim") {
              onChange({ ...condition, field: value });
            }
          }}
          className="px-2 py-1 border rounded text-sm bg-white"
        >
          <option value="killer">Killer</option>
          <option value="victim">Victim</option>
        </select>
        <span className="text-sm text-gray-500">is one of:</span>
      </div>

      {/* Include local player checkbox */}
      {localPlayerName && (
        <label htmlFor="include-local-player" className="flex items-center gap-2 text-sm">
          <input
            id="include-local-player"
            type="checkbox"
            checked={condition.includeLocalPlayer ?? false}
            onChange={(e) => {
              onChange({ ...condition, includeLocalPlayer: e.currentTarget.checked });
            }}
            className="rounded"
          />
          <span>Include me ({localPlayerName})</span>
        </label>
      )}

      {/* Player list */}
      <div className="flex flex-wrap gap-1">
        {condition.players.map((player) => (
          <span key={player} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 rounded text-sm">
            {player}
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...condition,
                  players: condition.players.filter((p) => p !== player),
                });
              }}
              className="text-blue-600 hover:text-blue-800"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Add player input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newPlayer}
          onChange={(e) => {
            setNewPlayer(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              addPlayer();
            }
          }}
          placeholder="Summoner name"
          className="flex-1 px-2 py-1 border rounded text-sm"
        />
        <button type="button" onClick={addPlayer} className="px-2 py-1 bg-gray-100 rounded text-sm hover:bg-gray-200">
          Add
        </button>
      </div>
    </div>
  );
}

function ChampionConditionEditor({
  condition,
  onChange,
  champions,
}: {
  condition: Extract<RuleCondition, { type: "champion" }>;
  onChange: (condition: RuleCondition) => void;
  champions: Champion[];
}) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredChampions = query
    ? champions
        .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) && !condition.champions.includes(c.id))
        .slice(0, 8)
    : [];

  const addChampion = (championId: string) => {
    if (!condition.champions.includes(championId)) {
      onChange({
        ...condition,
        champions: [...condition.champions, championId],
      });
    }
    setQuery("");
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Champion</span>
        <select
          value={condition.field}
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value === "killerChampion" || value === "victimChampion") {
              onChange({ ...condition, field: value });
            }
          }}
          className="px-2 py-1 border rounded text-sm bg-white"
        >
          <option value="killerChampion">Killer&apos;s Champion</option>
          <option value="victimChampion">Victim&apos;s Champion</option>
        </select>
        <span className="text-sm text-gray-500">is one of:</span>
      </div>

      {/* Champion list */}
      <div className="flex flex-wrap gap-1">
        {condition.champions.map((champId) => {
          const champ = champions.find((c) => c.id === champId);
          return (
            <span key={champId} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 rounded text-sm">
              {champ?.name ?? champId}
              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...condition,
                    champions: condition.champions.filter((c) => c !== champId),
                  });
                }}
                className="text-purple-600 hover:text-purple-800"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {/* Champion autocomplete */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            setShowSuggestions(true);
          }}
          onBlur={() => {
            setTimeout(() => {
              setShowSuggestions(false);
            }, 200);
          }}
          placeholder="Search champions..."
          className="w-full px-2 py-1 border rounded text-sm"
        />
        {showSuggestions && filteredChampions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow-lg max-h-48 overflow-auto">
            {filteredChampions.map((champ) => (
              <button
                key={champ.id}
                type="button"
                onClick={() => {
                  addChampion(champ.id);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
              >
                {champ.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MultikillConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "multikill" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  const toggleType = (type: MultikillType) => {
    const newTypes = condition.killTypes.includes(type)
      ? condition.killTypes.filter((t) => t !== type)
      : [...condition.killTypes, type];
    onChange({ ...condition, killTypes: newTypes });
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Multi-kill type is:</span>
      <div className="flex flex-wrap gap-2">
        {MULTIKILL_TYPES.map((mt) => (
          <label key={mt.value} htmlFor={`multikill-${mt.value}`} className="flex items-center gap-1 text-sm">
            <input
              id={`multikill-${mt.value}`}
              type="checkbox"
              checked={condition.killTypes.includes(mt.value)}
              onChange={() => {
                toggleType(mt.value);
              }}
              className="rounded"
            />
            {mt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function ObjectiveConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "objective" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  const toggleType = (type: ObjectiveType) => {
    const newTypes = condition.objectives.includes(type)
      ? condition.objectives.filter((t) => t !== type)
      : [...condition.objectives, type];
    onChange({ ...condition, objectives: newTypes });
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Objective type is:</span>
      <div className="flex flex-wrap gap-2">
        {OBJECTIVE_TYPES.map((ot) => (
          <label key={ot.value} htmlFor={`objective-${ot.value}`} className="flex items-center gap-1 text-sm">
            <input
              id={`objective-${ot.value}`}
              type="checkbox"
              checked={condition.objectives.includes(ot.value)}
              onChange={() => {
                toggleType(ot.value);
              }}
              className="rounded"
            />
            {ot.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function DragonTypeConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "dragonType" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  const toggleType = (type: DragonType) => {
    const newTypes = condition.dragons.includes(type)
      ? condition.dragons.filter((t) => t !== type)
      : [...condition.dragons, type];
    onChange({ ...condition, dragons: newTypes });
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Dragon type is:</span>
      <div className="flex flex-wrap gap-2">
        {DRAGON_TYPES.map((dt) => (
          <label key={dt.value} htmlFor={`dragon-${dt.value}`} className="flex items-center gap-1 text-sm">
            <input
              id={`dragon-${dt.value}`}
              type="checkbox"
              checked={condition.dragons.includes(dt.value)}
              onChange={() => {
                toggleType(dt.value);
              }}
              className="rounded"
            />
            {dt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function StolenConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "stolen" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Objective was</span>
      <select
        value={condition.isStolen ? "stolen" : "not-stolen"}
        onChange={(e) => {
          onChange({ ...condition, isStolen: e.currentTarget.value === "stolen" });
        }}
        className="px-2 py-1 border rounded text-sm bg-white"
      >
        <option value="stolen">Stolen</option>
        <option value="not-stolen">Not Stolen</option>
      </select>
    </div>
  );
}

function TeamConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "team" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Team is</span>
      <select
        value={condition.team}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (value === "ally" || value === "enemy") {
            onChange({ ...condition, team: value });
          }
        }}
        className="px-2 py-1 border rounded text-sm bg-white"
      >
        <option value="ally">Ally (my team)</option>
        <option value="enemy">Enemy</option>
      </select>
    </div>
  );
}

function GameResultConditionEditor({
  condition,
  onChange,
}: {
  condition: Extract<RuleCondition, { type: "gameResult" }>;
  onChange: (condition: RuleCondition) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Game result is</span>
      <select
        value={condition.result}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (value === "victory" || value === "defeat") {
            onChange({ ...condition, result: value });
          }
        }}
        className="px-2 py-1 border rounded text-sm bg-white"
      >
        <option value="victory">Victory</option>
        <option value="defeat">Defeat</option>
      </select>
    </div>
  );
}
