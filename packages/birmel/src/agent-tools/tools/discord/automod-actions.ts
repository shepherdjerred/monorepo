import {
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
  type Guild,
} from "discord.js";

type AutomodResult = {
  success: boolean;
  message: string;
  data?:
    | { id: string; name: string; enabled: boolean; triggerType: string }[]
    | {
        id: string;
        name: string;
        enabled: boolean;
        triggerType: string;
        exemptRoles: string[];
        exemptChannels: string[];
      }
    | { id: string; name: string };
};

export async function handleListRules(guild: Guild): Promise<AutomodResult> {
  const rules = await guild.autoModerationRules.fetch();
  const ruleList = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    triggerType: AutoModerationRuleTriggerType[rule.triggerType],
  }));
  return {
    success: true,
    message: `Found ${String(ruleList.length)} auto-moderation rules`,
    data: ruleList,
  };
}

export async function handleGetRule(
  guild: Guild,
  ruleId: string | undefined,
): Promise<AutomodResult> {
  if (ruleId == null || ruleId.length === 0) {
    return {
      success: false,
      message: "ruleId is required for getting rule details",
    };
  }
  const rule = await guild.autoModerationRules.fetch(ruleId);
  return {
    success: true,
    message: `Found rule: ${rule.name}`,
    data: {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      triggerType: AutoModerationRuleTriggerType[rule.triggerType],
      exemptRoles: rule.exemptRoles.map((r) => r.id),
      exemptChannels: rule.exemptChannels.map((c) => c.id),
    },
  };
}

export async function handleCreateRule(
  guild: Guild,
  options: {
    name?: string;
    triggerType?: "KEYWORD" | "SPAM" | "KEYWORD_PRESET" | "MENTION_SPAM";
    keywords?: string[];
    keywordPresets?: ("PROFANITY" | "SEXUAL_CONTENT" | "SLURS")[];
    mentionLimit?: number;
    enabled?: boolean;
    reason?: string;
  },
): Promise<AutomodResult> {
  const {
    name,
    triggerType,
    keywords,
    keywordPresets,
    mentionLimit,
    enabled,
    reason,
  } = options;
  if (name == null || name.length === 0 || !triggerType) {
    return {
      success: false,
      message: "name and triggerType are required for creating a rule",
    };
  }
  const triggerTypeMap = {
    KEYWORD: AutoModerationRuleTriggerType.Keyword,
    SPAM: AutoModerationRuleTriggerType.Spam,
    KEYWORD_PRESET: AutoModerationRuleTriggerType.KeywordPreset,
    MENTION_SPAM: AutoModerationRuleTriggerType.MentionSpam,
  };
  const presetMap = {
    PROFANITY: 1,
    SEXUAL_CONTENT: 2,
    SLURS: 3,
  } as const;
  const rule = await guild.autoModerationRules.create({
    name,
    eventType: 1,
    triggerType: triggerTypeMap[triggerType],
    triggerMetadata: {
      ...(keywords != null && { keywordFilter: keywords }),
      ...(keywordPresets != null && {
        presets: keywordPresets.map(
          (p: "PROFANITY" | "SEXUAL_CONTENT" | "SLURS") => presetMap[p],
        ),
      }),
      ...(mentionLimit !== undefined && {
        mentionTotalLimit: mentionLimit,
      }),
    },
    actions: [{ type: AutoModerationActionType.BlockMessage }],
    ...(enabled !== undefined && { enabled }),
    ...(reason !== undefined && { reason }),
  });
  return {
    success: true,
    message: `Created auto-moderation rule: ${rule.name}`,
    data: { id: rule.id, name: rule.name },
  };
}

export async function handleModifyRule(
  guild: Guild,
  options: {
    ruleId?: string;
    name?: string;
    keywords?: string[];
    mentionLimit?: number;
    exemptRoles?: string[];
    exemptChannels?: string[];
    reason?: string;
  },
): Promise<AutomodResult> {
  const {
    ruleId,
    name,
    keywords,
    mentionLimit,
    exemptRoles,
    exemptChannels,
    reason,
  } = options;
  if (ruleId == null || ruleId.length === 0) {
    return {
      success: false,
      message: "ruleId is required for modifying a rule",
    };
  }
  const rule = await guild.autoModerationRules.fetch(ruleId);
  const editOptions: Parameters<typeof rule.edit>[0] = {};
  if (name !== undefined) {
    editOptions.name = name;
  }
  if (keywords !== undefined) {
    editOptions.triggerMetadata = { keywordFilter: keywords };
  }
  if (mentionLimit !== undefined) {
    editOptions.triggerMetadata = {
      ...editOptions.triggerMetadata,
      mentionTotalLimit: mentionLimit,
    };
  }
  if (exemptRoles !== undefined) {
    editOptions.exemptRoles = exemptRoles;
  }
  if (exemptChannels !== undefined) {
    editOptions.exemptChannels = exemptChannels;
  }
  if (reason !== undefined) {
    editOptions.reason = reason;
  }
  const hasChanges =
    name !== undefined ||
    keywords !== undefined ||
    mentionLimit !== undefined ||
    exemptRoles !== undefined ||
    exemptChannels !== undefined;
  if (!hasChanges) {
    return { success: false, message: "No changes specified" };
  }
  await rule.edit(editOptions);
  return {
    success: true,
    message: `Updated auto-moderation rule: ${rule.name}`,
  };
}

export async function handleDeleteRule(
  guild: Guild,
  ruleId: string | undefined,
  reason: string | undefined,
): Promise<AutomodResult> {
  if (ruleId == null || ruleId.length === 0) {
    return {
      success: false,
      message: "ruleId is required for deleting a rule",
    };
  }
  const rule = await guild.autoModerationRules.fetch(ruleId);
  const ruleName = rule.name;
  await rule.delete(reason);
  return {
    success: true,
    message: `Deleted auto-moderation rule: ${ruleName}`,
  };
}

export async function handleToggleRule(
  guild: Guild,
  ruleId: string | undefined,
  enabled: boolean | undefined,
  reason: string | undefined,
): Promise<AutomodResult> {
  if (ruleId == null || ruleId.length === 0) {
    return {
      success: false,
      message: "ruleId is required for toggling a rule",
    };
  }
  if (enabled === undefined) {
    return {
      success: false,
      message: "enabled is required for toggling a rule",
    };
  }
  const rule = await guild.autoModerationRules.fetch(ruleId);
  await rule.setEnabled(enabled, reason);
  return {
    success: true,
    message: `${enabled ? "Enabled" : "Disabled"} auto-moderation rule: ${rule.name}`,
  };
}
