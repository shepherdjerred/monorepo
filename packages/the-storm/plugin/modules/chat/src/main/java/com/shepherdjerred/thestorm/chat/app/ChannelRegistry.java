package com.shepherdjerred.thestorm.chat.app;

/**
 * Where the towns module plugs town membership into chat. Until it does, {@code /tc} tells players
 * towns are not available.
 */
public interface ChannelRegistry {

  /**
   * Makes town chat available, with {@code membership} deciding who hears it. Registered once; a
   * second registration is a wiring bug and throws.
   */
  void registerTownMembership(ChannelMembership membership);
}
