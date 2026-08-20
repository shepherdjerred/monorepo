import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";
import { Skeleton } from "@scout-for-lol/design-system/components/skeleton";
import { toast } from "@scout-for-lol/design-system/components/toaster";
import { ThemeMenu } from "@scout-for-lol/design-system/runtime/theme-menu";
import { useEffect, useState } from "react";
import { CustomCreateNightInputSchema } from "@scout-for-lol/data";
import { useActivitySession } from "@/lib/activity-session";
import { useTRPC } from "@/lib/activity-api";
import {
  mutationErrorText,
  useApplyCustomSnapshot,
} from "@/hooks/use-custom-snapshot";

export function StartNight() {
  const session = useActivitySession();
  const trpc = useTRPC();
  const applySnapshot = useApplyCustomSnapshot();
  const voiceChannels = useQuery(trpc.customs.voiceChannels.queryOptions());
  const [voiceLobbyChannelId, setVoiceLobbyChannelId] = useState<string | null>(
    null,
  );
  const create = useMutation(trpc.customs.createNight.mutationOptions());

  useEffect(() => {
    if (voiceLobbyChannelId !== null || voiceChannels.data === undefined)
      return;
    const current = voiceChannels.data.find(
      (channel) => channel.id === session.channelId,
    );
    setVoiceLobbyChannelId(current?.id ?? voiceChannels.data[0]?.id ?? null);
  }, [session.channelId, voiceChannels.data, voiceLobbyChannelId]);

  const submit = async () => {
    const parsed = CustomCreateNightInputSchema.pick({
      guildId: true,
      voiceLobbyChannelId: true,
    }).safeParse({
      guildId: session.guildId,
      voiceLobbyChannelId,
    });
    if (!parsed.success) {
      toast.error("Choose the voice lobby everyone is gathering in.");
      return;
    }
    try {
      await applySnapshot(() => create.mutateAsync(parsed.data));
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="relative pr-16">
          <CardTitle>Start a custom night</CardTitle>
          <CardDescription>
            One shared night can hold several back-to-back games. Anyone in this
            allowlisted server may start it.
          </CardDescription>
          <div className="activity-layout-theme absolute top-3 right-3">
            <ThemeMenu />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed">
            Starting this night records your consent to store your selected
            League account, teams, captain status, champion, and result for this
            server&apos;s private Customs history. Scout does not produce MMR,
            Elo, rankings, or skill-based balancing.
          </p>
          {voiceChannels.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="grid gap-2 text-sm font-medium">
              <span id="voice-lobby-label">Voice lobby</span>
              <Select
                value={voiceLobbyChannelId ?? ""}
                onValueChange={setVoiceLobbyChannelId}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="voice-lobby-label"
                >
                  <SelectValue placeholder="Choose a voice channel" />
                </SelectTrigger>
                <SelectContent>
                  {(voiceChannels.data ?? []).map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            className="w-full"
            disabled={create.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {create.isPending ? "Starting…" : "Start night"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
