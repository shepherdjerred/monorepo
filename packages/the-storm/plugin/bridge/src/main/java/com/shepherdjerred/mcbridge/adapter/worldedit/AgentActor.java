package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.shepherdjerred.mcbridge.domain.MessageLog;
import com.shepherdjerred.mcbridge.domain.SessionName;
import com.sk89q.worldedit.extension.platform.AbstractNonPlayerActor;
import com.sk89q.worldedit.session.SessionKey;
import com.sk89q.worldedit.util.auth.AuthorizationException;
import com.sk89q.worldedit.util.formatting.WorldEditText;
import com.sk89q.worldedit.util.formatting.text.Component;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The synthetic WorldEdit actor {@code agent:<session>}: every permission, a stable identity per
 * session name, and captured output instead of a chat window.
 */
public final class AgentActor extends AbstractNonPlayerActor {
  private static final Locale LOCALE = Locale.US;

  private final SessionName session;
  private final UUID uuid;
  private final MessageLog log = new MessageLog();
  private final AtomicInteger history = new AtomicInteger();
  private final AtomicBoolean undoing = new AtomicBoolean();
  private final AtomicInteger changed = new AtomicInteger();

  public AgentActor(SessionName session) {
    this.session = session;
    this.uuid = UUID.nameUUIDFromBytes(session.actorName().getBytes(StandardCharsets.UTF_8));
  }

  /** Output captured since the last {@link MessageLog#clear()}. */
  public MessageLog log() {
    return log;
  }

  /** Edits recorded for this actor that have not been undone (see {@code historySize}). */
  public int historySize() {
    return history.get();
  }

  void recordEdit(int cap) {
    if (!undoing.get()) {
      history.updateAndGet(size -> Math.min(cap, size + 1));
    }
  }

  /** Starts counting changed blocks for one operation. */
  void resetChanged() {
    changed.set(0);
  }

  /** Blocks whose state changed since {@link #resetChanged()}. */
  int changed() {
    return changed.get();
  }

  void recordChanged(int blocks) {
    changed.addAndGet(blocks);
  }

  /** Marks an undo in progress: its own edit sessions are not new history entries. */
  void beginUndo() {
    undoing.set(true);
  }

  /** Ends an undo that reverted {@code steps} history entries. */
  void endUndo(int steps) {
    undoing.set(false);
    history.updateAndGet(size -> Math.max(0, size - steps));
  }

  @Override
  public String getName() {
    return session.actorName();
  }

  @Override
  public UUID getUniqueId() {
    return uuid;
  }

  @Override
  public Locale getLocale() {
    return LOCALE;
  }

  /**
   * Captures legacy string output.
   *
   * @deprecated WorldEdit deprecates string output; still required by {@code Actor}
   */
  @Deprecated
  @Override
  public void printRaw(String message) {
    log.message(message);
  }

  /**
   * Captures legacy string output.
   *
   * @deprecated WorldEdit deprecates string output; still required by {@code Actor}
   */
  @Deprecated
  @Override
  public void printDebug(String message) {
    log.message(message);
  }

  /**
   * Captures legacy string output.
   *
   * @deprecated WorldEdit deprecates string output; still required by {@code Actor}
   */
  @Deprecated
  @Override
  public void print(String message) {
    log.message(message);
  }

  /**
   * Captures legacy string output.
   *
   * @deprecated WorldEdit deprecates string output; still required by {@code Actor}
   */
  @Deprecated
  @Override
  public void printError(String message) {
    log.error(message);
  }

  @Override
  public void print(Component component) {
    log.message(text(component));
  }

  @Override
  public void printError(Component component) {
    log.error(text(component));
  }

  @Override
  public void printInfo(Component component) {
    log.message(text(component));
  }

  @Override
  public void printDebug(Component component) {
    log.message(text(component));
  }

  @Override
  public String[] getGroups() {
    return new String[0];
  }

  @Override
  public void checkPermission(String permission) throws AuthorizationException {
    // The bearer token already authorized the caller for every WorldEdit operation.
  }

  @Override
  public boolean hasPermission(String permission) {
    return true;
  }

  @Override
  public SessionKey getSessionKey() {
    return new SessionKey() {
      @Override
      public UUID getUniqueId() {
        return uuid;
      }

      @Override
      public String getName() {
        return session.actorName();
      }

      @Override
      public boolean isActive() {
        return true;
      }

      @Override
      public boolean isPersistent() {
        return false;
      }
    };
  }

  private static String text(Component component) {
    return WorldEditText.reduceToText(component, LOCALE);
  }
}
