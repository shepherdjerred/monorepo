package com.shepherdjerred.thestorm.npcs.domain;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueNode;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueOption;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.MovementSettings;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Shared test values. */
public final class Fixtures {

  public static final String WORLD = "minecraft:overworld";

  /** Movement with round numbers: 0.2 b/t, arrive within 0.3, stuck after 10 ticks. */
  public static final MovementSettings MOVEMENT = new MovementSettings(0.2, 0.3, 10, 5, 2, 20, 40);

  private Fixtures() {}

  public static Spot spot(double x, double y, double z) {
    return new Spot(WORLD, new Vec3(x, y, z), Rotation.SOUTH);
  }

  public static Spot spot(double x, double y, double z, float yaw) {
    return new Spot(WORLD, new Vec3(x, y, z), new Rotation(yaw, 0));
  }

  public static NpcDefinition npc(String id) {
    return npc(id, Optional.empty());
  }

  public static NpcDefinition npc(String id, Optional<String> schedule) {
    return new NpcDefinition(
        id,
        "Name " + id,
        "Description",
        new Skin.Default(),
        spot(0.5, 64, 0.5, 90),
        NpcPose.STANDING,
        Set.of("role"),
        schedule,
        Optional.empty(),
        Optional.empty());
  }

  /** A node with options. */
  public static DialogueNode choices(String text, DialogueOption... options) {
    return new DialogueNode(text, Optional.empty(), List.of(options));
  }

  /** A node continuing to {@code next}. */
  public static DialogueNode then(String text, String next) {
    return new DialogueNode(text, Optional.of(next), List.of());
  }

  public static DialogueOption option(String label, OptionEffect effect) {
    return new DialogueOption(label, effect);
  }

  public static DialogueOption goTo(String node) {
    return option("To " + node, new OptionEffect.Goto(node));
  }

  public static DialogueOption close() {
    return option("Bye", new OptionEffect.Close());
  }

  public static DialogueGraph graph(String start, Map<String, DialogueNode> nodes) {
    return new DialogueGraph("test", "Title", start, nodes);
  }
}
