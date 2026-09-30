package com.shepherdjerred.thestorm.chat.app;

/** A registered {@link GlobalChat} listener. */
@FunctionalInterface
public interface Subscription {

  /** Stops delivering lines to the listener. */
  void cancel();
}
