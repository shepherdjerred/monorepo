import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { verifyForumBundleZip } from "./zip.ts";
import { zipDirectory } from "./zip-directory.ts";

function fixture() {
  const policy = structuredClone(forumBundlePolicy),
    files: Record<string, Uint8Array> = {
      "src/XF.php": strToU8(
        `<?php class XF { public static $version = '${policy.xenforoVersion}'; }`,
      ),
      "src/XF/App.php": strToU8("<?php // synthetic unlicensed fixture"),
      "index.php": strToU8("<?php"),
      "cmd.php": strToU8("<?php"),
    };
  for (const dependency of policy.vendorDependencies) {
    const bytes = strToU8(`synthetic ${dependency.mode} style fixture`);
    dependency.sha256 = createHash("sha256").update(bytes).digest("hex");
    files[dependency.path] = bytes;
  }
  return { policy, files };
}

describe("licensed ZIP independent verification", () => {
  test("fully checks canonical legacy Python ZIP format without repacking or embedded receipt", async () => {
    const { files, policy } = fixture();
    const source = `import sys,json,zipfile,io,base64,stat
files=json.load(sys.stdin); out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,data in sorted(files.items()):
  i=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); i.external_attr=(stat.S_IFREG|0o644)<<16; i.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(i,base64.b64decode(data))
sys.stdout.buffer.write(out.getvalue())`;
    const child = Bun.spawn(["python3", "-c", source], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await child.stdin.write(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(files).map(([name, bytes]) => [
            name,
            Buffer.from(bytes).toString("base64"),
          ]),
        ),
      ),
    );
    await child.stdin.end();
    const bytes = new Uint8Array(
      await new Response(child.stdout).arrayBuffer(),
    );
    expect(await child.exited).toBe(0);
    await expect(verifyForumBundleZip(bytes, policy)).resolves.toBeUndefined();
    expect(zipDirectory(bytes).size).toBe(Object.keys(files).length);
  });
  test.each([
    "../escape.php",
    "/absolute.php",
    "src/../config.php",
    String.raw`bad\path`,
    "a//b",
  ])("rejects unsafe name %s", (name) => {
    expect(() => zipDirectory(zipSync({ [name]: strToU8("unsafe") }))).toThrow(
      /unsafe/u,
    );
  });
  test("rejects symlink attributes despite valid safe-looking path", () => {
    const bytes = zipSync({ "safe.php": strToU8("target") }),
      view = new DataView(bytes.buffer);
    const offset = view.getUint32(bytes.length - 6, true);
    view.setUint32(offset + 38, 0o12_0777 << 16, true);
    expect(() => zipDirectory(bytes)).toThrow(/unsafe/u);
  });
  test("rejects duplicate or inconsistent local header and expansion limit", () => {
    const bytes = zipSync({ "safe.php": strToU8("content") }),
      view = new DataView(bytes.buffer),
      offset = view.getUint32(bytes.length - 6, true);
    bytes[30] = 88;
    expect(() => zipDirectory(bytes)).toThrow(/unsafe/u);
    view.setUint32(offset + 24, 65 * 1024 * 1024, true);
    expect(() => zipDirectory(bytes)).toThrow(/unsafe/u);
  });
  test("rejects corrupt data CRC and installed configuration", async () => {
    const { files, policy } = fixture(),
      bytes = zipSync(files, { level: 0 });
    const location = zipDirectory(bytes).get("index.php");
    if (location === undefined) throw new Error("Fixture entry missing");
    bytes[location.end - 1] = 88;
    await expect(verifyForumBundleZip(bytes, policy)).rejects.toThrow(
      /corrupt/u,
    );
    await expect(
      verifyForumBundleZip(
        zipSync({ ...files, "src/config.php": strToU8("secret") }),
        policy,
      ),
    ).rejects.toThrow(/configuration/u);
  });
  test("rejects missing files, wrong version or licensed style hash", async () => {
    const { files, policy } = fixture();
    await expect(
      verifyForumBundleZip(
        zipSync({ "index.php": files["index.php"] ?? new Uint8Array() }),
        policy,
      ),
    ).rejects.toThrow(/unsafe/u);
    await expect(
      verifyForumBundleZip(
        zipSync({
          ...files,
          "src/XF.php": strToU8(
            "<?php class XF { public static $version='1.0.0'; }",
          ),
        }),
        policy,
      ),
    ).rejects.toThrow(/version/u);
    await expect(verifyForumBundleZip(zipSync(files))).rejects.toThrow(
      /checksum/u,
    );
  });
});
