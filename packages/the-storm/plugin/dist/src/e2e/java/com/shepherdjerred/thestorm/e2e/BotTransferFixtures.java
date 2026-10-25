package com.shepherdjerred.thestorm.e2e;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import tools.jackson.databind.json.JsonMapper;

/** Exercises the production body transfer port; available only in the disposable fixtures jar. */
final class BotTransferFixtures implements BasicCommand {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final JavaPlugin plugin;

  BotTransferFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-bot-transfer", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender)
        && !(source.getSender() instanceof RemoteConsoleCommandSender)) {
      throw new IllegalArgumentException("bot transfer fixtures require the disposable console");
    }
    if (args.length != 1) {
      throw new IllegalArgumentException("use storm-fixture-bot-transfer <live bot name>");
    }
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm)) {
      throw new IllegalStateException("TheStorm missing");
    }
    var match = storm.service(MatchView.class).current().orElseThrow();
    var id =
        match.combatants().stream()
            .filter(fighter -> fighter.name().equals(args[0]))
            .map(fighter -> fighter.id())
            .filter(CombatantId.Bot.class::isInstance)
            .map(CombatantId.Bot.class::cast)
            .findFirst()
            .orElseThrow();
    var roster = storm.service(BotRoster.class);
    var before = roster.entity(id).orElseThrow();
    if (before.isMarkedInvulnerable()) {
      throw new IllegalStateException("live bot is invulnerable before transfer");
    }
    // Exercise state MockBukkit does not implement, including a nonzero hit window and item
    // metadata.
    var sentinel = ItemStack.of(Material.DIAMOND, 7);
    sentinel.editMeta(meta -> meta.customName(Component.text("RWF transfer sentinel")));
    before.getInventory().setItem(8, sentinel);
    before.setFoodLevel(17);
    before.setSaturation(3);
    before.setExhaustion(2);
    before.setNoDamageTicks(9);
    before.setLastDamage(2.9);
    requireNonNull(before.getAttribute(Attribute.ATTACK_SPEED)).setBaseValue(7);
    before.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 100, 1));
    var state = State.capture(before);
    var origin = before.getLocation();
    var lobby = requireNonNull(plugin.getServer().getWorld("rwf_lobby"));
    var waiting = roster.move(id, new Location(lobby, 60.5, 70, 50.5));
    verify(before, waiting, state);
    var returned = roster.move(id, origin);
    verify(waiting, returned, state);
    if (!roster.isBot(id.uuid())
        || roster.entity(id).orElseThrow().getEntityId() != returned.getEntityId()) {
      throw new IllegalStateException("body transfer lost its roster registration");
    }
    source
        .getSender()
        .sendMessage(
            Component.text(
                JSON.writeValueAsString(
                    Map.of(
                        "uuid", id.uuid(),
                        "entities",
                            List.of(
                                before.getEntityId(),
                                waiting.getEntityId(),
                                returned.getEntityId()),
                        "health", returned.getHealth(),
                        "invulnerable", returned.isMarkedInvulnerable(),
                        "equipmentPreserved", true,
                        "registered", true))));
  }

  private static void verify(Player before, Player after, State state) {
    if (before.getEntityId() == after.getEntityId()
        || !before.getUniqueId().equals(after.getUniqueId())
        || !after.isValid()
        || after.isMarkedInvulnerable()
        || !state.equals(State.capture(after))) {
      throw new IllegalStateException("body transfer changed identity, gear, vitals or flags");
    }
  }

  private record State(
      List<Byte> inventory,
      int slot,
      double health,
      double absorption,
      int food,
      float saturation,
      float exhaustion,
      int noDamageTicks,
      double lastDamage,
      List<PotionEffect> effects,
      String mode,
      boolean collidable,
      boolean flight,
      double attackSpeed,
      double maxHealth) {
    static State capture(Player player) {
      var bytes =
          ItemStack.serializeItemsAsBytes(
              Arrays.stream(player.getInventory().getContents())
                  .map(item -> item == null ? ItemStack.empty() : item)
                  .toArray(ItemStack[]::new));
      var inventory = new java.util.ArrayList<Byte>(bytes.length);
      for (var value : bytes) inventory.add(value);
      return new State(
          List.copyOf(inventory),
          player.getInventory().getHeldItemSlot(),
          player.getHealth(),
          player.getAbsorptionAmount(),
          player.getFoodLevel(),
          player.getSaturation(),
          player.getExhaustion(),
          player.getNoDamageTicks(),
          player.getLastDamage(),
          List.copyOf(player.getActivePotionEffects()),
          player.getGameMode().name(),
          player.isCollidable(),
          player.getAllowFlight(),
          requireNonNull(player.getAttribute(Attribute.ATTACK_SPEED)).getValue(),
          requireNonNull(player.getAttribute(Attribute.MAX_HEALTH)).getValue());
    }
  }
}
