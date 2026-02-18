/**
 * Condition Builder Component
 *
 * UI for building rule conditions (player, champion, multikill, objective, etc.)
 */

import { useState } from "react";
import type { RuleCondition } from "@scout-for-lol/data";
import type { Champion } from "@scout-for-lol/ui/types/adapter.ts";
import {
  PlayerConditionEditor,
  ChampionConditionEditor,
  MultikillConditionEditor,
  ObjectiveConditionEditor,
  DragonTypeConditionEditor,
  StolenConditionEditor,
  TeamConditionEditor,
  GameResultConditionEditor,
} from "./condition-editors.tsx";

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

export function ConditionBuilder({
  conditions,
  onChange,
  champions,
  localPlayerName,
}: ConditionBuilderProps) {
  const [newConditionType, setNewConditionType] =
    useState<ConditionType>("player");

  const addCondition = () => {
    let newCondition: RuleCondition;

    switch (newConditionType) {
      case "player":
        newCondition = { type: "player", field: "killer", players: [] };
        break;
      case "champion":
        newCondition = {
          type: "champion",
          field: "killerChampion",
          champions: [],
        };
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

function ConditionCard({
  condition,
  onChange,
  onRemove,
  champions,
  localPlayerName,
}: ConditionCardProps) {
  const renderConditionContent = () => {
    switch (condition.type) {
      case "player":
        return (
          <PlayerConditionEditor
            condition={condition}
            onChange={onChange}
            localPlayerName={localPlayerName}
          />
        );
      case "champion":
        return (
          <ChampionConditionEditor
            condition={condition}
            onChange={onChange}
            champions={champions}
          />
        );
      case "multikill":
        return (
          <MultikillConditionEditor condition={condition} onChange={onChange} />
        );
      case "objective":
        return (
          <ObjectiveConditionEditor condition={condition} onChange={onChange} />
        );
      case "dragonType":
        return (
          <DragonTypeConditionEditor
            condition={condition}
            onChange={onChange}
          />
        );
      case "stolen":
        return (
          <StolenConditionEditor condition={condition} onChange={onChange} />
        );
      case "team":
        return (
          <TeamConditionEditor condition={condition} onChange={onChange} />
        );
      case "gameResult":
        return (
          <GameResultConditionEditor
            condition={condition}
            onChange={onChange}
          />
        );
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
          x
        </button>
      </div>
    </div>
  );
}
