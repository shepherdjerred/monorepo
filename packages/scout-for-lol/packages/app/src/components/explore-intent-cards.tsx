import { useMemo } from "react";
import type { ExploreTraceEntry } from "@scout-for-lol/data";
import { ExploreCreationIntentCard } from "#src/components/explore-creation-intent-card.tsx";
import {
  ExploreDareDraftCard,
  ExploreDareIntentCard,
} from "#src/components/explore-dare-intent-card.tsx";
import {
  intentCardKey,
  intentCardsFromTrace,
  type IntentCard,
} from "#src/lib/explore-intent-cards.ts";

/**
 * Every actionable card a turn produced, in the order the agent produced them.
 *
 * Rendered only for the person who owns the conversation: a shared or
 * published transcript passes no `showRawTrace`, so a reader who is not the
 * actor is never offered a confirm button they could not perform anyway.
 */

function IntentCardBody(props: { card: IntentCard }) {
  switch (props.card.kind) {
    case "dare_draft":
      return <ExploreDareDraftCard draft={props.card.data} />;
    case "dare_intent":
      return <ExploreDareIntentCard intent={props.card.data} />;
    case "creation_intent":
      return <ExploreCreationIntentCard intent={props.card.data} />;
  }
}

export function ExploreIntentCards(props: { trace: ExploreTraceEntry[] }) {
  const cards = useMemo(() => intentCardsFromTrace(props.trace), [props.trace]);
  if (cards.length === 0) return null;
  return (
    <div className="space-y-3" aria-label="Explore actions">
      {cards.map((card) => (
        <IntentCardBody key={intentCardKey(card)} card={card} />
      ))}
    </div>
  );
}
