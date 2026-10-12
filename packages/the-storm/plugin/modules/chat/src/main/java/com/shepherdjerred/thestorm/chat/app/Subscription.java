package com.shepherdjerred.thestorm.chat.app;

/**
 * A registration that can be undone: a {@link GlobalChat} listener, or a membership, router or tap
 * registered through {@link ChannelRegistry}.
 */
@FunctionalInterface
public interface Subscription {

  /** Undoes the registration. Cancelling twice is harmless. */
  void cancel();
}
