import {
  DiscordSDK,
  Events,
  type EventPayloadData,
} from "@discord/embedded-app-sdk";

export type ActivityLayoutMode = -1 | 0 | 1 | 2;

export type ActivityIdentity = {
  id: string;
  displayName: string;
  avatar: string | null;
};

export type ActivitySdkAdapter = {
  clientId: string;
  instanceId: string;
  guildId: string | null;
  channelId: string | null;
  ready: () => Promise<void>;
  authorize: () => Promise<string>;
  authenticate: (accessToken: string) => Promise<ActivityIdentity>;
  invite: () => Promise<void>;
  setReadyPresence: (ready: number) => Promise<void>;
  connectedParticipantCount: () => Promise<number>;
  subscribeLayout: (
    listener: (layoutMode: ActivityLayoutMode) => void,
  ) => Promise<() => Promise<void>>;
  subscribeParticipants: (
    listener: (count: number) => void,
  ) => Promise<() => Promise<void>>;
};

declare global {
  var scoutCustomsSdkAdapter: ActivitySdkAdapter | undefined;
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  return avatar === null
    ? null
    : `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;
}

export function createDiscordSdkAdapter(clientId: string): ActivitySdkAdapter {
  const injected = globalThis.scoutCustomsSdkAdapter;
  if (injected !== undefined) return injected;

  const sdk = new DiscordSDK(clientId);
  const layoutListeners = new Map<
    (layoutMode: ActivityLayoutMode) => void,
    (event: EventPayloadData<Events.ACTIVITY_LAYOUT_MODE_UPDATE>) => void
  >();
  const participantListeners = new Map<
    (count: number) => void,
    (
      event: EventPayloadData<Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE>,
    ) => void
  >();

  return {
    clientId,
    instanceId: sdk.instanceId,
    guildId: sdk.guildId,
    channelId: sdk.channelId,
    ready: async () => {
      await sdk.ready();
    },
    authorize: async () => {
      const response = await sdk.commands.authorize({
        client_id: clientId,
        response_type: "code",
        scope: ["identify", "rpc.activities.write"],
      });
      return response.code;
    },
    authenticate: async (accessToken) => {
      const response = await sdk.commands.authenticate({
        access_token: accessToken,
      });
      return {
        id: response.user.id,
        displayName: response.user.global_name ?? response.user.username,
        avatar: avatarUrl(response.user.id, response.user.avatar ?? null),
      };
    },
    invite: async () => {
      await sdk.commands.openInviteDialog();
    },
    setReadyPresence: async (ready) => {
      await sdk.commands.setActivity({
        activity: {
          type: 0,
          details: "Scout Customs",
          state: `${ready.toString()}/10 ready`,
          party: { id: sdk.instanceId, size: [ready, 10] },
          instance: true,
        },
      });
    },
    connectedParticipantCount: async () => {
      const response =
        await sdk.commands.getActivityInstanceConnectedParticipants();
      return response.participants.length;
    },
    subscribeLayout: async (listener) => {
      const sdkListener = (
        event: EventPayloadData<Events.ACTIVITY_LAYOUT_MODE_UPDATE>,
      ) => {
        listener(event.layout_mode);
      };
      layoutListeners.set(listener, sdkListener);
      await sdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, sdkListener);
      return async () => {
        const registered = layoutListeners.get(listener);
        if (registered !== undefined) {
          await sdk.unsubscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, registered);
          layoutListeners.delete(listener);
        }
      };
    },
    subscribeParticipants: async (listener) => {
      const sdkListener = (
        event: EventPayloadData<Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE>,
      ) => {
        listener(event.participants.length);
      };
      participantListeners.set(listener, sdkListener);
      await sdk.subscribe(
        Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
        sdkListener,
      );
      return async () => {
        const registered = participantListeners.get(listener);
        if (registered !== undefined) {
          await sdk.unsubscribe(
            Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
            registered,
          );
          participantListeners.delete(listener);
        }
      };
    },
  };
}
