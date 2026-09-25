package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import java.util.Map;
import java.util.UUID;

/**
 * Everything chat stores, as loaded at enable.
 *
 * @param profiles the players who changed a preference
 * @param mutes mutes that had not ended at load time
 */
public record ChatSnapshot(Map<UUID, ChatProfile> profiles, Map<UUID, Mute> mutes) {

  public ChatSnapshot {
    profiles = Map.copyOf(profiles);
    mutes = Map.copyOf(mutes);
  }
}
