package com.shepherdjerred.thestorm.rwf.app.map;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import org.jspecify.annotations.Nullable;

/**
 * The maps a match may be played on: it offers ballot candidates, and holds at most two maps in the
 * world at once during normal play, the one last played and the one being prepared for the next
 * match. A visit ballot temporarily holds up to three candidates; selecting one releases the others
 * after the owner evacuates visitors. Callbacks run on the owner.
 */
public final class MapRotation<T extends MapRotation.Entry> implements AutoCloseable {

  /** A map the rotation can hold. */
  public interface Entry {
    String id();

    /** Loads, verifies and holds the map; {@code done} gets whether it is ready. */
    void prepare(Consumer<Boolean> done);

    /** Prepares visitable terrain without activating optional match resources. */
    default void prepareVisit(Consumer<Boolean> done) {
      prepare(done);
    }

    /** Activates match-only resources for terrain that was prepared for visitors. */
    default void activate(Consumer<Boolean> done) {
      done.accept(ready());
    }

    /** Whether the map is held and verified now. */
    boolean ready();

    /** Whether visit terrain is ready, without requiring match-only resources. */
    default boolean visitReady() {
      return ready();
    }

    /** Lets go of the map's terrain, navigation and chunks. */
    void release();
  }

  /** With this many maps or more, the map just played is never offered again straight away. */
  public static final int REPEAT_AFTER = 4;

  private final List<T> maps;
  private final RandomGenerator random;
  private final Set<String> quarantined = new HashSet<>();
  private @Nullable T active;
  private @Nullable T preparing;
  private List<T> visits = List.of();
  private final Set<T> held = new HashSet<>();
  private boolean closed;
  private int generation;

  /** The request {@link #waiter} answers; superseded once a later call is made. */
  private int waiting;

  private @Nullable Consumer<Boolean> waiter;

  public MapRotation(List<T> maps, RandomGenerator random) {
    this.maps = List.copyOf(maps);
    this.random = random;
    if (maps.isEmpty() || maps.stream().map(Entry::id).distinct().count() != maps.size()) {
      throw new IllegalArgumentException("rotation needs distinct maps");
    }
  }

  /** The map last played on, if any. */
  public Optional<T> active() {
    return Optional.ofNullable(active);
  }

  /** The maps that can be offered, in rotation order. */
  public List<T> playable() {
    return maps.stream().filter(map -> !quarantined.contains(map.id())).toList();
  }

  public Optional<T> byId(String id) {
    return maps.stream().filter(map -> map.id().equals(id)).findFirst();
  }

  /**
   * Up to {@code count} maps chosen at random for a ballot. With {@link #REPEAT_AFTER} or more maps
   * the one just played is left out.
   */
  public List<T> candidates(int count) {
    return candidates(count, Set.of());
  }

  /** Draws only from admitted playable entries; restrictions never load additional maps. */
  public List<T> candidates(int count, Set<String> admitted) {
    var pool =
        new ArrayList<>(
            playable().stream()
                .filter(map -> admitted.isEmpty() || admitted.contains(map.id()))
                .toList());
    if (pool.isEmpty()) {
      throw new IllegalStateException("configured rotation has no playable maps");
    }
    if (pool.size() >= REPEAT_AFTER && active != null) {
      pool.remove(active);
    }
    var chosen = new ArrayList<T>();
    while (chosen.size() < count && !pool.isEmpty()) {
      chosen.add(pool.remove(random.nextInt(pool.size())));
    }
    return List.copyOf(chosen);
  }

  /**
   * Holds up to three offered maps, loading terrain serially. The owner must evacuate visitors
   * before calling this method, selecting a winner, cancelling visits, or closing the rotation. No
   * candidate is committed as the match map here.
   */
  public void prepareCandidates(List<T> candidates, Consumer<Boolean> done) {
    if (closed) throw new IllegalStateException("rotation is closed");
    if (candidates.isEmpty()
        || candidates.size() > 3
        || candidates.stream().distinct().count() != candidates.size()
        || !maps.containsAll(candidates)) {
      throw new IllegalArgumentException("visits need one to three distinct offered maps");
    }
    var request = ++generation;
    waiter = null;
    preparing = null;
    for (var map : List.copyOf(held)) {
      if (!candidates.contains(map)) releaseHeld(map);
    }
    visits = List.copyOf(candidates);
    prepareCandidate(0, request, done);
  }

  private void prepareCandidate(int index, int request, Consumer<Boolean> done) {
    if (closed || request != generation) return;
    if (index == visits.size()) {
      done.accept(true);
      return;
    }
    var map = visits.get(index);
    if (map.visitReady()) {
      held.add(map);
      prepareCandidate(index + 1, request, done);
      return;
    }
    if (held.contains(map)) releaseHeld(map);
    held.add(map);
    map.prepareVisit(
        ok -> {
          if (closed || request != generation) return;
          if (!ok) {
            // The owner evacuates before explicitly cancelling and releasing the other candidates.
            releaseHeld(map);
            done.accept(false);
          } else {
            prepareCandidate(index + 1, request, done);
          }
        });
  }

  /** Whether this map belongs to the current visit ballot and its terrain is ready. */
  public boolean visitable(String mapId) {
    return visits.stream().anyMatch(map -> map.id().equals(mapId) && map.visitReady());
  }

  /** Cancels serial preparation and releases candidate terrain after the owner evacuates it. */
  public void cancelVisits() {
    generation++;
    for (var map : visits) releaseHeld(map);
    visits = List.of();
  }

  private void releaseHeld(T map) {
    if (held.remove(map)) map.release();
  }

  /**
   * Prepares {@code chosen} for the next match; {@code done} gets whether it is ready. The map
   * already active needs no new preparation. A later call supersedes an earlier one, whose result
   * is then dropped; a later call for the map already loading waits on that load rather than
   * starting another (a stopped lobby asks again for the map its vote chose).
   */
  public void prepare(T chosen, Consumer<Boolean> done) {
    if (closed) {
      throw new IllegalStateException("rotation is closed");
    }
    var request = ++generation;
    if (activateCandidate(chosen, request, done)) return;
    var previous = preparing;
    if (previous != null && same(previous, chosen)) {
      awaitLoad(chosen, request, done);
      return;
    }
    preparing = null;
    waiter = null;
    if (previous != null && !same(previous, active)) {
      releaseHeld(previous);
    }
    if (same(chosen, active) && chosen.ready()) {
      done.accept(true);
      return;
    }
    if (same(chosen, active)) {
      // The map just played was released for repair; it is prepared afresh.
      releaseHeld(chosen);
    }
    preparing = chosen;
    waiting = request;
    waiter = done;
    held.add(chosen);
    chosen.prepare(ok -> loaded(chosen, ok));
  }

  private boolean activateCandidate(T chosen, int request, Consumer<Boolean> done) {
    if (visits.isEmpty()) return false;
    var reuse = visits.contains(chosen) && chosen.visitReady();
    for (var map : visits) {
      if (!same(map, chosen) || !reuse) releaseHeld(map);
    }
    visits = List.of();
    if (!reuse) return false;
    preparing = chosen;
    waiting = request;
    waiter = done;
    chosen.activate(ok -> loaded(chosen, ok));
    return true;
  }

  /**
   * {@code chosen} is already preparing: {@code done} hears that load, or at once if it is over.
   */
  private void awaitLoad(T chosen, int request, Consumer<Boolean> done) {
    if (chosen.ready()) {
      done.accept(true);
      return;
    }
    waiting = request;
    waiter = done;
  }

  /** {@code chosen} finished loading: the latest request for it hears whether it is ready. */
  private void loaded(T chosen, boolean ok) {
    if (closed || !same(preparing, chosen) || waiting != generation) {
      return;
    }
    if (!ok) {
      // A failed load may leave its terrain half held: let it all go, so the map can be prepared
      // afresh when a later ballot chooses it.
      releaseHeld(chosen);
      preparing = null;
    }
    var answer = waiter;
    waiter = null;
    if (answer != null) {
      answer.accept(ok);
    }
  }

  /** {@code played} is the map the match now runs on; the one before it is let go. */
  public void play(T played) {
    var previous = active;
    active = played;
    held.add(played);
    if (same(preparing, played)) {
      preparing = null;
    }
    if (previous != null && !same(previous, played)) {
      releaseHeld(previous);
    }
  }

  private static boolean same(@Nullable Entry a, @Nullable Entry b) {
    return a != null && b != null && a.id().equals(b.id());
  }

  /** Keeps {@code mapId} out of every ballot until the module restarts; whether it was known. */
  public boolean quarantine(String mapId) {
    if (byId(mapId).isEmpty()) {
      return false;
    }
    if (playable().size() <= 1 && !quarantined.contains(mapId)) {
      throw new IllegalStateException("the last playable map cannot be quarantined");
    }
    quarantined.add(mapId);
    return true;
  }

  /** Puts {@code mapId} back into the ballots; whether it was quarantined. */
  public boolean release(String mapId) {
    return quarantined.remove(mapId);
  }

  @Override
  public void close() {
    closed = true;
    generation++;
    preparing = null;
    waiter = null;
    // The Paper owner releases every map after restoring players and completing match teardown.
    // Releasing here would discard the active terrain before Stop can revert its craters.
    visits = List.of();
  }
}
