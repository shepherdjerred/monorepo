package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;

/**
 * One row of {@code /channels}.
 *
 * @param channel the channel
 * @param access whether the player may talk there
 * @param focused whether plain chat goes there
 * @param hidden whether the player hid it
 */
public record ChannelStatus(
    ChannelKey channel, ChannelAccess access, boolean focused, boolean hidden) {}
