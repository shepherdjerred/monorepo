package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
        assertTrue(d("L2hvbWUvdXNlci9kb2Nz").equals(solver.cd("/home/user", "docs", "/home/default", Map.of())));
    }

    @Test
    void scenario_A2() {
        assertTrue(d("L2hvbWU=").equals(solver.cd("/home/user", "..", "/home/default", Map.of())));
    }

    @Test
    void scenario_A3() {
        assertTrue(d("Lw==").equals(solver.cd("/", "..", "/home/default", Map.of())));
    }

    @Test
    void scenario_A4() {
        assertTrue(d("L2V0Yw==").equals(solver.cd("/home/user", "/etc", "/home/default", Map.of())));
    }

    @Test
    void scenario_A5() {
        assertTrue(d("L2hvbWUvdXNlci9waWNz").equals(solver.cd("/home/user", "./docs/../pics", "/home/default", Map.of())));
    }

    @Test
    void scenario_A6() {
        assertTrue(d("Lw==").equals(solver.cd("/a/b/c", "../../..", "/home/default", Map.of())));
    }

    @Test
    void scenario_A7() {
        assertTrue(d("L2EvYi9j").equals(solver.cd("/a/b/c", ".", "/home/default", Map.of())));
    }

    @Test
    void scenario_A8() {
        assertTrue(d("L3gveQ==").equals(solver.cd("/a", "/x/y/z/..", "/home/default", Map.of())));
    }

    @Test
    void scenario_A9() {
        assertTrue(d("L2E=").equals(solver.cd("/a/b/c/d/e", "../../../..", "/home/default", Map.of())));
    }

    @Test
    void scenario_A10() {
        assertTrue(d("L2EvYg==").equals(solver.cd("/a", "b", "/home/default", Map.of())));
    }

    // Regression from Part 2
    @Test
    void scenario_B1() {
        assertTrue(d("L2hvbWUvamVycmVk").equals(solver.cd("/tmp", "~", "/home/jerred", Map.of())));
    }

    @Test
    void scenario_B2() {
        assertTrue(d("L2hvbWUvamVycmVkL2RvY3M=").equals(solver.cd("/tmp", "~/docs", "/home/jerred", Map.of())));
    }

    @Test
    void scenario_B3() {
        assertTrue(d("L2hvbWUvamVycmVk").equals(solver.cd("/anywhere", "~/docs/..", "/home/jerred", Map.of())));
    }

    @Test
    void scenario_B4() {
        assertTrue(d("L3RtcC9hL34=").equals(solver.cd("/tmp", "a/~", "/home/jerred", Map.of())));
    }

    // New: symlink support
    @Test
    void scenario_C1() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertTrue(d("L29wdC9iaW4=").equals(solver.cd("/home", "/usr/bin", "/home/default", symlinks)));
    }

    @Test
    void scenario_C2() {
        var symlinks = Map.of("/usr/local/bin", "/opt/local/bin", "/usr", "/system/usr");
        assertTrue(d("L29wdC9sb2NhbC9iaW4=").equals(solver.cd("/", "/usr/local/bin", "/home/default", symlinks)));
    }

    @Test
    void scenario_C3() {
        var symlinks = Map.of("/a", "/b", "/b", "/a");
        assertThrows(IllegalArgumentException.class, () -> solver.cd("/", "/a", "/home/default", symlinks));
    }

    @Test
    void scenario_C4() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertTrue(d("L2hvbWUvdXNlcg==").equals(solver.cd("/home", "user", "/home/default", symlinks)));
    }

    @Test
    void scenario_C5() {
        var symlinks = Map.of("/a", "/b", "/b", "/c");
        assertTrue(d("L2M=").equals(solver.cd("/", "/a", "/home/default", symlinks)));
    }

    @Test
    void scenario_C6() {
        var symlinks = Map.of("/a", "/a");
        assertThrows(IllegalArgumentException.class, () -> solver.cd("/", "/a", "/home/default", symlinks));
    }

    @Test
    void scenario_C7() {
        var symlinks = Map.of("/x", "/y");
        assertTrue(d("L3ovdw==").equals(solver.cd("/", "/z/w", "/home/default", symlinks)));
    }

    @Test
    void scenario_C8() {
        var symlinks = Map.of("/home/user/bin", "/opt/bin");
        assertTrue(d("L29wdC9iaW4=").equals(solver.cd("/tmp", "~/bin", "/home/user", symlinks)));
    }

    @Test
    void scenario_C9() {
        var symlinks = Map.of("/link", "/target");
        assertTrue(d("L3RhcmdldA==").equals(solver.cd("/", "link", "/home/default", symlinks)));
    }

    @Test
    void scenario_C10() {
        var symlinks = Map.of("/usr", "/opt", "/opt/bin", "/tools");
        assertTrue(d("L29wdA==").equals(solver.cd("/", "/usr/bin", "/home/default", symlinks)));
    }

    @Test
    void scenario_C11() {
        assertTrue(d("L2EvYy9k").equals(solver.cd("/a/b", "../c/./d", "/home", Map.of())));
    }
}
