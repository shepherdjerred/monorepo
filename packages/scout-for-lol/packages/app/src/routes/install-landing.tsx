import { Link, useSearchParams } from "react-router-dom";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";

/**
 * Landing page Discord redirects to after the user adds the bot (the
 * registered `/app/installed` redirect URI). The wizard re-detects the new
 * guild on return, so this just confirms success and routes back into setup.
 */
export function InstallLanding() {
  const [params] = useSearchParams();
  const guildId = params.get("guild_id");

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Scout added 🎉</CardTitle>
          <CardDescription>
            {guildId === null
              ? "Scout was added to your server. Let's finish setting it up."
              : "Scout is now in your server. Let's finish setting it up."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/welcome">Continue setup</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
