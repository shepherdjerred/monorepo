package com.shepherdjerred.castlecasters.game.desktop;

import static org.lwjgl.opengl.GL11.*;

import com.shepherdjerred.castlecasters.common.player.*;
import com.shepherdjerred.castlecasters.common.player.AiPlayer.Difficulty;
import com.shepherdjerred.castlecasters.engine.*;
import com.shepherdjerred.castlecasters.engine.audio.AudioPlayer;
import com.shepherdjerred.castlecasters.engine.events.*;
import com.shepherdjerred.castlecasters.engine.events.input.*;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.input.keyboard.Key;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.*;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.logic.turn.generator.TurnGenerator;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import com.shepherdjerred.castlecasters.session.*;
import com.shepherdjerred.castlecasters.session.SessionState.*;
import java.net.*;
import java.util.*;

/** Original GLFW engine and artwork, with a single authoritative session for every play mode. */
public final class DesktopGame implements InspectableGame {
  private static final float BX = 442, BY = 140, TILE = 28;
  private final EventBus<Event> bus;
  private final GameCanvas canvas = new GameCanvas();
  private final AudioPlayer audio;
  private final GameSound sound;
  private final Map<String, Button> buttons = new LinkedHashMap<>();
  private GameSession session;
  private SessionHost host;
  private SessionClient client;
  private LanDiscovery discovery;
  private Snapshot state;
  private Match board;
  private List<TurnData> moves = List.of();
  private String scene = "menu",
      feedback = "",
      field = "",
      address = "localhost:35567",
      name = "You",
      draft = "";
  private WindowSize logical = new WindowSize(1360, 768), framebuffer;
  private float mx = -1, my = -1, time, animation;
  private boolean wallMode, vertical, pending;
  private String pressedControl = "";
  private Snapshot previous;
  private long sequence, discoveryAt;

  private record Button(float x, float y, float w, float h, boolean enabled, Runnable action) {
    boolean contains(float px, float py) {
      return px >= x && px <= x + w && py >= y && py <= y + h;
    }
  }

  public DesktopGame(EventBus<Event> bus) {
    this(bus, false);
  }

  public DesktopGame(EventBus<Event> bus, boolean muted) {
    this.bus = bus;
    audio = new AudioPlayer(bus);
    sound = new GameSound(muted);
  }

  @Override
  public void initialize(WindowSize size) throws Exception {
    logical = size;
    int[] viewport = new int[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    framebuffer = new WindowSize(viewport[2], viewport[3]);
    canvas.initialize();
    audio.initialize();
    sound.initialize();
    bus.registerHandler(LogicalWindowResizeEvent.class, e -> logical = e.size());
    bus.registerHandler(WindowResizeEvent.class, e -> framebuffer = e.newWindowSize());
    bus.registerHandler(
        MouseMoveEvent.class, e -> pointer(e.newMousePosition().x(), e.newMousePosition().y()));
    bus.registerHandler(
        MouseButtonDownEvent.class,
        e -> {
          pointer(e.mouseCoordinate().x(), e.mouseCoordinate().y());
          if (e.button() == MouseButton.LEFT)
            pressedControl =
                buttons.entrySet().stream()
                    .filter(
                        entry -> entry.getValue().enabled() && entry.getValue().contains(mx, my))
                    .map(Map.Entry::getKey)
                    .findFirst()
                    .orElse("");
        });
    bus.registerHandler(
        MouseButtonUpEvent.class,
        e -> {
          pointer(e.mouseCoordinate().x(), e.mouseCoordinate().y());
          try {
            click(e.button());
          } catch (IllegalArgumentException
              | com.shepherdjerred.castlecasters.logic.turn.exception.InvalidTurnException error) {
            feedback = error.getMessage();
            pending = false;
          } finally {
            pressedControl = "";
          }
        });
    bus.registerHandler(
        TextInputEvent.class,
        e -> {
          if (e.codepoint() >= 32 && e.codepoint() < 127 && !field.isEmpty())
            edit((char) e.codepoint(), false);
        });
    bus.registerHandler(KeyPressedEvent.class, e -> key(e.key()));
  }

  private void pointer(int x, int y) {
    double scale = Math.min(logical.width() / 1360., logical.height() / 768.);
    if (scale <= 0) return;
    mx = (float) ((x - (logical.width() - 1360 * scale) / 2) / scale);
    my = (float) ((y - (logical.height() - 768 * scale) / 2) / scale);
  }

  private void key(Key key) {
    if (key == Key.BACKSPACE && !field.isEmpty()) edit(' ', true);
    else if (key == Key.ENTER) {
      try {
        commitName();
        field = "";
      } catch (IllegalArgumentException error) {
        feedback = error.getMessage();
      }
    } else if (key == Key.ESCAPE) {
      if (scene.equals("help")) scene = "menu";
      wallMode = false;
      field = "";
      feedback = "";
    } else if (field.isEmpty()) {
      if (key == Key.R) {
        wallMode = true;
        vertical = !vertical;
      }
      if (key == Key.V) {
        wallMode = true;
        vertical = true;
      }
      if (key == Key.M) wallMode = false;
      if (key == Key.W) wallMode = true;
    }
  }

  private void edit(char c, boolean backspace) {
    String value = field.equals("address") ? address : field.equals("name") ? name : draft;
    if (backspace) value = value.isEmpty() ? value : value.substring(0, value.length() - 1);
    else if (value.length() < (field.equals("address") ? 128 : 24)) value += c;
    if (field.equals("address")) address = value;
    else if (field.equals("name")) name = value;
    else draft = value;
  }

  private void commitName() {
    if (!field.isEmpty() && !field.equals("name") && !field.equals("address")) {
      var old = state.seats().get(Integer.parseInt(field) - 1);
      configure(
          new Seat(
              old.number(),
              draft,
              old.element(),
              old.controller(),
              old.difficulty(),
              old.connected()));
    }
  }

  private void configure(Seat value) {
    if (client != null) client.configure(value);
    else session.seat(value);
    refresh();
  }

  private void local(boolean network) {
    release();
    session = new GameSession();
    scene = "lobby";
    feedback = "";
    if (network) {
      var s = session.snapshot().seats().get(1);
      session.seat(new Seat(2, "Open seat", s.element(), Controller.REMOTE, s.difficulty(), false));
      try {
        host = new SessionHost(session, 35567);
      } catch (Exception e) {
        release();
        scene = "menu";
        feedback = "Cannot host: port 35567 is unavailable";
      }
      if (host != null)
        try {
          discovery = new LanDiscovery(host.port());
        } catch (SocketException error) {
          feedback = "Host ready. LAN discovery is unavailable; share your address and port.";
        }
    }
    refresh();
  }

  private void joinScreen() {
    release();
    scene = "join";
    feedback = "";
    try {
      discovery = new LanDiscovery(0);
      discovery.query();
    } catch (SocketException e) {
      feedback = "LAN discovery unavailable. Enter the host address.";
    }
  }

  private void join() {
    if (name.isBlank()) throw new IllegalArgumentException("Enter your name");
    String hostname = address;
    int port = 35567;
    if (hostname.startsWith("[")) {
      int end = hostname.indexOf(']');
      if (end < 0) throw new IllegalArgumentException("Use [IPv6]:port");
      if (end + 1 < hostname.length()) port = Integer.parseInt(hostname.substring(end + 2));
      hostname = hostname.substring(1, end);
    } else if (hostname.indexOf(':') == hostname.lastIndexOf(':') && hostname.contains(":")) {
      int colon = hostname.indexOf(':');
      port = Integer.parseInt(hostname.substring(colon + 1));
      hostname = hostname.substring(0, colon);
    }
    if (hostname.isBlank() || port < 1 || port > 65535)
      throw new IllegalArgumentException("Enter a valid host address and port");
    if (discovery != null) {
      discovery.close();
      discovery = null;
    }
    client = new SessionClient(new InetSocketAddress(hostname, port), name);
    scene = "lobby";
    field = "";
  }

  private Set<Integer> owned() {
    if (client != null) return Set.of(client.seat());
    var result = new HashSet<Integer>();
    if (state != null)
      for (var s : state.seats()) if (s.controller() == Controller.LOCAL) result.add(s.number());
    return result;
  }

  private boolean canTurn() {
    return state != null
        && state.phase() == Phase.PLAYING
        && animation <= 0
        && !pending
        && board != null
        && owned().contains(state.match().activePlayer())
        && (client == null || client.connected());
  }

  private void refresh() {
    var next = client != null ? client.snapshot() : session != null ? session.snapshot() : null;
    if (next == null) return;
    boolean changed = state == null || next.revision() != state.revision();
    if (changed) {
      previous = state;
      if (previous != null
          && previous.match() != null
          && next.match() != null
          && next.lastTurn() != null
          && !Objects.equals(previous.lastTurn(), next.lastTurn())) animation = .42f;
      state = next;
      board = next.match() == null ? null : next.match().restore();
      pending = false;
      if (next.phase() == Phase.FINISHED)
        sound.play(
            owned().contains(next.match().winner())
                ? com.shepherdjerred.castlecasters.engine.audio.AudioName.VICTORY_MUSIC
                : com.shepherdjerred.castlecasters.engine.audio.AudioName.DEFEAT_MUSIC);
      if (next.phase() == Phase.LOBBY)
        sound.play(com.shepherdjerred.castlecasters.engine.audio.AudioName.THEME_MUSIC);
      if (board != null && next.phase() == Phase.PLAYING)
        moves =
            new TurnGenerator(new TurnValidatorFactory())
                .generateValidPawnTurns(board).stream()
                    .map(TurnData::of)
                    .sorted(Comparator.comparingInt(TurnData::x).thenComparingInt(TurnData::y))
                    .toList();
      else moves = List.of();
    } else state = next;
    if (next.match() != null) scene = "game";
    else if (!scene.equals("menu") && !scene.equals("join")) scene = "lobby";
  }

  @Override
  public void updateGameState(float interval) {
    time += interval;
    animation = Math.max(0, animation - interval);
    // Finish the previous animation before advancing local AI, keeping each accepted turn visible.
    if (session != null && animation <= 0) session.update();
    if (host != null) host.update();
    if (client != null) {
      client.update();
      pending = client.pending();
    }
    if (scene.equals("join") && discovery != null && System.nanoTime() > discoveryAt) {
      discovery.query();
      discoveryAt = System.nanoTime() + 2_000_000_000L;
    }
    refresh();
  }

  private TurnData preview(boolean vertical) {
    int x = (int) Math.floor((mx - BX) / TILE), y = 16 - (int) Math.floor((my - BY) / TILE);
    if (x < 0 || x > 16 || y < 0 || y > 16 || board == null) return null;
    x = vertical ? (x / 2) * 2 + 1 : (x / 2) * 2;
    y = vertical ? (y / 2) * 2 : (y / 2) * 2 + 1;
    return new TurnData(
        vertical ? "VERTICAL" : "HORIZONTAL", state.match().activePlayer(), x, y, 0, 0);
  }

  private boolean legal(TurnData turn) {
    return turn != null
        && !new TurnValidatorFactory()
            .getValidator(turn.turn(board))
            .validate(board, turn.turn(board))
            .isError();
  }

  private void click(MouseButton button) {
    if (button == MouseButton.LEFT)
      for (var entry : new ArrayList<>(buttons.values())) {
        if (entry.contains(mx, my)) {
          if (entry.enabled()) {
            commitName();
            field = "";
            entry.action().run();
          }
          return;
        }
      }
    if (!scene.equals("game") || !canTurn()) return;
    field = "";
    if (button == MouseButton.RIGHT || wallMode) {
      var turn = preview(vertical);
      if (!legal(turn)) {
        feedback = "That wall overlaps another wall or blocks a path";
        return;
      }
      submit(turn);
      return;
    }
    int x = Math.round(((mx - BX) / TILE - .5f) / 2) * 2,
        y = 16 - Math.round(((my - BY) / TILE - .5f) / 2) * 2;
    for (var turn : moves)
      if (turn.x() == x && turn.y() == y) {
        submit(turn);
        return;
      }
    feedback = "Choose a highlighted destination";
  }

  private void submit(TurnData turn) {
    if (client != null) {
      client.turn(turn);
      pending = true;
    } else session.turn("local:" + (++sequence), state.revision(), turn, owned());
    feedback = "";
    refresh();
  }

  private void button(
      String id,
      String label,
      float x,
      float y,
      float w,
      float h,
      boolean enabled,
      Runnable action) {
    var b = new Button(x, y, w, h, enabled, action);
    buttons.put(id, b);
    boolean hover = b.contains(mx, my) && enabled;
    boolean input = id.equals("name") || id.equals("address") || id.matches("seat[1-4]name");
    boolean selected =
        id.equals("move") && !wallMode
            || id.equals("wall") && wallMode
            || input && (field.equals(id) || id.equals("seat" + field + "name"));
    canvas.control(
        label,
        x,
        y,
        w,
        h,
        enabled,
        hover,
        hover && id.equals(pressedControl),
        Set.of("local", "start", "connect", "rematch").contains(id),
        selected,
        input);
  }

  private void text(String value, float x, float y) {
    canvas.text(value, x, y, 1.2f);
  }

  private void panel(float x, float y, float w, float h) {
    canvas.rect(x, y, w, h, .035f, .07f, .065f, .92f);
    canvas.rect(x, y, w, 2, .52f, .65f, .39f, 1);
  }

  @Override
  public void render() {
    glViewport(0, 0, framebuffer.width(), framebuffer.height());
    canvas.begin();
    canvas.viewport(framebuffer.width(), framebuffer.height());
    buttons.clear();
    canvas.image(TextureName.GREEN_FOREST_A, 0, 0, 1360, 768);
    canvas.image(TextureName.GREEN_FOREST_B, -(float) Math.sin(time * .05) * 12, 0, 1384, 768);
    canvas.image(TextureName.GREEN_FOREST_C, -(float) Math.sin(time * .08) * 18, 0, 1396, 768);
    if (scene.equals("menu")) menu();
    else if (scene.equals("help")) helpView();
    else if (scene.equals("join")) joinView();
    else if (scene.equals("lobby")) lobbyView();
    else gameView();
    if (!feedback.isEmpty()) {
      panel(240, 716, 880, 40);
      canvas.textFit(feedback, 258, 743, 842, 1.2f);
    }
    canvas.end();
    glViewport(0, 0, framebuffer.width(), framebuffer.height());
  }

  private void menu() {
    button(
        "sound", sound.muted() ? "Sound off" : "Sound on", 1110, 20, 220, 48, true, sound::toggle);
    canvas.image(TextureName.GAME_LOGO, 405, 85, 550, 140);
    button("local", "Play locally", 505, 266, 350, 62, true, () -> local(false));
    button("host", "Host multiplayer", 505, 344, 350, 62, true, () -> local(true));
    button("join", "Join multiplayer", 505, 422, 350, 62, true, this::joinScreen);
    button("help", "How to play", 505, 500, 350, 62, true, () -> scene = "help");
    button(
        "quit", "Quit", 505, 578, 350, 62, true, () -> bus.dispatch(new CloseApplicationEvent()));
    text("Two or four casters. Race to the opposite edge.", 450, 677);
  }

  private void helpView() {
    HowToPlayView.draw(canvas);
    button("back", "Back to menu", 505, 654, 350, 44, true, () -> scene = "menu");
  }

  private void joinView() {
    panel(345, 90, 670, 600);
    text("JOIN A CASTLE", 575, 137);
    text("Your name", 395, 195);
    button(
        "name",
        name + (field.equals("name") ? "_" : ""),
        395,
        211,
        570,
        50,
        true,
        () -> field = "name");
    text("Host address (LAN or Tailscale)", 395, 310);
    button(
        "address",
        address + (field.equals("address") ? "_" : ""),
        395,
        328,
        570,
        50,
        true,
        () -> field = "address");
    text("Nearby games", 395, 431);
    if (discovery != null) {
      int row = 0;
      for (var found : discovery.hosts()) {
        if (row >= 2) break;
        button(
            "found" + row,
            found.address() + ":" + found.port(),
            395,
            450 + row * 55,
            570,
            46,
            true,
            () -> address = found.address() + ":" + found.port());
        row++;
      }
      if (row == 0) text("None found. You can still enter an address.", 395, 473);
    }
    button("connect", "Connect", 695, 598, 270, 52, true, this::join);
    button("back", "Back", 395, 598, 270, 52, true, this::home);
  }

  private void lobbyView() {
    panel(115, 65, 1130, 630);
    text(host == null ? "CHOOSE YOUR CASTERS" : "HOST LOBBY - PORT " + host.port(), 450, 108);
    if (state == null) {
      text(client.status(), 430, 300);
      button("back", "Main menu", 480, 595, 400, 56, true, this::home);
      return;
    }
    boolean owner = session != null;
    button(
        "count",
        state.seats().size() + " players",
        155,
        132,
        220,
        47,
        owner,
        () -> session.resize(state.seats().size() == 2 ? 4 : 2));
    button(
        "theme",
        state.theme(),
        400,
        132,
        220,
        47,
        owner,
        () ->
            session.theme(
                switch (state.theme()) {
                  case "GRASS" -> "DESERT";
                  case "DESERT" -> "WINTER";
                  default -> "GRASS";
                }));
    button(
        "first",
        "Starts: " + state.startingPlayer(),
        645,
        132,
        220,
        47,
        owner,
        () -> session.startingPlayer(state.startingPlayer() % state.seats().size() + 1));
    for (var s : state.seats()) {
      float y = 215 + (s.number() - 1) * 83;
      boolean editable = owner || client.seat() == s.number();
      text("" + s.number(), 153, y + 29);
      button(
          "seat" + s.number() + "name",
          field.equals("" + s.number()) ? draft + "_" : s.name(),
          185,
          y,
          245,
          54,
          editable,
          () -> {
            field = "" + s.number();
            draft = s.name();
          });
      button(
          "seat" + s.number() + "element",
          s.element().name(),
          447,
          y,
          164,
          54,
          editable,
          () -> {
            for (int n = 1; n <= 4; n++) {
              var e = Element.values()[(s.element().ordinal() + n) % 4];
              if (state.seats().stream()
                  .noneMatch(t -> t.number() != s.number() && t.element() == e)) {
                configure(
                    new Seat(
                        s.number(), s.name(), e, s.controller(), s.difficulty(), s.connected()));
                return;
              }
            }
            if (owner) { // In a full lobby, exchange elements so all four stay unique.
              int next = s.number() % 4;
              var other = state.seats().get(next);
              session.swapElements(s.number(), other.number());
              refresh();
            }
          });
      button(
          "seat" + s.number() + "controller",
          s.controller() == Controller.REMOTE
              ? (s.connected() ? "Remote online" : "Remote open")
              : s.controller().name(),
          629,
          y,
          230,
          54,
          owner && !(s.controller() == Controller.REMOTE && s.connected()),
          () -> {
            var c =
                s.controller() == Controller.LOCAL
                    ? Controller.AI
                    : s.controller() == Controller.AI && host != null
                        ? Controller.REMOTE
                        : Controller.LOCAL;
            configure(
                new Seat(
                    s.number(), s.name(), s.element(), c, s.difficulty(), c != Controller.REMOTE));
          });
      button(
          "seat" + s.number() + "difficulty",
          s.difficulty().name(),
          876,
          y,
          218,
          54,
          owner && s.controller() == Controller.AI,
          () ->
              configure(
                  new Seat(
                      s.number(),
                      s.name(),
                      s.element(),
                      s.controller(),
                      Difficulty.values()[(s.difficulty().ordinal() + 1) % 3],
                      s.connected())));
    }
    text(
        client == null
            ? "LOCAL = shared keyboard and mouse. AI = computer. REMOTE = network player."
            : client.status(),
        155,
        571);
    button("back", "Main menu", 155, 600, 290, 58, true, this::home);
    button(
        "start",
        owner ? "Start match" : "Waiting for host",
        850,
        600,
        330,
        58,
        owner && state.seats().stream().allMatch(Seat::connected),
        () -> {
          field = "";
          session.start();
          refresh();
        });
  }

  private void gameView() {
    if (state == null || board == null) return;
    canvas.map(state.theme(), BX, BY, TILE);
    panel(50, 60, 320, 642);
    panel(990, 60, 320, 642);
    text("CASTLE CASTERS", 97, 102);
    int active =
        state.phase() == Phase.FINISHED ? state.match().winner() : state.match().activePlayer();
    String activeName = state.seats().get(active - 1).name();
    String turnLabel =
        switch (state.phase()) {
          case FINISHED -> "Winner: " + activeName;
          case PAUSED -> "Match paused";
          case CLOSED -> "Session ended";
          default -> owned().contains(active) ? "Your turn" : "Caster " + active + "'s turn";
        };
    canvas.textFit(turnLabel, 75, 165, 270, 1.2f);
    text("Reach the far edge.", 75, 208);
    String[] goals = {"Top", "Bottom", "Right", "Left"};
    text("Goal: " + goals[active - 1], 75, 247);
    button("move", "Move [M]", 75, 290, 270, 58, true, () -> wallMode = false);
    button(
        "wall",
        wallMode ? "Wall selected [W]" : "Place wall [W]",
        75,
        365,
        270,
        58,
        true,
        () -> wallMode = true);
    button(
        "rotate",
        vertical ? "Vertical [R]" : "Horizontal [R]",
        75,
        440,
        270,
        58,
        true,
        () -> {
          wallMode = true;
          vertical = !vertical;
        });
    text("Right click: place wall", 75, 545);
    text("Esc: cancel selection", 75, 580);
    for (var s : state.seats()) {
      float y = 112 + (s.number() - 1) * 112;
      if (s.number() == active) canvas.rect(1005, y - 32, 280, 97, .3f, .46f, .23f, .5f);
      canvas.textFit(s.number() + ". " + s.name(), 1020, y, 265, 1.2f);
      text(s.element() + " / " + s.controller(), 1020, y + 28);
      text(
          state.match().wallsLeft().get(s.number() - 1)
              + " walls"
              + (s.connected() ? "" : " / offline"),
          1020,
          y + 57);
    }
    if (canTurn() && !wallMode)
      for (var move : moves) {
        float x = BX + move.x() * TILE + 7, y = BY + (16 - move.y()) * TILE + 7;
        boolean hover = mx >= x - 7 && mx < x + 21 && my >= y - 7 && my < y + 21;
        canvas.rect(
            x, y, 14, 14, hover ? 1 : .63f, .93f, .39f, .75f + (float) Math.sin(time * 4) * .2f);
      }
    for (int i = 0; i < state.match().walls().size(); i++) {
      var w = state.match().walls().get(i);
      boolean arriving =
          animation > 0
              && previous != null
              && previous.match() != null
              && i >= previous.match().walls().size();
      drawWall(w, arriving ? 1 - animation / .42f : 1);
      if (arriving)
        for (int spark = 0; spark < 8; spark++) {
          float t = 1 - animation / .42f, angle = spark * (float) Math.PI / 4;
          canvas.rect(
              BX + w.x() * TILE + (float) Math.cos(angle) * t * 50,
              BY + (16 - w.y()) * TILE + (float) Math.sin(angle) * t * 50,
              4,
              4,
              1,
              .8f,
              .3f,
              1 - t);
        }
    }
    if (canTurn() && wallMode) {
      var p = preview(vertical);
      if (p != null) {
        if (legal(p)) drawWall(new Wall(p.seat(), p.x(), p.y(), vertical), .55f);
        else
          canvas.rect(
              BX + p.x() * TILE + (vertical ? 5 : 0),
              BY + (16 - p.y()) * TILE - (vertical ? 56 : 0) + (vertical ? 0 : 5),
              vertical ? 18 : 84,
              vertical ? 84 : 18,
              .9f,
              .1f,
              .1f,
              .3f);
      }
    }
    for (var pawn : state.match().pawns()) {
      float x = pawn.x(), y = pawn.y(), arc = 0;
      String direction = "FRONT";
      boolean casting = false;
      if (animation > 0
          && previous != null
          && previous.match() != null
          && state.lastTurn() != null
          && state.lastTurn().seat() == pawn.seat()) {
        var old = previous.match().pawns().get(pawn.seat() - 1);
        float t = 1 - animation / .42f;
        float eased = t * t * (3 - 2 * t);
        casting =
            state.lastTurn().type().equals("VERTICAL")
                || state.lastTurn().type().equals("HORIZONTAL");
        if (!casting) {
          x = old.x() + (pawn.x() - old.x()) * eased;
          y = old.y() + (pawn.y() - old.y()) * eased;
          direction = pawn.x() != old.x() ? "SIDE" : pawn.y() > old.y() ? "BACK" : "FRONT";
          if (state.lastTurn().type().equals("JUMP") || state.lastTurn().type().equals("DIAGONAL"))
            arc = (float) Math.sin(t * Math.PI) * 18;
        }
      }
      var s = state.seats().get(pawn.seat() - 1);
      String element = s.element() == Element.WIND ? "AIR" : s.element().name();
      var texture = TextureName.valueOf(element + "_WIZARD_" + (casting ? "CAST" : direction));
      var sprite = canvas.texture(texture);
      int frames = sprite.height() / 32, frame = (int) (time * (casting ? 14 : 5)) % frames;
      canvas.image(
          texture,
          BX + x * TILE - 6,
          BY + (16 - y) * TILE - 16 - arc,
          40,
          40,
          0,
          frame * 32f / sprite.height(),
          1,
          32f / sprite.height(),
          1);
    }
    panel(400, 57, 534, 57);
    String status =
        state.phase() == Phase.FINISHED
            ? owned().contains(active) ? "You win!" : "Caster " + active + " wins!"
            : state.phase() == Phase.CLOSED
                ? state.message()
                : state.phase() == Phase.PAUSED
                    ? "Paused - waiting for a player"
                    : pending
                        ? "Waiting for host"
                        : state.aiThinking()
                            ? "Caster is thinking..."
                            : canTurn()
                                ? "Your turn - "
                                    + (wallMode ? "place a wall" : "choose a green destination")
                                : "Waiting for caster " + active;
    canvas.textFit(status, 425, 94, 480, 1.2f);
    if (client != null) canvas.textFit(client.status(), 1015, 590, 280, 1.2f);
    if (state.phase() == Phase.PAUSED && session != null)
      button(
          "replace",
          "Replace offline with AI",
          1008,
          574,
          285,
          50,
          true,
          () -> session.replaceDisconnected());
    if (state.phase() == Phase.FINISHED && session != null)
      button(
          "rematch",
          "Rematch / lobby",
          467,
          650,
          400,
          55,
          true,
          () -> {
            session.lobby();
            refresh();
          });
    button("back", "Main menu", 1008, 637, 285, 50, true, this::home);
  }

  private void drawWall(Wall wall, float alpha) {
    var element = state.seats().get(wall.seat() - 1).element();
    var texture =
        switch (element) {
          case FIRE -> TextureName.FIRE_WALL;
          case ICE -> TextureName.ICE_WALL;
          case EARTH -> TextureName.EARTH_WALL;
          case WIND -> TextureName.AIR_WALL;
        };
    // Elemental strips use their actual artwork, with orientation-independent placement geometry.
    float x = BX + wall.x() * TILE, y = BY + (16 - wall.y()) * TILE;
    float wx = x + (wall.vertical() ? 5 : 0),
        wy = y - (wall.vertical() ? 56 : 0) + (wall.vertical() ? 0 : 5),
        ww = wall.vertical() ? 18 : 84,
        wh = wall.vertical() ? 84 : 18;
    canvas.rect(wx - 2, wy - 2, ww + 4, wh + 4, .025f, .03f, .04f, alpha);
    canvas.image(
        texture,
        wx,
        wy,
        ww,
        wh,
        wall.vertical() ? 0 : .25f,
        wall.vertical() ? .2f : 0,
        .25f,
        .2f,
        alpha);
  }

  private void home() {
    release();
    scene = "menu";
    feedback = "";
    field = "";
    sound.play(com.shepherdjerred.castlecasters.engine.audio.AudioName.THEME_MUSIC);
  }

  private void release() {
    if (host != null) {
      host.close();
      host = null;
    }
    if (client != null) {
      client.close();
      client = null;
    }
    if (discovery != null) {
      discovery.close();
      discovery = null;
    }
    if (session != null) {
      session.close();
      session = null;
    }
    state = null;
    board = null;
    previous = null;
    moves = List.of();
    animation = 0;
    pending = false;
    wallMode = false;
    vertical = false;
    pressedControl = "";
  }

  @Override
  public Map<String, Object> inspect() {
    var result = new LinkedHashMap<String, Object>();
    result.put("scene", scene);
    result.put("animation", animation);
    result.put("mode", wallMode ? "wall" : "move");
    result.put("vertical", vertical);
    result.put("feedback", feedback);
    result.put("canTurn", canTurn());
    result.put("moves", moves);
    if (state != null) result.put("session", state);
    result.put(
        "controls",
        buttons.entrySet().stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    Map.Entry::getKey,
                    e ->
                        Map.of(
                            "x",
                            e.getValue().x(),
                            "y",
                            e.getValue().y(),
                            "w",
                            e.getValue().w(),
                            "h",
                            e.getValue().h(),
                            "enabled",
                            e.getValue().enabled()))));
    result.put("board", Map.of("x", BX, "y", BY, "tile", TILE, "grid", 17));
    result.put(
        "viewport",
        Map.of(
            "width",
            logical.width(),
            "height",
            logical.height(),
            "framebufferWidth",
            framebuffer.width(),
            "framebufferHeight",
            framebuffer.height()));
    if (client != null) result.put("connection", client.status());
    return result;
  }

  @Override
  public void interruptConnection() {
    if (client == null) throw new IllegalStateException("No remote connection");
    client.interruptConnection();
  }

  @Override
  public void scenario(String fixture, long seed) {
    home();
    if (fixture.equals("menu")) return;
    session = new GameSession(true);
    session.resize(fixture.endsWith("4") ? 4 : 2);
    scene = "lobby";
    if (fixture.startsWith("lobby")) {
      refresh();
      return;
    }
    session.start();
    var d = session.snapshot().match();
    var pawns = new ArrayList<>(d.pawns());
    switch (fixture) {
      case "board2", "board4" -> {}
      case "near-victory" -> {
        pawns.set(0, new Pawn(1, 8, 14));
        pawns.set(1, new Pawn(2, 0, 14));
      }
      case "jump" -> {
        pawns.set(0, new Pawn(1, 8, 8));
        pawns.set(1, new Pawn(2, 8, 10));
      }
      case "diagonal" -> {
        pawns.set(0, new Pawn(1, 8, 14));
        pawns.set(1, new Pawn(2, 8, 16));
      }
      default -> throw new IllegalArgumentException("Unknown fixture: " + fixture);
    }
    session.fixture(new MatchData(9, 10, 1, 1, pawns, List.of(), d.wallsLeft(), 0));
    refresh();
  }

  @Override
  public void cleanup() {
    release();
    canvas.close();
    sound.close();
    audio.cleanup();
  }
}
