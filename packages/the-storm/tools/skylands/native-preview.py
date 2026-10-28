"""Extended fresh-world acceptance. Requires the matching licensed Paper/API cache; never touches live data."""

import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent.parent
REPO = PACKAGE.parent.parent
CACHE = Path.home() / ".toolkit/mc/cache"
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--seed", type=int, required=True)
parser.add_argument("--order", choices=["forward", "reverse"], default="forward")
parser.add_argument("--cell-x", type=int, default=0)
parser.add_argument("--cell-z", type=int, default=0)
args = parser.parse_args()
root = args.output.resolve()
if root.exists():
    raise SystemExit("Refusing to overwrite an existing native preview: " + str(root))
artifacts = list((PACKAGE / "plugin/modules/skylands/build/libs").glob("skylands-[0-9]*.jar"))
if len(artifacts) != 1:
    raise SystemExit("Build :skylands:jar; expected exactly one module artifact")
module = artifacts[0]
jars = list((Path.home() / ".gradle/caches/modules-2/files-2.1").rglob("*.jar"))
api = next(p for p in jars if p.name == "paper-api-26.3.build.223-stable.jar")
deps = [
    p
    for p in jars
    if p.name.startswith(
        ("adventure-api-", "adventure-key-", "jspecify-", "annotations-", "guava-", "failureaccess-", "gson-")
    )
]
classpath = os.pathsep.join(map(str, [module, api, *deps]))
root.mkdir(parents=True)
classes = root / "classes"
classes.mkdir()
subprocess.run(
    [
        "javac",
        "--release",
        "25",
        "-cp",
        classpath,
        "-d",
        str(classes),
        str(HERE / "ProceduralSkylandsFixture.java"),
        str(HERE / "ProceduralSkylandsBootstrap.java"),
    ],
    check=True,
)
(root / "plugins").mkdir()
with zipfile.ZipFile(root / "plugins/ProceduralSkylands.jar", "w", zipfile.ZIP_DEFLATED) as out:
    with zipfile.ZipFile(module) as source:
        for name in source.namelist():
            out.writestr(name, source.read(name))
    for file in classes.rglob("*.class"):
        out.write(file, file.relative_to(classes))
    out.writestr(
        "paper-plugin.yml",
        "name: ProceduralSkylands\nversion: 1.0\n"
        "main: dev.tsmc.skylands.ProceduralSkylandsFixture\n"
        'bootstrapper: dev.tsmc.skylands.ProceduralSkylandsBootstrap\napi-version: "26.3"\n',
    )
(root / "eula.txt").write_text("eula=true\n")
flat = json.dumps(
    {"biome": "minecraft:plains", "layers": [{"block": "minecraft:bedrock", "height": 1}], "structure_overrides": []},
    separators=(",", ":"),
)
(root / "server.properties").write_text(
    "online-mode=false\nserver-ip=127.0.0.1\nserver-port=0\nenable-rcon=false\nlevel-type=minecraft:flat\ngenerator-settings="
    + flat
    + "\nview-distance=2\nsimulation-distance=2\nmax-players=1\n"
)
(root / "bukkit.yml").write_text("settings:\n  allow-end: false\n")
env = {k: v for k, v in os.environ.items() if k != "OP_SERVICE_ACCOUNT_TOKEN"}
cmd = [
    "java",
    "-Xmx4G",
    "-XX:ActiveProcessorCount=4",
    f"-DbundlerRepoDir={CACHE}/paperclip",
    f"-Dsky.fixture.seed={args.seed}",
    f"-Dsky.fixture.order={args.order}",
    f"-Dsky.fixture.cellX={args.cell_x}",
    f"-Dsky.fixture.cellZ={args.cell_z}",
    "-jar",
    str(CACHE / "paper-26.3-223.jar"),
    "nogui",
]
with (root / "console.log").open("w") as log:
    process = subprocess.Popen(
        cmd, cwd=root, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, start_new_session=True
    )
(root / "ownership.json").write_text(
    json.dumps(
        {
            "pid": process.pid,
            "cwd": str(root),
            "seed": args.seed,
            "moduleSha256": hashlib.sha256(module.read_bytes()).hexdigest(),
            "scope": "Disposable native generator acceptance; no Tailscale route or production mutation",
        },
        indent=2,
    )
)
print(json.dumps({"pid": process.pid, "directory": str(root), "log": str(root / "console.log")}))
