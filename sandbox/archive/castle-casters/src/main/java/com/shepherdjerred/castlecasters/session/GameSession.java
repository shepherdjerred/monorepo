package com.shepherdjerred.castlecasters.session;

import com.shepherdjerred.castlecasters.ai.BoundedQuoridorAi;
import com.shepherdjerred.castlecasters.common.player.*;
import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.*;
import com.shepherdjerred.castlecasters.logic.player.*;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.session.SessionState.*;
import java.util.*;
import java.util.concurrent.*;

/** The caller owns this session thread. Workers return results, never mutate it. */
public final class GameSession implements AutoCloseable {
  private final ExecutorService worker =
      Executors.newSingleThreadExecutor(r -> new Thread(r, "CASTLE_AI"));
  private final List<Seat> seats = new ArrayList<>();
  private final List<Wall> walls = new ArrayList<>();
  private Future<BoundedQuoridorAi.Result> search;
  private long searchRevision;
  private long revision;
  private Phase phase = Phase.LOBBY;
  private String theme = "GRASS";
  private int startingPlayer = 1;
  private Match match;
  private TurnData lastTurn;
  private String message = "Choose your players";
  private final boolean deterministic;
  private final Set<String> commands = new HashSet<>();

  public GameSession() {
    this(false);
  }

  public GameSession(boolean deterministic) {
    this.deterministic = deterministic;
    resize(2);
  }

  public Snapshot snapshot() {
    return new Snapshot(
        revision,
        phase,
        theme,
        startingPlayer,
        seats,
        match == null ? null : MatchData.of(match, walls),
        lastTurn,
        search != null,
        message);
  }

  public Match match() {
    return match;
  }

  public void resize(int count) {
    requireLobby();
    if (count != 2 && count != 4) throw new IllegalArgumentException("Choose two or four players");
    if (count < seats.size()
        && seats.subList(count, seats.size()).stream()
            .anyMatch(s -> s.controller() == Controller.REMOTE && s.connected()))
      throw new IllegalArgumentException("Disconnect remote seats before shrinking the lobby");
    while (seats.size() > count) seats.removeLast();
    while (seats.size() < count) {
      int n = seats.size() + 1;
      var element =
          Arrays.stream(Element.values())
              .filter(e -> seats.stream().noneMatch(s -> s.element() == e))
              .findFirst()
              .orElseThrow();
      seats.add(
          new Seat(
              n,
              n == 1 ? "You" : "Caster " + n,
              element,
              n == 1 ? Controller.LOCAL : Controller.AI,
              Difficulty.NORMAL,
              true));
    }
    if (startingPlayer > count) startingPlayer = 1;
    revision++;
  }

  public void seat(Seat seat) {
    requireLobby();
    if (seat.number() > seats.size()) throw new IllegalArgumentException("Seat outside lobby");
    var old = seats.get(seat.number() - 1);
    if (old.controller() == Controller.REMOTE
        && old.connected()
        && seat.controller() != Controller.REMOTE)
      throw new IllegalArgumentException("Remote player still owns this seat");
    for (var other : seats)
      if (other.number() != seat.number() && other.element() == seat.element())
        throw new IllegalArgumentException("Each caster needs a different element");
    seats.set(seat.number() - 1, seat);
    revision++;
  }

  public void theme(String value) {
    requireLobby();
    if (!Set.of("GRASS", "DESERT", "WINTER").contains(value))
      throw new IllegalArgumentException("Unknown theme");
    theme = value;
    revision++;
  }

  public void swapElements(int first, int second) {
    requireLobby();
    var a = seats.get(first - 1);
    var b = seats.get(second - 1);
    if (a.controller() == Controller.REMOTE && a.connected()
        || b.controller() == Controller.REMOTE && b.connected())
      throw new IllegalArgumentException("Remote players choose their own elements");
    seats.set(
        first - 1,
        new Seat(a.number(), a.name(), b.element(), a.controller(), a.difficulty(), a.connected()));
    seats.set(
        second - 1,
        new Seat(b.number(), b.name(), a.element(), b.controller(), b.difficulty(), b.connected()));
    revision++;
  }

  public void startingPlayer(int value) {
    requireLobby();
    if (value < 1 || value > seats.size())
      throw new IllegalArgumentException("Invalid starting player");
    startingPlayer = value;
    revision++;
  }

  public void start() {
    requireLobby();
    if (seats.stream().anyMatch(s -> !s.connected()))
      throw new IllegalArgumentException("Waiting for remote players");
    cancel();
    walls.clear();
    commands.clear();
    lastTurn = null;
    var count = seats.size() == 2 ? PlayerCount.TWO : PlayerCount.FOUR;
    match =
        Match.from(
            new MatchSettings(10, QuoridorPlayer.fromInt(startingPlayer), count),
            new BoardSettings(9, count));
    phase = Phase.PLAYING;
    message = "Reach the opposite edge";
    revision++;
  }

  public void turn(String id, long expectedRevision, TurnData data, Set<Integer> ownedSeats) {
    if (commands.contains(id))
      throw new IllegalArgumentException("This turn was already submitted");
    if (phase != Phase.PLAYING)
      throw new IllegalArgumentException("The match is not accepting turns");
    if (revision != expectedRevision)
      throw new IllegalArgumentException("The board changed; try again");
    if (!ownedSeats.contains(data.seat()))
      throw new IllegalArgumentException("You do not control that caster");
    var turn = data.turn(match);
    var next = match.doTurn(turn);
    cancel();
    match = next;
    lastTurn = data;
    commands.add(id);
    if (turn instanceof PlaceWallTurn)
      walls.add(new Wall(data.seat(), data.x(), data.y(), data.type().equals("VERTICAL")));
    phase =
        match.matchStatus().status() == MatchStatus.Status.VICTORY ? Phase.FINISHED : Phase.PLAYING;
    String winnerName =
        phase == Phase.FINISHED ? seats.get(match.matchStatus().victor().ordinal()).name() : "";
    message =
        phase == Phase.FINISHED
            ? winnerName.equals("You") ? "You win!" : winnerName + " wins!"
            : "";
    revision++;
  }

  public void update() {
    if (phase != Phase.PLAYING || match == null) return;
    if (search != null && search.isDone()) {
      try {
        var result = search.get();
        search = null;
        if (revision == searchRevision)
          turn(
              UUID.randomUUID().toString(),
              revision,
              TurnData.of(result.turn()),
              Set.of(match.getActivePlayerId().toInt()));
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(e);
      } catch (ExecutionException e) {
        search = null;
        throw new IllegalStateException("AI search failed", e.getCause());
      }
    }
    if (search == null && phase == Phase.PLAYING) {
      var seat = seats.get(match.getActivePlayerId().ordinal());
      if (seat.controller() == Controller.AI) {
        var position = match;
        searchRevision = revision;
        search =
            worker.submit(
                () ->
                    new BoundedQuoridorAi(
                            BoundedQuoridorAi.Budget.forDifficulty(seat.difficulty()),
                            deterministic)
                        .choose(position));
      }
    }
  }

  public void disconnect(int number) {
    var seat = seats.get(number - 1);
    seats.set(number - 1, seat.connection(false));
    cancel();
    if (phase == Phase.PLAYING) phase = Phase.PAUSED;
    message = seat.name() + " disconnected. Waiting to rejoin.";
    revision++;
  }

  public void reconnect(int number) {
    seats.set(number - 1, seats.get(number - 1).connection(true));
    if (phase == Phase.PAUSED && seats.stream().allMatch(Seat::connected)) {
      phase = Phase.PLAYING;
      message = "Reconnected";
    }
    revision++;
  }

  public void replaceDisconnected() {
    for (int i = 0; i < seats.size(); i++) {
      var s = seats.get(i);
      if (!s.connected())
        seats.set(
            i, new Seat(s.number(), s.name(), s.element(), Controller.AI, Difficulty.NORMAL, true));
    }
    if (phase == Phase.PAUSED) phase = Phase.PLAYING;
    message = "Disconnected seats replaced by AI";
    revision++;
  }

  public void lobby() {
    cancel();
    phase = Phase.LOBBY;
    match = null;
    walls.clear();
    lastTurn = null;
    message = "Choose your players";
    revision++;
  }

  public void fixture(MatchData data) {
    lobby();
    resize(data.pawns().size());
    for (int i = 0; i < seats.size(); i++) {
      var s = seats.get(i);
      seats.set(
          i, new Seat(s.number(), s.name(), s.element(), Controller.LOCAL, s.difficulty(), true));
    }
    match = data.restore();
    walls.clear();
    walls.addAll(data.walls());
    phase = data.winner() == 0 ? Phase.PLAYING : Phase.FINISHED;
    lastTurn = null;
    message = "Fixture";
    revision++;
  }

  private void requireLobby() {
    if (phase != Phase.LOBBY)
      throw new IllegalArgumentException("Return to the lobby to change settings");
  }

  private void cancel() {
    if (search != null) {
      search.cancel(true);
      search = null;
    }
  }

  @Override
  public void close() {
    cancel();
    phase = Phase.CLOSED;
    worker.shutdownNow();
    revision++;
    try {
      if (!worker.awaitTermination(5, TimeUnit.SECONDS))
        throw new IllegalStateException("AI worker did not stop");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(e);
    }
  }
}
