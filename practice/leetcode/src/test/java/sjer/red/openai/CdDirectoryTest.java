package sjer.red.openai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CdDirectoryTest {
    private CdDirectory solver;
    private static final byte[] K = {0x4f, 0x41, 0x49};

    @BeforeEach
    void setUp() {
        solver = new CdDirectory();
    }

    // --- Part 1: Basic path resolution ---

    @Test
    void scenario_A1() {
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs"));
    }

    @Test
    void scenario_A2() {
        assertEquals(d("L2hvbWU="), solver.cd("/home/user", ".."));
    }

    @Test
    void scenario_A3() {
        assertEquals(d("Lw=="), solver.cd("/", ".."));
    }

    @Test
    void scenario_A4() {
        assertEquals(d("L2V0Yw=="), solver.cd("/home/user", "/etc"));
    }

    @Test
    void scenario_A5() {
        assertEquals(d("L2hvbWUvdXNlci9waWNz"), solver.cd("/home/user", "./docs/../pics"));
    }

    @Test
    void scenario_A6() {
        assertEquals(d("Lw=="), solver.cd("/a/b/c", "../../.."));
    }

    @Test
    void scenario_A7() {
        assertEquals(d("L2EvYi9j"), solver.cd("/a/b/c", "."));
    }

    @Test
    void scenario_A8() {
        assertEquals(d("L3gveQ=="), solver.cd("/a", "/x/y/z/.."));
    }

    @Test
    void scenario_A9() {
        // deeply nested relative traversal
        assertEquals(d("L2E="), solver.cd("/a/b/c/d/e", "../../../.."));
    }

    @Test
    void scenario_A10() {
        // multiple slashes should be handled
        assertEquals(d("L2EvYg=="), solver.cd("/a", "b"));
    }

    // --- Part 2: Home directory ---

    @Test
    void scenario_B1() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cdWithHome("/tmp", "~", "/home/jerred"));
    }

    @Test
    void scenario_B2() {
        assertEquals(d("L2hvbWUvamVycmVkL2RvY3M="),
                solver.cdWithHome("/tmp", "~/docs", "/home/jerred"));
    }

    @Test
    void scenario_B3() {
        assertEquals(d("L2hvbWUvamVycmVk"),
                solver.cdWithHome("/anywhere", "~/docs/..", "/home/jerred"));
    }

    @Test
    void scenario_B4() {
        // ~ only special at start
        assertEquals(d("L3RtcC9hL34="),
                solver.cdWithHome("/tmp", "a/~", "/home/jerred"));
    }

    // --- Part 3: Symlinks ---

    @Test
    void scenario_C1() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L29wdC9iaW4="),
                solver.cdWithSymlinks("/home", "/usr/bin", symlinks));
    }

    @Test
    void scenario_C2() {
        var symlinks = Map.of("/usr/local/bin", "/opt/local/bin", "/usr", "/system/usr");
        // longest match: /usr/local/bin → /opt/local/bin
        assertEquals(d("L29wdC9sb2NhbC9iaW4="),
                solver.cdWithSymlinks("/", "/usr/local/bin", symlinks));
    }

    @Test
    void scenario_C3() {
        // cycle detection
        var symlinks = Map.of("/a", "/b", "/b", "/a");
        assertThrows(IllegalArgumentException.class, () ->
                solver.cdWithSymlinks("/", "/a", symlinks));
    }

    @Test
    void scenario_C4() {
        // no symlink match — resolve normally
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L2hvbWUvdXNlcg=="),
                solver.cdWithSymlinks("/home", "user", symlinks));
    }

    // --- Helpers ---
    private static String d(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }
}
