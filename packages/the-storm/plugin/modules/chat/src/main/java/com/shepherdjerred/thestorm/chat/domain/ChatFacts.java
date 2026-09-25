package com.shepherdjerred.thestorm.chat.domain;

import org.jspecify.annotations.Nullable;

/**
 * What the rules need to know about the speaker beyond the message itself.
 *
 * @param access whether they may use the channel
 * @param mute their staff mute, active or not, if any
 * @param last the last message they sent, if any
 */
public record ChatFacts(ChannelAccess access, @Nullable Mute mute, @Nullable RecentMessage last) {}
