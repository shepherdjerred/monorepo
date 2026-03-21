package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CdDirectoryP3Test {
    private CdDirectoryP3 solver;

    private static String d(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new CdDirectoryP3();
    }

    // Regression from Part 1
    @Test
    void scenario_A1() {
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs", "/home/default", Map.of()));
    }

    @Test
    void scenario_A2() {
        assertEquals(d("L2hvbWU="), solver.cd("/home/user", "..", "/home/default", Map.of()));
    }

    @Test
    void scenario_A3() {
        assertEquals(d("Lw=="), solver.cd("/", "..", "/home/default", Map.of()));
    }

    @Test
    void scenario_A4() {
        assertEquals(d("L2V0Yw=="), solver.cd("/home/user", "/etc", "/home/default", Map.of()));
    }

    @Test
    void scenario_A5() {
        assertEquals(d("L2hvbWUvdXNlci9waWNz"), solver.cd("/home/user", "./docs/../pics", "/home/default", Map.of()));
    }

    @Test
    void scenario_A6() {
        assertEquals(d("Lw=="), solver.cd("/a/b/c", "../../..", "/home/default", Map.of()));
    }

    @Test
    void scenario_A7() {
        assertEquals(d("L2EvYi9j"), solver.cd("/a/b/c", ".", "/home/default", Map.of()));
    }

    @Test
    void scenario_A8() {
        assertEquals(d("L3gveQ=="), solver.cd("/a", "/x/y/z/..", "/home/default", Map.of()));
    }

    @Test
    void scenario_A9() {
        assertEquals(d("L2E="), solver.cd("/a/b/c/d/e", "../../../..", "/home/default", Map.of()));
    }

    @Test
    void scenario_A10() {
        assertEquals(d("L2EvYg=="), solver.cd("/a", "b", "/home/default", Map.of()));
    }

    // Regression from Part 2
    @Test
    void scenario_B1() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cd("/tmp", "~", "/home/jerred", Map.of()));
    }

    @Test
    void scenario_B2() {
        assertEquals(d("L2hvbWUvamVycmVkL2RvY3M="), solver.cd("/tmp", "~/docs", "/home/jerred", Map.of()));
    }

    @Test
    void scenario_B3() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cd("/anywhere", "~/docs/..", "/home/jerred", Map.of()));
    }

    @Test
    void scenario_B4() {
        assertEquals(d("L3RtcC9hL34="), solver.cd("/tmp", "a/~", "/home/jerred", Map.of()));
    }

    // New: symlink support
    @Test
    void scenario_C1() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L29wdC9iaW4="), solver.cd("/home", "/usr/bin", "/home/default", symlinks));
    }

    @Test
    void scenario_C2() {
        var symlinks = Map.of("/usr/local/bin", "/opt/local/bin", "/usr", "/system/usr");
        assertEquals(d("L29wdC9sb2NhbC9iaW4="), solver.cd("/", "/usr/local/bin", "/home/default", symlinks));
    }

    @Test
    void scenario_C3() {
        var symlinks = Map.of("/a", "/b", "/b", "/a");
        assertThrows(IllegalArgumentException.class, () -> solver.cd("/", "/a", "/home/default", symlinks));
    }

    @Test
    void scenario_C4() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L2hvbWUvdXNlcg=="), solver.cd("/home", "user", "/home/default", symlinks));
    }
}
