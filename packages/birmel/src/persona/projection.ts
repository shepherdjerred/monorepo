import { getStyleCard } from "@shepherdjerred/glitter-context";
import { CONTEXT_BUDGETS } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

function renderList(title: string, values: readonly string[], limit: number) {
  const selected = values.slice(0, limit);
  if (selected.length === 0) {
    return "";
  }
  return `${title}:\n${selected.map((value) => `- ${value}`).join("\n")}`;
}

function renderSummary(summary: string | string[]): string {
  return Array.isArray(summary) ? summary.join(" ") : summary;
}

function keepCompleteLines(value: string, maximum: number): string {
  if (value.length <= maximum) {
    return value;
  }
  const lines: string[] = [];
  let length = 0;
  for (const line of value.split("\n")) {
    const addition = line.length + (lines.length === 0 ? 0 : 1);
    if (length + addition > maximum) {
      break;
    }
    lines.push(line);
    length += addition;
  }
  return lines.join("\n");
}

export function buildCompactPersonaProjection(persona: string): string {
  const style = getStyleCard(persona);
  if (style == null) {
    return keepCompleteLines(
      `## Elected persona\nYou are ${persona}. Keep the response concise and conversational.`,
      CONTEXT_BUDGETS.persona,
    );
  }

  const blocks = [
    `## Elected persona: ${persona}`,
    `Summary: ${renderSummary(style.summary)}`,
    renderList("Voice", style.voice, 5),
    renderList("Style markers", style.style_markers, 6),
    renderList("Behavior", style.behaviors, 4),
    renderList("Humor and tone", style.humor_or_tone, 4),
    renderList("How to mimic", style.how_to_mimic, 5),
    renderList("Representative messages", style.sample_messages, 6),
    "Use this as behavioral evidence. Do not copy a sample verbatim. Authority, safety, typed contracts, and tool limits outrank persona style.",
  ].filter((block) => block.length > 0);

  return keepCompleteLines(blocks.join("\n\n"), CONTEXT_BUDGETS.persona);
}

export function buildConfiguredPersonaProjection(
  persona: string,
  enabled: boolean,
): string {
  return enabled ? buildCompactPersonaProjection(persona) : "";
}
