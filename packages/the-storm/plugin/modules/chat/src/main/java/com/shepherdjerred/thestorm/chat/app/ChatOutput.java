package com.shepherdjerred.thestorm.chat.app;

/** Shows rendered lines to players. Implemented on Paper; main thread only. */
public interface ChatOutput {

  /** Shows a relayed Global line (MiniMessage) to every player who has Global shown. */
  void deliverExternal(String miniMessage);
}
