import { useMutation } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Separator } from "@scout-for-lol/design-system/components/separator";
import { toast } from "@scout-for-lol/design-system/components/toaster";
import { ThemeMenu } from "@scout-for-lol/design-system/runtime/theme-menu";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
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
      await applySnapshot(() =>
        join.mutateAsync({
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
        <CardHeader className="relative pr-16">
          <CardTitle>Join {snapshot.guildName} customs</CardTitle>
          <CardDescription>
            Hi {session.identity.displayName}. Joining—not merely opening this
            Activity—records your consent.
          </CardDescription>
          <div className="activity-layout-theme absolute top-3 right-3">
            <ThemeMenu />
          </div>
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
          <p className="text-xs text-scout-subtle">
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
