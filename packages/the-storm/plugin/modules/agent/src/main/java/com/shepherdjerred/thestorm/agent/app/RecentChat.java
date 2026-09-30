package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

/**
 * The agent's short memory: the newest chat lines, for pre-filter windows and brain context. Every
 * Global line lands here; callers read slices back newest first. Thread-safe: chat arrives off the
 * main thread while flows read from wherever they run.
 */
public final class RecentChat {

  /** The most lines kept. */
  static final int CAPACITY = 500;

  private final Deque<ChatLine> lines = new ArrayDeque<>();

  /** Remembers {@code line}, dropping the oldest past capacity. */
  public synchronized void record(ChatLine line) {
    lines.addFirst(line);
    while (lines.size() > CAPACITY) {
      lines.removeLast();
    }
  }

  /** The newest {@code limit} lines, newest first. */
  public synchronized List<ChatLine> last(int limit) {
    return lines.stream().limit(limit).toList();
  }

  /** {@code player}'s newest {@code limit} lines, newest first. */
  public synchronized List<ChatLine> lastBy(UUID player, int limit) {
    List<ChatLine> mine = new ArrayList<>();
    for (var line : lines) {
      if (mine.size() >= limit) {
        break;
      }
      if (line.author() instanceof ChatAuthor.InGame(var id, _) && id.equals(player)) {
        mine.add(line);
      }
    }
    return List.copyOf(mine);
  }
}
