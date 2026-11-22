package com.shepherdjerred.thestorm.rwf.adapter.remote;

import java.net.URI;

/**
 * The managed {@code the-storm-rwf-killstreaks-enabled} flag: killstreak rewards, per player. The
 * identifier is checked against the shared flag inventory at build time.
 */
public final class FliptRwfKillstreaksGate {

  private static final String FLAG_KEY = "the-storm-rwf-killstreaks-enabled";

  private FliptRwfKillstreaksGate() {}

  /** The flag at {@code base} in {@code deployment}, evaluated in {@code world}. */
  public static FliptPlayerFlag create(URI base, String deployment, String world) {
    return new FliptPlayerFlag(base, deployment, world, FLAG_KEY);
  }
}
