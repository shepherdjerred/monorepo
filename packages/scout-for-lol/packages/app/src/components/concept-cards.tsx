import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";

const CONCEPTS = [
  {
    title: "Player",
    body: "A person you track. A player can hold several Riot accounts and can be linked to a Discord user.",
  },
  {
    title: "Account",
    body: "One League account — a Riot ID (name#TAG) on a region. A player can have multiple.",
  },
  {
    title: "Subscription",
    body: "Posts a player's match reports into a channel. A player can post in more than one channel.",
  },
] as const;

/**
 * The player/account/subscription vocabulary cards, shared by the onboarding
 * concepts step and the Players tab explainer.
 */
export function ConceptCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CONCEPTS.map((concept) => (
        <Card key={concept.title}>
          <CardHeader className="p-4">
            <CardTitle className="text-base">{concept.title}</CardTitle>
            <CardDescription>{concept.body}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
