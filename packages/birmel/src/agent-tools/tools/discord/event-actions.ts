import {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  type Guild,
} from "discord.js";

type EventResult = {
  success: boolean;
  message: string;
  data?:
    | {
        id: string;
        name: string;
        description: string | null;
        scheduledStartTime: string;
        scheduledEndTime: string | null;
        status: string;
        userCount: number | null;
      }[]
    | { eventId: string }
    | { userId: string; username: string }[];
};

export async function handleListEvents(guild: Guild): Promise<EventResult> {
  const events = await guild.scheduledEvents.fetch();
  const eventList = events.map((event) => ({
    id: event.id,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduledStartAt?.toISOString() ?? "",
    scheduledEndTime: event.scheduledEndAt?.toISOString() ?? null,
    status: event.status.toString(),
    userCount: event.userCount,
  }));
  return {
    success: true,
    message: `Found ${String(eventList.length)} scheduled events`,
    data: eventList,
  };
}

export async function handleCreateEvent(
  guild: Guild,
  options: {
    name?: string;
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    description?: string;
    channelId?: string;
    location?: string;
  },
): Promise<EventResult> {
  const {
    name,
    scheduledStartTime,
    scheduledEndTime,
    description,
    channelId,
    location,
  } = options;
  if (
    name == null ||
    name.length === 0 ||
    scheduledStartTime == null ||
    scheduledStartTime.length === 0
  ) {
    return {
      success: false,
      message: "name and scheduledStartTime are required for creating an event",
    };
  }
  const entityType =
    channelId != null && channelId.length > 0
      ? GuildScheduledEventEntityType.Voice
      : GuildScheduledEventEntityType.External;
  const createOptions: Parameters<typeof guild.scheduledEvents.create>[0] = {
    name,
    scheduledStartTime: new Date(scheduledStartTime),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType,
  };
  if (description !== undefined) {
    createOptions.description = description;
  }
  if (scheduledEndTime !== undefined) {
    createOptions.scheduledEndTime = new Date(scheduledEndTime);
  }
  if (channelId !== undefined) {
    createOptions.channel = channelId;
  }
  if (location !== undefined && (channelId == null || channelId.length === 0)) {
    createOptions.entityMetadata = { location };
  }
  const event = await guild.scheduledEvents.create(createOptions);
  return {
    success: true,
    message: `Created event "${event.name}"`,
    data: { eventId: event.id },
  };
}

export async function handleModifyEvent(
  guild: Guild,
  options: {
    eventId?: string;
    name?: string;
    description?: string;
    scheduledStartTime?: string;
    scheduledEndTime?: string;
    location?: string;
  },
): Promise<EventResult> {
  const {
    eventId,
    name,
    description,
    scheduledStartTime,
    scheduledEndTime,
    location,
  } = options;
  if (eventId == null || eventId.length === 0) {
    return {
      success: false,
      message: "eventId is required for modifying an event",
    };
  }
  const event = await guild.scheduledEvents.fetch(eventId);
  const editOptions: Parameters<typeof event.edit>[0] = {};
  if (name !== undefined) {
    editOptions.name = name;
  }
  if (description !== undefined) {
    editOptions.description = description;
  }
  if (scheduledStartTime !== undefined) {
    editOptions.scheduledStartTime = new Date(scheduledStartTime);
  }
  if (scheduledEndTime !== undefined) {
    editOptions.scheduledEndTime = new Date(scheduledEndTime);
  }
  if (location !== undefined) {
    editOptions.entityMetadata = { location };
  }
  const hasChanges =
    name !== undefined ||
    description !== undefined ||
    scheduledStartTime !== undefined ||
    scheduledEndTime !== undefined ||
    location !== undefined;
  if (!hasChanges) {
    return { success: false, message: "No changes specified" };
  }
  await event.edit(editOptions);
  return { success: true, message: `Updated event "${event.name}"` };
}

export async function handleDeleteEvent(
  guild: Guild,
  eventId: string | undefined,
): Promise<EventResult> {
  if (eventId == null || eventId.length === 0) {
    return {
      success: false,
      message: "eventId is required for deleting an event",
    };
  }
  const event = await guild.scheduledEvents.fetch(eventId);
  const eventName = event.name;
  await event.delete();
  return { success: true, message: `Deleted event "${eventName}"` };
}

export async function handleGetEventUsers(
  guild: Guild,
  eventId: string | undefined,
  limit: number | undefined,
): Promise<EventResult> {
  if (eventId == null || eventId.length === 0) {
    return {
      success: false,
      message: "eventId is required for getting event users",
    };
  }
  const event = await guild.scheduledEvents.fetch(eventId);
  const subscribers = await event.fetchSubscribers({
    limit: limit ?? 100,
  });
  const userList = subscribers.map(
    (sub: { user: { id: string; username: string } }) => ({
      userId: sub.user.id,
      username: sub.user.username,
    }),
  );
  return {
    success: true,
    message: `Found ${String(userList.length)} interested users`,
    data: userList,
  };
}
