package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.DialogueCheck;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/** The {@link NpcActions} registry. */
public final class ActionRegistry implements NpcActions {

  private final Map<String, NpcAction> actions = new LinkedHashMap<>();

  @Override
  public void register(String id, NpcAction action) {
    if (!DialogueCheck.ACTION_ID.matcher(id).matches()) {
      throw new IllegalArgumentException("NPC action ids are <module>.<name>: " + id);
    }
    var previous = actions.putIfAbsent(id, action);
    if (previous != null) {
      throw new IllegalStateException("NPC action " + id + " is already registered");
    }
  }

  @Override
  public Set<String> ids() {
    return Set.copyOf(actions.keySet());
  }

  public Optional<NpcAction> find(String id) {
    return Optional.ofNullable(actions.get(id));
  }

  /** Action ids that {@code dialogues} use but nobody registered, sorted. */
  public Set<String> missing(Collection<DialogueGraph> dialogues) {
    var missing = new TreeSet<String>();
    for (var graph : dialogues) {
      for (var node : graph.nodes().values()) {
        for (var option : node.options()) {
          if (option.effect() instanceof OptionEffect.RunAction(var action)
              && !actions.containsKey(action)) {
            missing.add(action);
          }
        }
      }
    }
    return missing;
  }
}
