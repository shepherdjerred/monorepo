package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.shepherdjerred.mcbridge.domain.SessionName;
import com.sk89q.worldedit.EditSession;
import com.sk89q.worldedit.LocalSession;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.event.extent.EditSessionEvent;
import com.sk89q.worldedit.util.eventbus.Subscribe;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One {@link AgentActor} per session name, with its WorldEdit {@link LocalSession}. Counts edits by
 * listening for each actor's edit sessions, since WorldEdit exposes no history size.
 */
public final class AgentSessions {
  private final Map<SessionName, AgentActor> actors = new ConcurrentHashMap<>();

  /** Starts counting edits on WorldEdit's event bus. */
  public void register() {
    WorldEdit.getInstance().getEventBus().register(this);
  }

  /** Stops counting and forgets every session. */
  public void unregister() {
    WorldEdit.getInstance().getEventBus().unregister(this);
    actors.values().forEach(actor -> WorldEdit.getInstance().getSessionManager().remove(actor));
    actors.clear();
  }

  /** The actor for a session name, created on first use. */
  public AgentActor actor(SessionName name) {
    return actors.computeIfAbsent(name, AgentActor::new);
  }

  /** The WorldEdit session of an actor. */
  public LocalSession session(AgentActor actor) {
    return WorldEdit.getInstance().getSessionManager().get(actor);
  }

  /**
   * Counts one history entry per edit session an agent actor opens, and wraps the world-facing end
   * of the extent chain to count blocks that really change.
   */
  @Subscribe
  public void onEditSession(EditSessionEvent event) {
    if (event.getStage() == EditSession.Stage.BEFORE_CHANGE
        && event.getActor() instanceof AgentActor actor) {
      actor.recordEdit(LocalSession.MAX_HISTORY_SIZE);
      event.setExtent(new CountingExtent(event.getExtent(), actor::recordChanged));
    }
  }
}
