package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.MembershipService;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.town.CampPolicy;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;

/** {@code /camp}: the first home, before a public town. */
final class CampCommands {

  static final String DELETED =
      "The camp was deleted. Its land is wilderness again. Locked containers stay locked.";

  private final TownService towns;
  private final TownsState state;
  private final MembershipService members;
  private final Names names;
  private final TownCommands.Services runtime;
  private final GovernorLevels levels;
  private final CampPolicy policy;
  private final InstantSource time;
  private final CampLife life;

  record Parts(
      TownService towns,
      TownsState state,
      MembershipService members,
      Names names,
      TownCommands.Services runtime,
      GovernorLevels levels,
      CampPolicy policy,
      InstantSource time,
      CampLife life) {}

  CampCommands(Parts parts) {
    this.towns = parts.towns();
    this.state = parts.state();
    this.members = parts.members();
    this.names = parts.names();
    this.runtime = parts.runtime();
    this.levels = parts.levels();
    this.policy = parts.policy();
    this.time = parts.time();
    this.life = parts.life();
  }

  void register(Commands commands) {
    commands.register(camp(), "Creates and runs your camp, the usual first home");
  }

  private LiteralCommandNode<CommandSourceStack> camp() {
    return Commands.literal("camp")
        .executes(context -> TownCommands.asPlayer(context, this::status))
        .then(
            Commands.literal("help")
                .executes(context -> TownCommands.asPlayer(context, this::help)))
        .then(
            Commands.literal("create")
                .executes(context -> TownCommands.asPlayer(context, this::create)))
        .then(invite())
        .then(join())
        .then(
            Commands.literal("leave")
                .executes(context -> TownCommands.asPlayer(context, this::leave)))
        .then(kick())
        .then(
            Commands.literal("delete")
                .executes(context -> TownCommands.asPlayer(context, player -> delete(player, "")))
                .then(
                    Commands.argument("confirm", word())
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context,
                                    player -> delete(player, getString(context, "confirm"))))))
        .then(
            Commands.literal("graduate")
                .then(
                    Commands.argument("name", word())
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context,
                                    player -> graduate(player, getString(context, "name"))))))
        .build();
  }

  private com.mojang.brigadier.builder.LiteralArgumentBuilder<CommandSourceStack> invite() {
    return Commands.literal("invite")
        .then(
            Commands.argument(TownCommands.PLAYER, word())
                .suggests(TownCommands::suggestOnline)
                .executes(
                    context ->
                        TownCommands.asPlayer(
                            context,
                            player ->
                                names.resolve(
                                    player,
                                    getString(context, TownCommands.PLAYER),
                                    target -> invite(player, target)))));
  }

  private com.mojang.brigadier.builder.LiteralArgumentBuilder<CommandSourceStack> kick() {
    return Commands.literal("kick")
        .then(
            Commands.argument(TownCommands.PLAYER, word())
                .suggests(TownCommands::suggestOnline)
                .executes(
                    context ->
                        TownCommands.asPlayer(
                            context,
                            player ->
                                names.resolve(
                                    player,
                                    getString(context, TownCommands.PLAYER),
                                    target -> kick(player, target)))));
  }

  private com.mojang.brigadier.builder.LiteralArgumentBuilder<CommandSourceStack> join() {
    return Commands.literal("join")
        .then(
            Commands.argument("owner", word())
                .executes(
                    context ->
                        TownCommands.asPlayer(
                            context, player -> join(player, getString(context, "owner")))));
  }

  private void status(Player player) {
    var holding = state.townOf(player.getUniqueId());
    if (holding.isEmpty()) {
      player.sendMessage(
          Notices.info(
              "You have no camp. Place a bed, or a chest and a door, and one is created for you."
                  + " Or run /camp create. /camp help explains the rest."));
      return;
    }
    var town = holding.get();
    if (!town.isCamp()) {
      player.sendMessage(
          Notices.info("You are in the town " + town.name() + ". Camps are the first home."));
      return;
    }
    var lapse = town.lastActive().orElseGet(town::createdAt).plus(policy.idle());
    var days = Duration.between(time.instant(), lapse).toDays();
    player.sendMessage(
        Notices.info(
            "Your camp has "
                + town.members().size()
                + "/"
                + policy.members()
                + " members and "
                + state.claimCount(town.id())
                + "/"
                + policy.chunks()
                + " chunks. It stays while a member is seen. About "
                + Math.max(0, days)
                + " days remain. /camp help explains it."));
  }

  private void help(Player player) {
    String[] lines = {
      "A camp is the usual first home. Anyone can make one. It has no public name and costs"
          + " nothing. A town is the later, public step.",
      "Start building and a camp can appear on its own: a bed, or a chest and a door, claims that"
          + " chunk at once. "
          + policy.settleBlocks()
          + " solid blocks count after "
          + policy.settleStayMinutes()
          + " minutes in that chunk or a neighbor. It also sets your default home if you have"
          + " none.",
      "Or run /camp create, stand in the chunk, and /claim. A camp holds "
          + policy.chunks()
          + " chunks in one connected shape. The next chunk must share a full edge. Corners do not"
          + " count. /unclaim cannot split the shape.",
      "/claim personal keeps the chunk you stand in for you. Other members, including the owner,"
          + " cannot build, open containers, or use animals there. /claim shared opens it to the"
          + " camp. The owner can still unclaim it and change flags.",
      "Outsiders cannot build, open containers, or harm animals. Explosions, fire spread, and mob"
          + " grief stay off. Containers lock when you place them. PvP stays on.",
      "The owner invites with /camp invite. A player joins with /camp join <owner>. Up to "
          + policy.members()
          + " people, including the owner. Any member can /claim. The owner kicks and deletes."
          + " Leaving or being kicked returns your personal chunks to the camp.",
      "Any member online keeps the camp. After "
          + policy.idleDays()
          + " days with nobody seen, the camp is removed and its chunks become wilderness. Blocks"
          + " stay. Locked containers stay locked. You are told the next time you log in. A warning"
          + " shows during the last "
          + policy.warnDays()
          + " days.",
      "At Governor I, the owner runs /camp graduate <name>. The same chunks, members, and personal"
          + " chunks become a town, and the clock stops. /town create <name> also takes Governor I."
          + " That path is unusual. /town list shows towns, not camps.",
      "Undo an automatic camp with /unclaim, /delhome, and /camp delete delete."
    };
    for (var line : lines) {
      player.sendMessage(Notices.info(line));
    }
  }

  private void create(Player player) {
    runtime.report(
        player,
        towns.foundCamp(player.getUniqueId()),
        town ->
            Notices.success(
                "Created your camp. Stand where you want to build and run /claim. /camp help"
                    + " explains claims, personal chunks, and invites."));
  }

  private void invite(Player player, PlayerRef target) {
    var result = members.invite(player.getUniqueId(), target);
    if (result instanceof Result.Ok) {
      player.sendMessage(Notices.success("Invited " + target.name() + " to your camp."));
      var online = names.server().getPlayer(target.id());
      if (online != null) {
        online.sendMessage(
            Notices.info(
                player.getName()
                    + " invited you to their camp. Join with /camp join "
                    + player.getName()
                    + "."));
      }
      return;
    }
    if (result instanceof Result.Err<Town, java.util.List<TownProblem>>(var problems)) {
      runtime.refuse(player, problems);
    }
  }

  private void join(Player player, String ownerName) {
    var camps = members.invitationsFor(player.getUniqueId()).stream().filter(Town::isCamp).toList();
    if (camps.isEmpty()) {
      player.sendMessage(Notices.error("You have no camp invitation."));
      return;
    }
    var owners = camps.stream().map(Town::owner).toList();
    var _ =
        names
            .namesOf(owners)
            .whenCompleteAsync(
                (found, failure) -> {
                  if (failure != null || found == null) {
                    player.sendMessage(Notices.error("Could not look up that invite; try again."));
                    return;
                  }
                  var match =
                      camps.stream()
                          .filter(
                              camp ->
                                  ownerName.equalsIgnoreCase(found.getOrDefault(camp.owner(), "")))
                          .findFirst();
                  if (match.isEmpty()) {
                    player.sendMessage(
                        Notices.error(
                            "No camp invitation from "
                                + ownerName
                                + ". Join with /camp join <owner>."));
                    return;
                  }
                  runtime.report(
                      player,
                      members.accept(player.getUniqueId(), match.get().name()),
                      town -> Notices.success("Joined the camp. /claim takes a chunk for it."));
                },
                runtime.scheduler().mainThread());
  }

  private void leave(Player player) {
    runtime.report(
        player,
        members.leave(player.getUniqueId()),
        town ->
            Notices.success(
                "Left the camp. Your personal chunks are shared again, and your locks passed to"
                    + " the owner."));
  }

  private void kick(Player player, PlayerRef target) {
    runtime.report(
        player,
        members.kick(player.getUniqueId(), target),
        town -> Notices.success("Kicked " + target.name() + " from the camp."));
  }

  private void delete(Player player, String confirmation) {
    var result =
        towns.disbandCamp(player.getUniqueId(), confirmation, offlineNotices(player, confirmation));
    tellOthers(player, result);
    runtime.report(
        player,
        result,
        town ->
            Notices.success(
                "Deleted your camp and released its land. Locked containers stay locked."));
  }

  private Map<UUID, String> offlineNotices(Player player, String confirmation) {
    var holding = state.townOf(player.getUniqueId());
    if (holding.isEmpty() || !holding.get().isCamp() || !"delete".equalsIgnoreCase(confirmation)) {
      return Map.of();
    }
    var pending = new HashMap<UUID, String>();
    for (var member : holding.get().members().keySet()) {
      if (!member.equals(player.getUniqueId()) && names.server().getPlayer(member) == null) {
        pending.put(member, DELETED);
      }
    }
    return Map.copyOf(pending);
  }

  private void tellOthers(Player player, Result<Change<Town>, java.util.List<TownProblem>> result) {
    if (!(result instanceof Result.Ok<Change<Town>, java.util.List<TownProblem>>(var change))) {
      return;
    }
    var camp = change.value();
    var _ =
        change
            .saved()
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (failure != null) {
                    return;
                  }
                  life.forget(player.getUniqueId());
                  for (var member : camp.members().keySet()) {
                    var online = names.server().getPlayer(member);
                    if (online != null && !online.equals(player)) {
                      online.sendMessage(Notices.info(DELETED));
                    }
                  }
                },
                runtime.scheduler().mainThread());
  }

  private void graduate(Player player, String name) {
    if (!player.hasPermission(Track.GOVERNOR.permission(1))) {
      player.sendMessage(
          Notices.error(
              "Graduating a camp takes Governor I. Train it with the Governor trainer or /perks."
                  + " Until then the camp stays."));
      return;
    }
    runtime.report(
        player,
        towns.graduate(player.getUniqueId(), name, levels.of(player)),
        town ->
            Notices.success(
                town.name()
                    + " is a town now. The same land and members stay, and the idle clock has"
                    + " stopped."));
  }
}
