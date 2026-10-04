package com.shepherdjerred.mcbridge.adapter.http;

import com.shepherdjerred.mcbridge.domain.BearerAuth;
import com.shepherdjerred.mcbridge.domain.BridgeConfig;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.Limits;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;

/** The JDK HTTP server: authenticates, reads bounded bodies, routes, and renders errors. */
public final class BridgeHttpServer {
  private static final int WORKERS = 4;

  private final HttpServer server;
  private final ExecutorService executor;
  private final Router router;
  private final BearerAuth auth;
  private final Logger logger;

  private BridgeHttpServer(
      HttpServer server, ExecutorService executor, Router router, BearerAuth auth, Logger logger) {
    this.server = server;
    this.executor = executor;
    this.router = router;
    this.auth = auth;
    this.logger = logger;
  }

  /** Binds and starts the server. */
  public static BridgeHttpServer start(BridgeConfig config, Router router, Logger logger)
      throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(config.bind(), config.port()), 0);
    AtomicInteger threads = new AtomicInteger();
    ExecutorService executor =
        Executors.newFixedThreadPool(
            WORKERS,
            runnable -> {
              Thread thread = new Thread(runnable, "MCBridge-http-" + threads.incrementAndGet());
              thread.setDaemon(true);
              return thread;
            });
    BridgeHttpServer bridge =
        new BridgeHttpServer(server, executor, router, new BearerAuth(config.token()), logger);
    server.createContext("/", bridge::handle);
    server.setExecutor(executor);
    server.start();
    return bridge;
  }

  /** Stops accepting requests and releases the worker threads. */
  public void stop() {
    server.stop(0);
    executor.shutdown();
    try {
      if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
        executor.shutdownNow();
      }
    } catch (InterruptedException e) {
      executor.shutdownNow();
      Thread.currentThread().interrupt();
    }
  }

  /** The bound port (useful when configured as 0). */
  public int port() {
    return server.getAddress().getPort();
  }

  private void handle(HttpExchange exchange) throws IOException {
    Response response;
    try {
      response = route(exchange);
    } catch (BridgeException e) {
      response = Response.error(e.code(), e.detail());
    } catch (RuntimeException e) {
      logger.log(Level.WARNING, "MCBridge request failed: " + exchange.getRequestURI(), e);
      response =
          Response.error(
              ErrorCode.INTERNAL, Objects.requireNonNullElse(e.getMessage(), e.toString()));
    }
    send(exchange, response);
  }

  private Response route(HttpExchange exchange) throws IOException {
    if (!auth.accepts(exchange.getRequestHeaders().getFirst("Authorization"))) {
      throw new BridgeException(ErrorCode.UNAUTHORIZED, "missing or wrong bearer token");
    }
    String method = exchange.getRequestMethod();
    String path = exchange.getRequestURI().getRawPath();
    Router.Match match = router.match(method, path);
    byte[] body = readBody(exchange);
    Request request =
        new Request(match.params(), query(exchange.getRequestURI().getRawQuery()), body);
    return match.handler().handle(request);
  }

  private static byte[] readBody(HttpExchange exchange) throws IOException {
    String declared = exchange.getRequestHeaders().getFirst("Content-Length");
    if (declared != null && parseLength(declared) > Limits.MAX_BODY_BYTES) {
      throw new BridgeException(ErrorCode.TOO_LARGE, "body exceeds " + Limits.MAX_BODY_BYTES);
    }
    try (InputStream in = exchange.getRequestBody()) {
      byte[] body = in.readNBytes(Limits.MAX_BODY_BYTES + 1);
      if (body.length > Limits.MAX_BODY_BYTES) {
        throw new BridgeException(ErrorCode.TOO_LARGE, "body exceeds " + Limits.MAX_BODY_BYTES);
      }
      return body;
    }
  }

  private static long parseLength(String declared) {
    try {
      return Long.parseLong(declared.trim());
    } catch (NumberFormatException e) {
      throw BridgeException.badRequest("Content-Length is not a number");
    }
  }

  private static Map<String, String> query(String rawQuery) {
    Map<String, String> query = new HashMap<>();
    if (rawQuery == null || rawQuery.isEmpty()) {
      return query;
    }
    for (String pair : rawQuery.split("&", -1)) {
      int equals = pair.indexOf('=');
      String key = equals < 0 ? pair : pair.substring(0, equals);
      String value = equals < 0 ? "" : pair.substring(equals + 1);
      query.put(
          URLDecoder.decode(key, StandardCharsets.UTF_8),
          URLDecoder.decode(value, StandardCharsets.UTF_8));
    }
    return query;
  }

  private static void send(HttpExchange exchange, Response response) throws IOException {
    exchange.getResponseHeaders().set("Content-Type", response.contentType());
    byte[] body = response.body();
    exchange.sendResponseHeaders(response.status(), body.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(body);
    }
  }
}
