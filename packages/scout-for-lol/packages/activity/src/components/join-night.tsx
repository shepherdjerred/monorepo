import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

export function JoinNight({ snapshot }: { snapshot: CustomNightSnapshot }) {
  const session = useActivitySession();
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const join = useMutation(trpc.customs.join.mutationOptions());
  const submit = async () => {
    try {
      applySnapshot(
        await join.mutateAsync({
          nightId: snapshot.id,
          expectedRevision: snapshot.revision,
        }),
      );
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Join {snapshot.guildName} customs</CardTitle>
          <CardDescription>
            Hi {session.identity.displayName}. Joining—not merely opening this
            Activity—records your consent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <p>
            Scout stores your selected League account, teams, captain status,
            champion, and result for this server’s private Customs history. It
            does not produce MMR, Elo, rankings, or skill-based balancing.
          </p>
          <p>
            There is no self-service revocation control. A Scout operator can
            delete or anonymize your Customs records on request.
          </p>
          <Separator />
          <p className="text-xs text-activity-muted-ink">
            Scout Customs isn’t endorsed by Riot Games and doesn’t reflect the
            views or opinions of Riot Games or anyone officially involved in
            producing or managing Riot Games properties. Riot Games, and all
            associated properties are trademarks or registered trademarks of
            Riot Games, Inc.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={join.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {join.isPending ? "Joining…" : "Accept and join night"}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
