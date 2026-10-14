package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Certifies actual fuse workers before a team yields its defuse job to them. */
public final class RetakeAdmission {
  /** Two incumbent checks and at most two replacements, independent of roster size. */
  public static final int MAX_QUERIES = 4;

  private RetakeAdmission() {}

  public enum Status {
    NOT_NEEDED,
    ADMITTED,
    NO_CAPABLE_WORKER,
    EXHAUSTED
  }

  /** Original certified stations survive temporary demotion; cursors survive same-bomb deals. */
  public record State(
      Optional<BombId> bomb,
      List<Slot> workers,
      Map<String, Integer> cursors,
      Map<String, List<CombatantId>> shortlists,
      long dealtTick,
      Map<CombatantId, CombatantView> admitted,
      long checkedTick) {
    public static final State EMPTY =
        new State(Optional.empty(), List.of(), Map.of(), Map.of(), -1, Map.of(), -1);

    public State {
      workers = List.copyOf(workers);
      cursors = Map.copyOf(cursors);
      var copied = new HashMap<String, List<CombatantId>>();
      shortlists.forEach((key, candidates) -> copied.put(key, List.copyOf(candidates)));
      shortlists = Map.copyOf(copied);
      admitted = Map.copyOf(admitted);
      if (workers.size() > 2 || workers.stream().anyMatch(slot -> slot.role() != Role.RETAKE)) {
        throw new IllegalArgumentException("retake admission requires at most two worker stations");
      }
    }

    /** Critical capture changes release a reservation before the normal team cadence. */
    public boolean invalidated(WorldSnapshot snapshot) {
      for (var entry : admitted.entrySet()) {
        var current = snapshot.combatant(entry.getKey());
        if (current.isEmpty() || changed(entry.getValue(), current.orElseThrow())) return true;
        // A timed landing certificate cannot be reused at a later source tick unchanged.
        if (snapshot.tick() != checkedTick
            && FallRisk.expires(entry.getValue().traversal(), checkedTick)) return true;
      }
      return false;
    }

    private static boolean changed(CombatantView before, CombatantView after) {
      return !after.alive()
          || before.health() != after.health()
          || before.absorption() != after.absorption()
          || !before.traversal().equals(after.traversal());
    }
  }

  public record Context(NavArtifact nav, WorldSnapshot snapshot) {}

  /** The caller supplies the bot's actual percept/context and exclusively owned search scratch. */
  public interface Routes {
    List<CombatantId> candidates(Slot worker);

    boolean reachable(CombatantId bot, Slot worker, Blackboard provisional);
  }

  public record Result(Blackboard board, State state, Status status, int queries) {}

  public static Result verify(Blackboard board, State previous, Context context, Routes routes) {
    var bomb = RetakeFormation.urgent(context.snapshot(), board.team());
    if (bomb.isEmpty()) return new Result(board, State.EMPTY, Status.NOT_NEEDED, 0);
    var id = Optional.of(bomb.orElseThrow().id());
    var sameBomb = id.equals(previous.bomb());
    var workers =
        sameBomb && board.plan().dealtTick() == previous.dealtTick()
            ? previous.workers()
            : board.plan().slots().stream().filter(slot -> slot.role() == Role.RETAKE).toList();
    var state =
        new State(
            id,
            workers,
            sameBomb ? previous.cursors() : Map.of(),
            sameBomb ? previous.shortlists() : Map.of(),
            board.plan().dealtTick(),
            Map.of(),
            -1);
    return new Check(board, state, context, routes).run();
  }

  private static final class Check {
    private final Blackboard board;
    private final State state;
    private final Context context;
    private final Routes routes;
    private final Map<CombatantId, String> assignments;
    private final Map<String, Integer> cursors;
    private final Map<String, List<CombatantId>> shortlists;
    private final Set<CombatantId> admitted = new HashSet<>();
    private final Map<String, Set<CombatantId>> checked = new HashMap<>();
    private int queries;

    private Check(Blackboard board, State state, Context context, Routes routes) {
      this.board = board;
      this.state = state;
      this.context = context;
      this.routes = routes;
      assignments = new HashMap<>(board.plan().assignment());
      cursors = new HashMap<>(state.cursors());
      shortlists = new HashMap<>(state.shortlists());
    }

    private Result run() {
      var pending = new ArrayList<Slot>();
      for (var worker : state.workers()) {
        var holder = holder(worker);
        if (holder.isEmpty() || !accept(holder.orElseThrow(), worker)) pending.add(worker);
      }
      replace(pending);
      var slots = board.plan().slots().stream().map(this::effective).toList();
      var plan = withSlots(board.plan(), slots, assignments);
      var status = status(pending);
      var captures = new HashMap<CombatantId, CombatantView>();
      admitted.forEach(bot -> captures.put(bot, context.snapshot().require(bot)));
      return new Result(
          board.withPlan(plan, board.rolesAssignedTick()),
          new State(
              state.bomb(),
              state.workers(),
              cursors,
              shortlists,
              state.dealtTick(),
              captures,
              context.snapshot().tick()),
          status,
          queries);
    }

    private Optional<CombatantId> holder(Slot worker) {
      return assignments.entrySet().stream()
          .filter(entry -> entry.getValue().equals(worker.key()))
          .map(Map.Entry::getKey)
          .findFirst();
    }

    private boolean accept(CombatantId bot, Slot worker) {
      checked.computeIfAbsent(worker.key(), _ -> new HashSet<>()).add(bot);
      if (!eligible(bot) || queries >= MAX_QUERIES) return false;
      queries++;
      if (!routes.reachable(bot, worker, provisional(bot, worker))) return false;
      admitted.add(bot);
      return true;
    }

    private boolean eligible(CombatantId bot) {
      return assignments.containsKey(bot)
          && !admitted.contains(bot)
          && context.snapshot().combatant(bot).filter(view -> view.alive()).isPresent();
    }

    private void replace(List<Slot> pending) {
      while (queries < MAX_QUERIES) {
        var before = queries;
        for (var worker : pending) {
          if (holder(worker).filter(admitted::contains).isEmpty()) replaceOne(worker);
        }
        if (queries == before) return;
      }
    }

    private void replaceOne(Slot worker) {
      var candidates = shortlist(worker);
      if (candidates.isEmpty()) return;
      var start = Math.floorMod(cursors.getOrDefault(worker.key(), 0), candidates.size());
      for (var offset = 0; offset < candidates.size() && queries < MAX_QUERIES; offset++) {
        var index = (start + offset) % candidates.size();
        var bot = candidates.get(index);
        cursors.put(worker.key(), (index + 1) % candidates.size());
        if (checked.getOrDefault(worker.key(), Set.of()).contains(bot) || !eligible(bot)) continue;
        if (accept(bot, worker)) swap(bot, worker);
        return;
      }
    }

    /** Preserve the initial ETA ranking across deals so a moving roster cannot reset progress. */
    private List<CombatantId> shortlist(Slot worker) {
      var current = routes.candidates(worker);
      var ordered = new LinkedHashSet<>(shortlists.getOrDefault(worker.key(), List.of()));
      ordered.retainAll(new HashSet<>(current));
      ordered.addAll(current);
      var result = List.copyOf(ordered);
      shortlists.put(worker.key(), result);
      return result;
    }

    private void swap(CombatantId bot, Slot worker) {
      var old = assignments.get(bot);
      holder(worker).ifPresent(incumbent -> assignments.put(incumbent, old));
      assignments.put(bot, worker.key());
    }

    private Blackboard provisional(CombatantId bot, Slot worker) {
      var proposed = new HashMap<>(assignments);
      var old = proposed.get(bot);
      holder(worker).ifPresent(incumbent -> proposed.put(incumbent, old));
      proposed.put(bot, worker.key());
      var slots = board.plan().slots().stream().map(this::original).toList();
      return board.withPlan(withSlots(board.plan(), slots, proposed), board.rolesAssignedTick());
    }

    private Slot original(Slot slot) {
      return state.workers().stream()
          .filter(worker -> worker.key().equals(slot.key()))
          .findFirst()
          .orElse(slot);
    }

    private Slot effective(Slot slot) {
      var original = original(slot);
      if (original.role() != Role.RETAKE) return original;
      var holder = holder(original).orElseThrow();
      if (admitted.contains(holder)) return original;
      var point =
          RetakeFormation.reserve(context.nav(), context.snapshot().require(holder), TeamPlan.NONE);
      return new Slot(
          original.key(),
          SlotKind.SWEEP,
          Role.ROTATE,
          point,
          original.watch(),
          -1,
          -1,
          Optional.empty(),
          0);
    }

    private Status status(List<Slot> pending) {
      if (admitted.size() == state.workers().size()) return Status.ADMITTED;
      var exhausted =
          pending.stream()
              .anyMatch(
                  worker ->
                      !checked
                          .getOrDefault(worker.key(), Set.of())
                          .containsAll(routes.candidates(worker)));
      return exhausted ? Status.EXHAUSTED : Status.NO_CAPABLE_WORKER;
    }
  }

  private static TeamPlan withSlots(
      TeamPlan plan, List<Slot> slots, Map<CombatantId, String> assignments) {
    return new TeamPlan(
        plan.strategy(),
        plan.home(),
        plan.objective(),
        plan.lanes(),
        plan.push(),
        slots,
        assignments,
        plan.dealtTick());
  }
}
