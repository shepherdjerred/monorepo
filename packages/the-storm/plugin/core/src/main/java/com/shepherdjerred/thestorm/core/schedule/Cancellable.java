package com.shepherdjerred.thestorm.core.schedule;

/** A handle to a scheduled task. */
@FunctionalInterface
public interface Cancellable {

  void cancel();
}
