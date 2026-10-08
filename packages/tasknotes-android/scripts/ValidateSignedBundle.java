import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarFile;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

/** Public certificate and artifact verification only; this process never receives passwords. */
class ValidateSignedBundle {
    private static final Set<String> ABIS = Set.of("arm64-v8a", "x86_64");
    private static final Set<String> LIBRARIES = Set.of("libtasknotes_core_ffi.so", "libfacet_files.so", "libjnidispatch.so");

    public static void main(String[] args) {
        try {
            if (args.length != 7 || (!args[2].equals("unsigned") && !args[2].matches("[a-f0-9]{64}"))) throw new IllegalArgumentException();
            validateManifest(Path.of(args[5]));
            validate(Path.of(args[0]), Path.of(args[1]), args[2], Path.of(args[3]), Path.of(args[4]), Path.of(args[6]));
            System.out.println(args[2].equals("unsigned")
                ? "Unsigned bundle identity, GPL/notices and all native ELF segments verified; no signing claim."
                : "Pinned upload certificate, every signed payload, exact source bundle, GPL/notices and all native ELF segments verified.");
        } catch (Exception failure) {
            // Provider/JAR exceptions may contain identity, paths or host details. Keep diagnostics classified.
            System.err.println("Bundle validation failed: " + failure.getClass().getSimpleName());
            System.exit(1);
        }
    }

    private static boolean signatureMetadata(String name) {
        return name.equals("META-INF/MANIFEST.MF") || name.matches("META-INF/[A-Z0-9_-]{1,8}\\.(SF|RSA|DSA|EC)");
    }

    private static void safeName(String name) {
        if (name.startsWith("/") || name.contains("\\") || name.chars().anyMatch(c -> c < 32 || c == 127)) throw new IllegalArgumentException();
        for (String part : name.split("/")) if (part.equals("..") || part.equals(".") || part.isEmpty()) throw new IllegalArgumentException();
    }

    private static String digest(InputStream input) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        for (int size; (size = input.read(buffer)) != -1;) hash.update(buffer, 0, size);
        return HexFormat.of().formatHex(hash.digest());
    }

    private static Map<String, String> payloads(ZipFile zip) throws Exception {
        Map<String, String> result = new HashMap<>();
        Set<String> names = new HashSet<>();
        for (ZipEntry entry : zip.stream().toList()) {
            safeName(entry.getName());
            if (!names.add(entry.getName())) throw new IllegalArgumentException();
            if (entry.isDirectory() || signatureMetadata(entry.getName())) continue;
            try (InputStream input = zip.getInputStream(entry)) { result.put(entry.getName(), digest(input)); }
        }
        return result;
    }

    static void validate(Path original, Path signed, String expectedCertificate, Path license, Path rust) throws Exception {
        validate(original, signed, expectedCertificate, license, rust, null);
    }

    static void validate(Path original, Path signed, String expectedCertificate, Path license, Path rust, Path strip) throws Exception {
        try (ZipFile unsigned = new ZipFile(original.toFile()); JarFile bundle = new JarFile(signed.toFile(), true)) {
            Map<String, String> expected = payloads(unsigned);
            if (expected.isEmpty() || !expected.equals(payloads(bundle))) throw new SecurityException();
            for (String name : expected.keySet()) {
                if (expectedCertificate.equals("unsigned")) continue;
                CodeSigner[] signers = bundle.getJarEntry(name).getCodeSigners();
                if (signers == null || signers.length != 1) throw new SecurityException();
                X509Certificate leaf = (X509Certificate) signers[0].getSignerCertPath().getCertificates().getFirst();
                leaf.checkValidity();
                String certificate = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(leaf.getEncoded()));
                if (!expectedCertificate.equals(certificate)) throw new SecurityException();
                boolean[] usage = leaf.getKeyUsage();
                if (usage != null && (usage.length == 0 || !usage[0])) throw new SecurityException();
            }
            for (String asset : Set.of("FirstPartyLicense.txt", "ThirdPartyNotices.txt", "native-license-inventory.json", "HostThirdPartyNotices.txt", "host-license-inventory.json", "jna-notice-sources.json")) {
                ZipEntry entry = bundle.getEntry("base/assets/" + asset);
                if (entry == null || entry.getSize() <= 0) throw new IllegalArgumentException();
            }
            try (InputStream root = Files.newInputStream(license); InputStream packaged = bundle.getInputStream(bundle.getEntry("base/assets/FirstPartyLicense.txt"))) {
                if (!digest(root).equals(digest(packaged))) throw new SecurityException();
            }
            Set<String> nativeEntries = new HashSet<>();
            for (String name : expected.keySet()) {
                if (!name.endsWith(".so")) continue;
                String[] parts = name.split("/");
                if (parts.length != 4 || !parts[0].equals("base") || !parts[1].equals("lib") || !ABIS.contains(parts[2])) throw new IllegalArgumentException();
                nativeEntries.add(parts[2] + "/" + parts[3]);
                try (InputStream input = bundle.getInputStream(bundle.getEntry(name))) { elf(input, parts[2]); }
                if (parts[3].equals("libtasknotes_core_ffi.so")) {
                    Path source = rust.resolve(parts[2]).resolve(parts[3]);
                    String sourceDigest = fileDigest(source);
                    String packagedDigest = strip == null ? sourceDigest : strippedDigest(source, strip);
                    if (!packagedDigest.equals(expected.get(name)) || !sourceDigest.equals(fileDigest(source))) throw new SecurityException();
                    System.out.println("Native provenance " + parts[2] + ": original=" + sourceDigest + " packaged=" + packagedDigest);
                }
            }
            for (String abi : ABIS) for (String library : LIBRARIES) if (!nativeEntries.contains(abi + "/" + library)) throw new IllegalArgumentException();
        }
    }

    private static String fileDigest(Path file) throws Exception {
        try (InputStream input = Files.newInputStream(file)) { return digest(input); }
    }

    /** The pinned tool transforms a private copy; a mismatch or tool failure never falls back. */
    static String strippedDigest(Path source, Path strip) throws Exception {
        if (!strip.isAbsolute() || !Files.isRegularFile(strip) || !Files.isExecutable(strip)) throw new IllegalArgumentException();
        String before = fileDigest(source);
        Path temporary = Files.createTempDirectory("facet-native-strip-");
        Path copy = temporary.resolve("source.so");
        try {
            Files.copy(source, copy);
            Process process = new ProcessBuilder(strip.toString(), "--strip-unneeded", copy.toString()).redirectErrorStream(true).start();
            try (InputStream output = process.getInputStream()) { output.transferTo(OutputStream.nullOutputStream()); }
            if (process.waitFor() != 0) throw new SecurityException("Native strip tool failed.");
            if (!before.equals(fileDigest(source))) throw new SecurityException("Native source changed during transformation.");
            return fileDigest(copy);
        } finally {
            Files.deleteIfExists(copy);
            Files.deleteIfExists(temporary);
        }
    }

    static void elf(InputStream input, String abi) throws Exception {
        byte[] bytes = input.readNBytes(64);
        if (bytes.length != 64 || bytes[0] != 0x7f || bytes[1] != 'E' || bytes[2] != 'L' || bytes[3] != 'F' || bytes[4] != 2 || bytes[5] != 1) throw new IllegalArgumentException();
        ByteBuffer header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if (Short.toUnsignedInt(header.getShort(18)) != (abi.equals("arm64-v8a") ? 183 : 62)) throw new IllegalArgumentException();
        long offset = header.getLong(32);
        int size = Short.toUnsignedInt(header.getShort(54)), count = Short.toUnsignedInt(header.getShort(56));
        if (offset < 64 || offset > 1048576 || size < 56 || size > 4096 || count < 1 || count > 512) throw new IllegalArgumentException();
        input.skipNBytes(offset - 64);
        int loads = 0;
        for (int index = 0; index < count; index++) {
            byte[] segment = input.readNBytes(size);
            if (segment.length != size) throw new IllegalArgumentException();
            ByteBuffer fields = ByteBuffer.wrap(segment).order(ByteOrder.LITTLE_ENDIAN);
            if (fields.getInt(0) != 1) continue;
            long alignment = fields.getLong(48);
            if (alignment < 16384 || (alignment & (alignment - 1)) != 0 || Math.floorMod(fields.getLong(8), 16384) != Math.floorMod(fields.getLong(16), 16384)) throw new IllegalArgumentException();
            loads++;
        }
        if (loads == 0) throw new IllegalArgumentException();
    }

    static void validateManifest(Path path) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setNamespaceAware(true);
        var document = factory.newDocumentBuilder().parse(path.toFile());
        var manifest = document.getDocumentElement();
        String android = "http://schemas.android.com/apk/res/android";
        var sdks = document.getElementsByTagName("uses-sdk");
        var apps = document.getElementsByTagName("application");
        if (!manifest.getTagName().equals("manifest") || !manifest.getAttribute("package").equals("red.sjer.facet") || sdks.getLength() != 1 || apps.getLength() != 1) throw new IllegalArgumentException();
        var sdk = (org.w3c.dom.Element) sdks.item(0);
        var app = (org.w3c.dom.Element) apps.item(0);
        if (!sdk.getAttributeNS(android, "minSdkVersion").equals("29") || !sdk.getAttributeNS(android, "targetSdkVersion").equals("36") || app.getAttributeNS(android, "debuggable").equals("true") || !app.getAttributeNS(android, "allowBackup").equals("false")) throw new IllegalArgumentException();
    }
}
