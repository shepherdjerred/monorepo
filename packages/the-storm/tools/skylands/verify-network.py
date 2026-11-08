"""Extended native-client beacon acceptance on an already prepared disposable world copy."""

import argparse
import concurrent.futures
import http.client
import json
import math
import re
import socket
import threading
import time
from pathlib import Path
from typing import Any

CATALOG = Path(__file__).resolve().parents[2] / "server/owned/plugins/TheStorm/skytravel.json"


def neighbours() -> list[tuple[str, str]]:
    links = [("H", f"I{i}") for i in range(1, 7)]
    links += [(f"I{i}", f"I{i % 6 + 1}") for i in range(1, 7)]
    links += [(f"O{i}", f"O{i % 12 + 1}") for i in range(1, 13)]
    links += [
        (f"O{i}", f"I{inner}")
        for i, inner in enumerate([6, 1, 2, 2, 3, 3, 4, 4, 4, 5, 6, 6], 1)
    ]
    return [route for a, b in links for route in [(a, b), (b, a)]]


class Harness:
    def __init__(self, daemon: Path, target: str):
        self.daemon, self.target = daemon, target

    def request(self, route: str, body: dict[str, Any] | None = None) -> Any:
        connection = http.client.HTTPConnection("localhost", timeout=20)
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(20)
        connection.sock.connect(str(self.daemon))
        try:
            connection.request(
                "GET" if body is None else "POST", route,
                body=None if body is None else json.dumps(body),
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            value = json.load(response)
            if response.status != 200:
                raise RuntimeError(f"Harness HTTP {response.status}: {value}")
            return value
        finally:
            connection.close()

    def console(self, command: str) -> str:
        result = self.request(f"/targets/{self.target}/command", {"command": command})
        if not result["success"]:
            raise RuntimeError(result["output"])
        return "\n".join(result["output"]).strip()

    def client(self, name: str, action: str = "", body: dict[str, Any] | None = None) -> Any:
        result = self.request(f"/clients/{name}" + (f"/{action}" if action else ""), body)
        return result["state"] if not action else result


class Pilot:
    def __init__(self, harness: Harness, name: str, towers: dict[str, Any], output: Path):
        self.harness, self.name, self.towers, self.output = harness, name, towers, output
        self.samples: list[dict[str, Any]] = []

    def action(self, action: str, body: dict[str, Any] | None = None) -> Any:
        return self.harness.client(self.name, action, {} if body is None else body)

    def sample(self) -> dict[str, Any]:
        state = self.harness.client(self.name)
        self.samples.append({"at": time.time(), **{
            key: state.get(key) for key in ("position", "world", "health", "connected", "screen", "yaw", "pitch", "fps")
        }})
        if not state["connected"] or state["health"] <= 0:
            raise RuntimeError("Native pilot disconnected or died")
        return state

    def wait(self, predicate: Any, seconds: float) -> dict[str, Any]:
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            state = self.sample()
            if predicate(state):
                return state
            time.sleep(0.2)
        raise TimeoutError("Native flight condition timed out")

    def teleport(self, pad: dict[str, int], offset: float = 0.5) -> None:
        self.harness.console(
            f"minecraft:execute as {self.name} in minecraft:skylands run minecraft:tp @s "
            f"{pad['x'] + offset} {pad['y']} {pad['z'] + offset} -90 5"
        )

    def flight(self, source: str, destination: str) -> dict[str, Any]:
        self.samples = []
        result: dict[str, Any] = {"player": self.name, "from": source, "to": destination}
        pad, target = self.towers[source]["pad"], self.towers[destination]["pad"]
        x, z = target["x"] + 0.5, target["z"] + 0.5
        try:
            self.teleport(pad)
            self.wait(lambda s: s["world"] == "minecraft:skylands" and abs(s["position"][1] - pad["y"]) < 0.1, 10)
            previous = self.sample()["position"]

            def settled(state: dict[str, Any]) -> bool:
                nonlocal previous
                quiet = math.dist(previous, state["position"]) < 0.005
                previous = state["position"]
                return quiet

            self.wait(settled, 5)
            self.teleport(pad)
            self.wait(lambda s: math.dist(s["position"], [pad["x"] + 0.5, pad["y"], pad["z"] + 0.5]) < 0.05, 5)
            self.action("look", {"yaw": 270, "pitch": 5})
            before = self.wait(lambda s: s["target"].get("type") == "minecraft:stone_button", 5)
            started = time.monotonic()
            self.action("use")
            self.wait(lambda s: s["position"][1] >= 470, 20)
            while time.monotonic() - started < 110:
                state = self.sample()
                px, _, pz = state["position"]
                distance = math.hypot(x - px, z - pz)
                if distance < 0.75:
                    break
                yaw = math.degrees(math.atan2(-(x - px), z - pz))
                pitch = 0 if distance > 30 else 60 if distance > 8 else 80
                self.action("look", {"yaw": yaw, "pitch": pitch})
                if "gliding" not in result and math.hypot(px - pad["x"] - 0.5, pz - pad["z"] - 0.5) > 5:
                    flying = self.harness.console(f"minecraft:data get entity {self.name} FallFlying")
                    result["gliding"] = flying.endswith("1b")
                    if not result["gliding"]:
                        raise AssertionError("Server did not confirm gliding")
                time.sleep(0.2)
            else:
                raise TimeoutError("Cruise timed out")
            self.action("look", {"yaw": 0, "pitch": 90})
            landed = self.wait(lambda s: s["position"][1] <= target["y"] + 0.05, 30)
            if math.hypot(landed["position"][0] - x, landed["position"][2] - z) >= 2:
                raise AssertionError("Missed destination pad")
            if landed["health"] != before["health"] or landed["inventory"] != before["inventory"]:
                raise AssertionError("Health or inventory changed during flight")
            self.wait(lambda s: abs(s["position"][1] - target["y"]) < 0.01, 3)
            if not self.harness.console(f"minecraft:data get entity {self.name} FallFlying").endswith("0b"):
                raise AssertionError("Gliding did not end on landing")
            result.update(status="PASS", seconds=round(time.monotonic() - started, 2), landed=landed["position"])
        except Exception as error:
            result.update(status="FAIL", error=str(error))
        finally:
            self.teleport(target if result.get("status") == "PASS" else pad, offset=-4.5)
            stem = self.output / f"{source}-{destination}"
            stem.with_suffix(".samples.json").write_text(json.dumps(self.samples) + "\n")
            stem.with_suffix(".result.json").write_text(json.dumps(result, indent=2) + "\n")
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daemon-socket", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--clients", nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--link", nargs=2, metavar=("FROM", "TO"))
    args = parser.parse_args()
    if not re.fullmatch(r"sbx-[a-f0-9]{6}", args.target):
        parser.error("Only disposable sandbox targets are allowed")
    if len(set(args.clients)) != len(args.clients) or any(not re.fullmatch(r"\w{3,16}", name) for name in args.clients):
        parser.error("Use unique native client names")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    catalog = json.loads(CATALOG.read_text())
    towers = {tower["id"]: tower for tower in catalog["towers"]}
    if not all(tower["commissioned"] for tower in towers.values()):
        raise ValueError("This suite requires a commissioned network on a disposable copy")
    harness = Harness(args.daemon_socket, args.target)
    for name in args.clients:
        state = harness.request(f"/clients/{name}")
        if state["client"]["target"] != args.target:
            raise ValueError("Native client belongs to a different sandbox")
        harness.client(name, "close", {})
    routes = neighbours() if args.link is None else [tuple(args.link)]
    if any(a not in towers or b not in towers for a, b in routes):
        raise ValueError("Unknown beacon link")
    locks = {name: threading.Lock() for name in towers}

    def run(name: str, batch: list[tuple[str, str]]) -> list[dict[str, Any]]:
        pilot = Pilot(harness, name, towers, args.output)
        results = []
        for a, b in batch:
            with locks[a]:
                result = pilot.flight(a, b)
            print(json.dumps(result), flush=True)
            results.append(result)
            if result["status"] != "PASS":
                break
        return results

    count = len(args.clients)
    size = math.ceil(len(routes) / count)
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        futures = [pool.submit(run, name, routes[i * size:(i + 1) * size]) for i, name in enumerate(args.clients)]
        results = [result for future in futures for result in future.result()]
    if len(results) != len(routes) or any(result["status"] != "PASS" for result in results):
        raise RuntimeError("Native beacon network acceptance failed; inspect the private output")
    print(json.dumps({"passed": len(results), "target": args.target}), flush=True)


if __name__ == "__main__":
    main()
