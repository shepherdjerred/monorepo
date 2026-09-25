package com.shepherdjerred.thestorm.discord.app;

import java.util.List;

/** The names of the players online. Main thread only. */
@FunctionalInterface
public interface OnlinePlayers {

  List<String> names();
}
