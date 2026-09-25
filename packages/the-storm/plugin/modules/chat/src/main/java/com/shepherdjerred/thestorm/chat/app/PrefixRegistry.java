package com.shepherdjerred.thestorm.chat.app;

/** Where the tracks module plugs player prefixes into chat. */
public interface PrefixRegistry {

  /** Uses {@code provider} for every chat line. Registered once; a second call throws. */
  void registerPrefixProvider(PrefixProvider provider);
}
