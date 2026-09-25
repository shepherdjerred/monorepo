package com.shepherdjerred.thestorm.chat.domain;

import org.jspecify.annotations.Nullable;

/**
 * What the rules need to know about the speaker beyond the message itself.
 *
 * @param mute their staff mute, active or not, if any
 * @param last the last message they sent, if any
 */
public record ChatFacts(@Nullable Mute mute, @Nullable RecentMessage last) {

  /** A speaker with no mute and no earlier message. */
  public static final ChatFacts NONE = new ChatFacts(null, null);
}
