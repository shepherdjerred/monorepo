package com.shepherdjerred.thestorm.chat.app;

/**
 * Where other modules plug into chat: who is in a membership channel (town, match team, the dead),
 * routers that redirect lines, and taps that hear them. Until a channel's membership is registered,
 * its command tells players it is not available. Every registration returns a {@link Subscription}
 * whose {@code cancel} undoes it, so a module that disables can register again when it enables.
 */
public interface ChannelRegistry {

  /**
   * Makes {@code channel}, a membership channel ({@code TOWN}, {@code TEAM} or {@code DEAD}),
   * available with {@code membership} deciding who hears it. One registration per channel at a
   * time; a second is a wiring bug and throws, as does a channel everyone or staff can reach.
   */
  Subscription registerMembership(ChatChannel channel, ChannelMembership membership);

  /** Makes town chat available; {@link #registerMembership} for {@code TOWN}. */
  default Subscription registerTownMembership(ChannelMembership membership) {
    return registerMembership(ChatChannel.TOWN, membership);
  }

  /** Adds a router, asked after every router registered before it. */
  Subscription registerRouter(ChannelRouter router);

  /** Adds a tap that hears every delivered channel line. */
  Subscription registerTap(ChatTap tap);
}
