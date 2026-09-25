package com.shepherdjerred.thestorm.chat.app;

/**
 * Where the towns module plugs town and nation membership into chat. Until a channel has a
 * membership, {@code /tc} and {@code /nc} tell players towns are not available.
 */
public interface ChannelRegistry {

  /**
   * Makes {@code channel} available, with {@code membership} deciding who hears it. Each channel is
   * registered once; a second registration is a wiring bug and throws.
   */
  void registerMembership(GroupChannel channel, ChannelMembership membership);
}
