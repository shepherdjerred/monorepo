package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import java.util.function.IntConsumer;
import org.bukkit.entity.Player;

/** Shows screens to players; the Paper adapter renders them with the Dialog API. Main thread. */
public interface DialogPresenter {

  /**
   * Shows {@code screen} to {@code player}. When they press a button, {@code onClick} receives its
   * index on the main thread (possibly more than once; the caller de-duplicates).
   */
  void show(Player player, Screen screen, IntConsumer onClick);

  /** Closes whatever dialog {@code player} has open. */
  void close(Player player);
}
