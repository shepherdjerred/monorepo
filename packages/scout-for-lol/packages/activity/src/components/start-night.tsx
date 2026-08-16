import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CustomCreateNightInputSchema } from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
      const result = await create.mutateAsync(parsed.data);
      applySnapshot(result);
    } catch (error) {
      toast.error(mutationErrorText(error));
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Start a custom night</CardTitle>
          <CardDescription>
            One shared night can hold several back-to-back games. Anyone in this
            allowlisted server may start it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {voiceChannels.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="grid gap-2 text-sm font-medium">
              <span id="voice-lobby-label">Voice lobby</span>
              <Select
                value={voiceLobbyChannelId}
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
