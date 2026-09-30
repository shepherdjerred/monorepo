package com.shepherdjerred.thestorm.arena.domain.game;

import java.util.Set;

/**
 * Every announcement the arena makes, whether it is good or bad news, and the placeholders its
 * message may use. The wording lives in {@code arena.yml}.
 */
public enum NoticeKind {
  JOINED(Mood.NEUTRAL, "player", "arena"),
  LEFT(Mood.NEUTRAL, "player"),
  SPECTATING(Mood.NEUTRAL, "arena"),
  CLASS_PICKED(Mood.GOOD, "class"),
  READY(Mood.GOOD, "player"),
  COUNTDOWN(Mood.NEUTRAL, "seconds"),
  COUNTDOWN_CANCELLED(Mood.BAD),
  GAME_STARTED(Mood.NEUTRAL, "arena", "tier", "waves"),
  WAVE_STARTED(Mood.NEUTRAL, "wave"),
  SWARM_WAVE(Mood.NEUTRAL, "wave"),
  CAVALRY_WAVE(Mood.NEUTRAL, "wave"),
  BOSS_WAVE(Mood.NEUTRAL, "wave", "boss"),
  UPGRADE_WAVE(Mood.NEUTRAL, "wave"),
  WAVE_CLEARED(Mood.GOOD, "wave"),
  REWARD(Mood.GOOD, "amount", "wave"),
  VAULT_OPENED(Mood.GOOD, "wave"),
  VAULT_ALREADY_OPENED(Mood.NEUTRAL, "wave"),
  VAULT_DELIVERED(Mood.GOOD),
  DIED(Mood.BAD, "player", "wave"),
  VICTORY(Mood.GOOD, "arena", "wave"),
  DEFEAT(Mood.BAD, "arena", "wave"),
  REMOVED_WITHOUT_CLASS(Mood.BAD),
  STARTED_WITHOUT_YOU(Mood.BAD),
  HEART_BROKEN(Mood.GOOD, "boss"),
  BOSS_DEFEATED(Mood.GOOD, "boss"),
  RESTORED(Mood.GOOD);

  /** Whether an announcement is good news, bad news or neither; it sets the message's color. */
  public enum Mood {
    GOOD,
    BAD,
    NEUTRAL,
  }

  private final Mood mood;

  /** The placeholders, joined by spaces: enum fields must be immutable. */
  private final String placeholders;

  NoticeKind(Mood mood, String... placeholders) {
    this.mood = mood;
    this.placeholders = String.join(" ", placeholders);
  }

  public Mood mood() {
    return mood;
  }

  /** The placeholders (without braces) this announcement's message may use. */
  public Set<String> placeholders() {
    return placeholders.isEmpty() ? Set.of() : Set.of(placeholders.split(" "));
  }
}
