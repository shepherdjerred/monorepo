package com.shepherdjerred.castlecasters.harness;

import static org.lwjgl.opengl.GL11.*;
import static org.lwjgl.stb.STBImageWrite.*;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shepherdjerred.castlecasters.engine.*;
import com.shepherdjerred.castlecasters.engine.events.CloseApplicationEvent;
import com.shepherdjerred.castlecasters.engine.events.input.*;
import com.shepherdjerred.castlecasters.engine.input.keyboard.Key;
import com.shepherdjerred.castlecasters.engine.input.mouse.*;
import com.shepherdjerred.castlecasters.engine.window.*;
import com.shepherdjerred.castlecasters.events.*;
import com.shepherdjerred.castlecasters.game.CastleCastersGame;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.concurrent.*;
import org.lwjgl.stb.STBIWriteCallback;
import org.lwjgl.system.MemoryUtil;

/** Development-only HTTP adapter. Not included in the application JAR. */
public final class HarnessMain {
  public static void main(String[] args) throws Exception {
    int port = args.length > 0 ? Integer.parseInt(args[0]) : 4188;
    boolean manual = args.length < 2 || !args[1].equals("realtime");
    var bus = new EventBus<Event>();
    InspectableGame game = new CastleCastersGame(bus, true);
    var control = new LoopControl(manual);
    var gson = new Gson();
    var executor = Executors.newCachedThreadPool();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
    server.setExecutor(executor);
    server.createContext(
        "/",
        exchange -> {
          try {
            if (exchange.getRequestHeaders().containsKey("Origin")) {
              throw new IllegalArgumentException("Browser origins are not accepted");
            }
            var path = exchange.getRequestURI().getPath();
            var method = exchange.getRequestMethod();
            byte[] body;
            if (method.equals("GET") && path.equals("/state")) {
              body =
                  gson.toJson(
                          control
                              .submit(
                                  () -> {
                                    var state = new java.util.LinkedHashMap<>(game.inspect());
                                    state.put("settled", control.settled());
                                    return state;
                                  })
                              .get(10, TimeUnit.SECONDS))
                      .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            } else if (method.equals("GET") && path.equals("/frame.png")) {
              body = control.submit(HarnessMain::frame).get(10, TimeUnit.SECONDS);
              exchange.getResponseHeaders().set("Content-Type", "image/png");
            } else if (method.equals("POST")) {
              var bytes = exchange.getRequestBody().readNBytes(65537);
              if (bytes.length > 65536) throw new IllegalArgumentException("Request too large");
              JsonObject command =
                  gson.fromJson(
                      new String(bytes, java.nio.charset.StandardCharsets.UTF_8), JsonObject.class);
              if (command == null) command = new JsonObject();
              final var input = command;
              control
                  .submit(
                      () -> {
                        switch (path) {
                          case "/step" -> control.advance(input.get("seconds").getAsDouble());
                          case "/scenario" ->
                              game.scenario(
                                  input.get("name").getAsString(),
                                  input.has("seed") ? input.get("seed").getAsLong() : 1);
                          case "/input" -> input(bus, input);
                          case "/shutdown" -> bus.dispatch(new CloseApplicationEvent());
                          case "/disconnect" -> game.interruptConnection();
                          case "/resize" -> {
                            int width = input.get("width").getAsInt(),
                                height = input.get("height").getAsInt();
                            if (width < 640 || width > 1920 || height < 480 || height > 1080)
                              throw new IllegalArgumentException("Resize outside harness bounds");
                            org.lwjgl.glfw.GLFW.glfwSetWindowSize(
                                org.lwjgl.glfw.GLFW.glfwGetCurrentContext(), width, height);
                          }
                          default -> throw new IllegalArgumentException("Unknown command: " + path);
                        }
                        return true;
                      })
                  .get(10, TimeUnit.SECONDS);
              body = "{\"ok\":true}".getBytes();
            } else {
              exchange.sendResponseHeaders(404, -1);
              return;
            }
            if (!path.equals("/frame.png"))
              exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
          } catch (Exception e) {
            var reason = e instanceof ExecutionException ? e.getCause() : e;
            byte[] body =
                gson.toJson(Map.of("error", reason.toString()))
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(400, body.length);
            exchange.getResponseBody().write(body);
          } finally {
            exchange.close();
          }
        });
    server.start();
    try {
      new GameEngine(
              game,
              new WindowSettings(
                  "Castle Casters — harness",
                  new WindowSize(1360, 768),
                  false,
                  false,
                  java.util.Arrays.stream(args).noneMatch("hidden"::equals)),
              bus,
              control)
          .run();
    } finally {
      server.stop(0);
      executor.shutdownNow();
    }
  }

  private static void input(EventBus<Event> bus, JsonObject command) {
    var type = command.get("type").getAsString();
    switch (type) {
      case "text" ->
          command
              .get("text")
              .getAsString()
              .codePoints()
              .forEach(c -> bus.dispatch(new TextInputEvent(c)));
      case "move" ->
          bus.dispatch(
              new MouseMoveEvent(
                  new MouseCoordinate(command.get("x").getAsInt(), command.get("y").getAsInt())));
      case "down", "up" -> {
        var position =
            new MouseCoordinate(command.get("x").getAsInt(), command.get("y").getAsInt());
        bus.dispatch(new MouseMoveEvent(position));
        var button = MouseButton.valueOf(command.get("button").getAsString());
        if (type.equals("down")) bus.dispatch(new MouseButtonDownEvent(button, position));
        else bus.dispatch(new MouseButtonUpEvent(button, position));
      }
      case "keyDown" ->
          bus.dispatch(new KeyPressedEvent(Key.valueOf(command.get("key").getAsString())));
      case "keyUp" ->
          bus.dispatch(new KeyReleasedEvent(Key.valueOf(command.get("key").getAsString())));
      default -> throw new IllegalArgumentException("Unknown input: " + type);
    }
  }

  private static byte[] frame() {
    int[] widths = new int[1], heights = new int[1];
    org.lwjgl.glfw.GLFW.glfwGetFramebufferSize(
        org.lwjgl.glfw.GLFW.glfwGetCurrentContext(), widths, heights);
    int width = widths[0], height = heights[0];
    ByteBuffer pixels = MemoryUtil.memAlloc(width * height * 4);
    var output = new ByteArrayOutputStream();
    try (var callback =
        STBIWriteCallback.create(
            (context, data, size) -> {
              byte[] bytes = new byte[size];
              MemoryUtil.memByteBuffer(data, size).get(bytes);
              output.writeBytes(bytes);
            })) {
      glReadBuffer(GL_FRONT);
      glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
      stbi_flip_vertically_on_write(true);
      if (!stbi_write_png_to_func(callback, 0, width, height, 4, pixels, width * 4)) {
        throw new IllegalStateException("Frame encoding failed");
      }
      return output.toByteArray();
    } finally {
      MemoryUtil.memFree(pixels);
    }
  }
}
