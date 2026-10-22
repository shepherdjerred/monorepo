import java.io.ByteArrayInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Public, fabricated fixtures only. No key generation or private signing material. */
class ReleaseValidatorChecks {
    @FunctionalInterface interface Check { void run() throws Exception; }
    private static void rejected(Check check) throws Exception {
        try { check.run(); } catch (IllegalArgumentException | SecurityException expected) { return; }
        throw new AssertionError("Invalid release input was accepted.");
    }
    private static byte[] elf(String abi, long alignment) {
        ByteBuffer result = ByteBuffer.allocate(120).order(ByteOrder.LITTLE_ENDIAN);
        result.put(new byte[]{0x7f, 'E', 'L', 'F', 2, 1});
        result.putShort(18, (short) (abi.equals("arm64-v8a") ? 183 : 62));
        result.putLong(32, 64).putShort(54, (short) 56).putShort(56, (short) 1);
        result.putInt(64, 1).putLong(112, alignment);
        return result.array();
    }
    private static void zip(Path target, Map<String, byte[]> entries) throws Exception {
        try (ZipOutputStream output = new ZipOutputStream(Files.newOutputStream(target))) {
            for (var entry : entries.entrySet()) {
                output.putNextEntry(new ZipEntry(entry.getKey()));
                output.write(entry.getValue());
                output.closeEntry();
            }
        }
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 4) throw new IllegalArgumentException("A pinned strip tool and two real ELF fixtures are required.");
        Path root = Path.of(args[0]);
        Path manifest = root.resolve("AndroidManifest.xml");
        String xml = "<manifest xmlns:android='http://schemas.android.com/apk/res/android' package='red.sjer.facet'><uses-sdk android:minSdkVersion='29' android:targetSdkVersion='36'/><application android:allowBackup='false'/></manifest>";
        Files.writeString(manifest, xml);
        ValidateSignedBundle.validateManifest(manifest);
        for (String invalid : Set.of(xml.replace("red.sjer.facet", "other.identity"), xml.replace("36", "35"), xml.replace("false", "true"))) {
            Files.writeString(manifest, invalid);
            rejected(() -> ValidateSignedBundle.validateManifest(manifest));
        }
        ValidateSignedBundle.elf(new ByteArrayInputStream(elf("arm64-v8a", 16384)), "arm64-v8a");
        rejected(() -> ValidateSignedBundle.elf(new ByteArrayInputStream(elf("arm64-v8a", 4096)), "arm64-v8a"));
        rejected(() -> ValidateSignedBundle.elf(new ByteArrayInputStream(elf("arm64-v8a", 16384)), "x86_64"));
        Map<String, byte[]> entries = new HashMap<>();
        for (String asset : Set.of("FirstPartyLicense.txt", "ThirdPartyNotices.txt", "native-license-inventory.json", "HostThirdPartyNotices.txt", "host-license-inventory.json", "jna-notice-sources.json")) entries.put("base/assets/" + asset, "public fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Path license = root.resolve("LICENSE");
        Files.write(license, entries.get("base/assets/FirstPartyLicense.txt"));
        Path rust = root.resolve("rust");
        for (String abi : Set.of("arm64-v8a", "x86_64")) {
            Files.createDirectories(rust.resolve(abi));
            for (String library : Set.of("libtasknotes_core_ffi.so", "libfacet_files.so", "libjnidispatch.so")) entries.put("base/lib/" + abi + "/" + library, elf(abi, 16384));
            Files.write(rust.resolve(abi).resolve("libtasknotes_core_ffi.so"), elf(abi, 16384));
        }
        Path original = root.resolve("original.aab"), candidate = root.resolve("candidate.aab");
        zip(original, entries);
        zip(candidate, entries);
        ValidateSignedBundle.validate(original, candidate, "unsigned", license, rust);
        rejected(() -> ValidateSignedBundle.validate(original, candidate, "a".repeat(64), license, rust));
        entries.put("base/assets/FirstPartyLicense.txt", "changed".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        zip(candidate, entries);
        rejected(() -> ValidateSignedBundle.validate(original, candidate, "unsigned", license, rust));
        entries.remove("base/assets/ThirdPartyNotices.txt");
        zip(original, entries);
        zip(candidate, entries);
        rejected(() -> ValidateSignedBundle.validate(original, candidate, "unsigned", license, rust));
        realStripChecks(root, Path.of(args[1]), Path.of(args[2]), Path.of(args[3]), license);
        System.out.println("Release identity, SDK/backup policy, native ELF alignment/ABI, unsigned signature rejection, changed payload and required notice checks passed.");
    }

    private static void realStripChecks(Path root, Path strip, Path arm, Path x86, Path license) throws Exception {
        Map<String, byte[]> entries = new HashMap<>();
        for (String asset : Set.of("FirstPartyLicense.txt", "ThirdPartyNotices.txt", "native-license-inventory.json", "HostThirdPartyNotices.txt", "host-license-inventory.json", "jna-notice-sources.json")) entries.put("base/assets/" + asset, Files.readAllBytes(license));
        Path rust = root.resolve("real-rust");
        for (String abi : Set.of("arm64-v8a", "x86_64")) {
            byte[] original = Files.readAllBytes(abi.equals("arm64-v8a") ? arm : x86);
            Path directory = rust.resolve(abi);
            Files.createDirectories(directory);
            Path source = directory.resolve("libtasknotes_core_ffi.so");
            Files.write(source, original);
            String transformed = ValidateSignedBundle.strippedDigest(source, strip);
            if (!Arrays.equals(original, Files.readAllBytes(source))) throw new AssertionError("Strip changed source bytes.");
            Path packaged = directory.resolve("packaged.so");
            Files.write(packaged, original);
            Process process = new ProcessBuilder(strip.toString(), "--strip-unneeded", packaged.toString()).inheritIO().start();
            if (process.waitFor() != 0) throw new AssertionError("Fixture strip failed.");
            byte[] stripped = Files.readAllBytes(packaged);
            if (Arrays.equals(original, stripped)) throw new AssertionError("Fixture must exercise actual debug-symbol transformation.");
            String expected = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(stripped));
            if (!transformed.equals(expected)) throw new AssertionError("Production transformation differs from pinned fixture strip.");
            for (String library : Set.of("libfacet_files.so", "libjnidispatch.so")) entries.put("base/lib/" + abi + "/" + library, elf(abi, 16384));
            entries.put("base/lib/" + abi + "/libtasknotes_core_ffi.so", stripped);
        }
        Path original = root.resolve("real-original.aab"), candidate = root.resolve("real-candidate.aab");
        zip(original, entries);
        zip(candidate, entries);
        ValidateSignedBundle.validate(original, candidate, "unsigned", license, rust, strip);
        byte[] correct = entries.get("base/lib/arm64-v8a/libtasknotes_core_ffi.so");
        byte[] corrupt = Arrays.copyOf(correct, correct.length + 1);
        corrupt[corrupt.length - 1] = 1;
        entries.put("base/lib/arm64-v8a/libtasknotes_core_ffi.so", corrupt);
        zip(original, entries);
        zip(candidate, entries);
        rejected(() -> ValidateSignedBundle.validate(original, candidate, "unsigned", license, rust, strip));
        Path nonElf = root.resolve("not-an-elf");
        Files.writeString(nonElf, "malformed native source");
        rejected(() -> ValidateSignedBundle.strippedDigest(nonElf, strip));
        for (String abi : Set.of("arm64-v8a", "x86_64")) {
            byte[] expected = Files.readAllBytes(abi.equals("arm64-v8a") ? arm : x86);
            if (!Arrays.equals(expected, Files.readAllBytes(rust.resolve(abi).resolve("libtasknotes_core_ffi.so")))) throw new AssertionError("Source changed after negative validation.");
        }
        System.out.println("Real two-ABI strip transformation, packaged mismatch and nonzero-tool rejection passed; original sources unchanged.");
    }
}
