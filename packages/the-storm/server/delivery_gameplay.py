"""Real MCBridge/Citizens effects on a restored production copy, never a synthetic world."""

import base64
import struct
from collections.abc import Callable

from restoration_json import JsonObject


def block_state(call: Callable[..., JsonObject], box: JsonObject) -> str:
    observed = call("POST", "regions/read", box)
    palette = observed.string_list("palette")
    encoded = base64.b64decode(observed.string("blocks"), validate=True)
    if len(encoded) != 4:
        raise ValueError("Towns protection probe did not observe exactly one native block")
    index = struct.unpack("<I", encoded)[0]
    if index >= len(palette):
        raise ValueError("Native block palette index is invalid")
    return palette[index]


def verify_towns_protection(call: Callable[..., JsonObject], world: str) -> JsonObject:
    # This point is inside the image-owned Spawn Town cuboid. The module must
    # deny construction even at air height; no synthetic terrain is installed.
    position = {"x": 0, "y": 300, "z": 0}
    box = JsonObject({"world": world, "min": position, "max": position})
    before = block_state(call, box)
    if before != "minecraft:air":
        raise ValueError("Reviewed Spawn Town protection probe requires native air at its fixed point")
    actor = "DeliveryGuest"
    created = call(
        "POST", "actors", {"name": actor, "world": world, "at": position, "gameMode": "CREATIVE", "op": False}
    )
    if created.get("name") != actor or created.get("op") is not False:
        raise ValueError("Towns protection requires the exact unprivileged Citizens actor")
    try:
        action = call("POST", "actors/" + actor + "/place", {"pos": position, "block": "minecraft:diamond_block"})
        after = block_state(call, box)
        if (
            action.get("ok") is not False
            or "BlockPlaceEvent listener cancelled" not in action.string("detail")
            or after != before
        ):
            raise ValueError("Towns protection did not deny and preserve the observed native block")
        return JsonObject(
            {
                "check": "towns-spawn-build-denial",
                "actorUuid": created.string("uuid"),
                "before": before,
                "after": after,
                "denied": True,
            }
        )
    finally:
        call("DELETE", "actors/" + actor)


def verify_gameplay(call: Callable[..., JsonObject]) -> JsonObject:
    """Observe a real Citizens command's inventory effect; never accept ok alone."""
    info = call("GET", "info")
    plugins = {plugin.string("name"): plugin.get("enabled") for plugin in info.objects("plugins")}
    if any(plugins.get(name) is not True for name in ("TheStorm", "MCBridge", "Citizens", "LuckPerms")):
        raise ValueError("Candidate lacks enabled real gameplay dependencies")
    world = next(
        (world.string("name") for world in info.objects("worlds") if world.get("key") == "minecraft:overworld"), None
    )
    if world is None:
        raise ValueError("Candidate did not load the restored native overworld")
    actor = "DeliveryCheck"
    created = call(
        "POST",
        "actors",
        {"name": actor, "world": world, "at": {"x": 0, "y": 300, "z": 0}, "gameMode": "CREATIVE", "op": True},
    )
    if created.get("name") != actor or created.get("world") != world:
        raise ValueError("Candidate did not create the requested Citizens actor")
    try:
        before = call("GET", "actors/" + actor)
        if before.objects("inventory"):
            raise ValueError("New validation actor unexpectedly has persisted inventory")
        call("POST", "actors/" + actor + "/command", {"command": "/minecraft:give @s minecraft:diamond 1"})
        after = call("GET", "actors/" + actor)
        diamonds = sum(
            item.integer("count") for item in after.objects("inventory") if item.get("item") == "minecraft:diamond"
        )
        if diamonds != 1 or after.object("actor").get("uuid") != created.get("uuid"):
            raise ValueError("Candidate gameplay command did not produce its observed inventory effect")
        protection = verify_towns_protection(call, world)
        return JsonObject(
            {
                "check": "citizens-command-inventory",
                "status": "VERIFIED",
                "nativeWorld": world,
                "actorUuid": created.string("uuid"),
                "diamondsBefore": 0,
                "diamondsAfter": diamonds,
                "townsProtection": protection,
            }
        )
    finally:
        call("DELETE", "actors/" + actor)
