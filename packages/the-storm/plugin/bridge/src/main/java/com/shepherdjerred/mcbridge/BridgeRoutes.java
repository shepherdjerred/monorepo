package com.shepherdjerred.mcbridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.adapter.http.Fields;
import com.shepherdjerred.mcbridge.adapter.http.Json;
import com.shepherdjerred.mcbridge.adapter.http.Request;
import com.shepherdjerred.mcbridge.adapter.http.Response;
import com.shepherdjerred.mcbridge.adapter.http.Router;
import com.shepherdjerred.mcbridge.adapter.paper.RegionReader;
import com.shepherdjerred.mcbridge.adapter.paper.ServerService;
import com.shepherdjerred.mcbridge.adapter.worldedit.SnapshotStore;
import com.shepherdjerred.mcbridge.adapter.worldedit.WorldEditService;
import com.shepherdjerred.mcbridge.domain.BridgeEvent;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.Limits;
import com.shepherdjerred.mcbridge.domain.Rotation;
import com.shepherdjerred.mcbridge.domain.SessionName;
import com.shepherdjerred.mcbridge.domain.SnapshotId;
import com.shepherdjerred.mcbridge.domain.WeOp;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** The {@code /v1} routes of the wire contract, bound to the services. */
final class BridgeRoutes {
  static final int API_VERSION = 1;

  private static final Set<String> NO_KEYS = Set.of();
  private static final Set<String> WE_OP_KEYS = Set.of("command", "pos1", "pos2", "at");

  private final String bridgeVersion;
  private final ServerService server;
  private final RegionReader regions;
  private final WorldEditService worldEdit;
  private final SnapshotStore snapshots;
  private final EventRing events;

  /** The services the routes call. */
  record Services(
      ServerService server,
      RegionReader regions,
      WorldEditService worldEdit,
      SnapshotStore snapshots,
      EventRing events) {}

  BridgeRoutes(String bridgeVersion, Services services) {
    this.bridgeVersion = bridgeVersion;
    this.server = services.server();
    this.regions = services.regions();
    this.worldEdit = services.worldEdit();
    this.snapshots = services.snapshots();
    this.events = services.events();
  }

  Router router() {
    return new Router()
        .add("GET", "/v1/health", this::health)
        .add("GET", "/v1/info", this::info)
        .add("GET", "/v1/registry", this::registry)
        .add("POST", "/v1/command", this::command)
        .add("POST", "/v1/regions/read", this::readRegion)
        .add("POST", "/v1/snapshots", this::createSnapshot)
        .add("GET", "/v1/snapshots", request -> Response.json(snapshots.list()))
        .add("GET", "/v1/snapshots/:id", this::snapshotBytes)
        .add("POST", "/v1/snapshots/:id/restore", this::restoreSnapshot)
        .add("POST", "/v1/we/run", this::weRun)
        .add("POST", "/v1/we/paste", this::wePaste)
        .add("POST", "/v1/we/undo", this::weUndo)
        .add("GET", "/v1/players", request -> Response.json(server.players()))
        .add("GET", "/v1/events", this::events);
  }

  private Response health(Request request) {
    JsonObject response = new JsonObject();
    response.addProperty("ok", true);
    response.addProperty("apiVersion", API_VERSION);
    response.addProperty("bridgeVersion", bridgeVersion);
    return Response.json(response);
  }

  private Response info(Request request) {
    JsonObject response = server.serverFacts();
    response.addProperty("apiVersion", API_VERSION);
    response.addProperty("bridgeVersion", bridgeVersion);
    response.addProperty("dataVersion", worldEdit.dataVersion());
    JsonArray capabilities = new JsonArray();
    capabilities.add("worldedit");
    response.add("capabilities", capabilities);
    return Response.json(response);
  }

  private Response registry(Request request) {
    JsonObject facts = server.serverFacts();
    JsonObject response = new JsonObject();
    response.addProperty("dataVersion", worldEdit.dataVersion());
    response.add("minecraftVersion", facts.get("minecraftVersion"));
    response.add("blocks", worldEdit.registryBlocks());
    return Response.json(response);
  }

  private Response command(Request request) {
    Fields body = request.json(Set.of("command"));
    return Response.json(server.command(body.nonEmptyString("command")));
  }

  private Response readRegion(Request request) {
    return Response.json(regions.read(request.json(Fields.BOX_KEYS).asBox()));
  }

  private Response createSnapshot(Request request) {
    Fields body = request.json(Set.of("box", "label"));
    String label = body.optionalString("label").orElse(null);
    if (label != null && label.length() > 80) {
      throw BridgeException.badRequest("label must be at most 80 characters");
    }
    return Response.json(snapshots.create(body.box("box"), Optional.ofNullable(label)));
  }

  private Response snapshotBytes(Request request) {
    return Response.bytes(snapshots.bytes(new SnapshotId(request.param("id"))));
  }

  private Response restoreSnapshot(Request request) {
    if (request.hasBody()) {
      request.json(NO_KEYS);
    }
    return Response.json(snapshots.restore(new SnapshotId(request.param("id"))));
  }

  private Response weRun(Request request) {
    Fields body = request.json(Set.of("session", "world", "ops"));
    JsonArray rawOps = body.array("ops");
    if (rawOps.isEmpty() || rawOps.size() > Limits.MAX_WE_OPS) {
      throw BridgeException.badRequest("ops must hold 1.." + Limits.MAX_WE_OPS + " entries");
    }
    List<WeOp> ops = new ArrayList<>();
    for (int i = 0; i < rawOps.size(); i++) {
      Fields op = Fields.of(rawOps.get(i), "body.ops[" + i + "]", WE_OP_KEYS);
      ops.add(
          new WeOp(
              op.nonEmptyString("command"),
              op.optionalBlockPos("pos1").orElse(null),
              op.optionalBlockPos("pos2").orElse(null),
              op.optionalBlockPos("at").orElse(null)));
    }
    return Response.json(
        worldEdit.run(new SessionName(body.string("session")), body.nonEmptyString("world"), ops));
  }

  private Response wePaste(Request request) {
    Fields body =
        request.json(Set.of("session", "world", "schematic", "at", "rotate", "ignoreAir"));
    byte[] schematic;
    try {
      schematic = Base64.getDecoder().decode(body.nonEmptyString("schematic"));
    } catch (IllegalArgumentException e) {
      throw BridgeException.badRequest("schematic is not valid base64");
    }
    WorldEditService.PasteResult result =
        worldEdit.paste(
            new SessionName(body.string("session")),
            body.nonEmptyString("world"),
            WorldEditService.decode(schematic),
            new WorldEditService.PastePlacement(
                body.blockPos("at"), new Rotation(body.integer("rotate")), body.bool("ignoreAir")));
    JsonObject response = new JsonObject();
    response.addProperty("changed", result.changed());
    response.add("min", Json.pos(result.min()));
    response.add("max", Json.pos(result.max()));
    response.addProperty("historySize", result.historySize());
    return Response.json(response);
  }

  private Response weUndo(Request request) {
    Fields body = request.json(Set.of("session", "steps"));
    int steps = body.integer("steps");
    if (steps < 1 || steps > Limits.MAX_UNDO_STEPS) {
      throw BridgeException.badRequest("steps must be 1.." + Limits.MAX_UNDO_STEPS);
    }
    return Response.json(worldEdit.undo(new SessionName(body.string("session")), steps));
  }

  private Response events(Request request) {
    request.requireQueryKeys(Set.of("since", "limit"));
    long since = request.queryLong("since", 0);
    long limit = request.queryLong("limit", Limits.MAX_EVENT_PAGE);
    if (limit < 1 || limit > Limits.MAX_EVENT_PAGE) {
      throw BridgeException.badRequest("limit must be 1.." + Limits.MAX_EVENT_PAGE);
    }
    EventRing.Page page = events.since(since, (int) limit);
    JsonArray list = new JsonArray();
    for (BridgeEvent event : page.events()) {
      list.add(event(event));
    }
    JsonObject response = new JsonObject();
    response.addProperty("cursor", page.cursor());
    response.addProperty("truncated", page.truncated());
    response.add("events", list);
    return Response.json(response);
  }

  private static JsonElement event(BridgeEvent event) {
    JsonObject object = new JsonObject();
    object.addProperty("seq", event.seq());
    object.addProperty("ts", event.ts().toString());
    object.addProperty("type", event.type().wire());
    if (event.player() != null) {
      object.addProperty("player", event.player());
    }
    object.addProperty("text", event.text());
    return object;
  }
}
