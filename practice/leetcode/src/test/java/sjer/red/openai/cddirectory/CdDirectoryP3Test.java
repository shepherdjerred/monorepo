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
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs"));
    }

    // Regression from Part 2
    @Test
    void scenario_B1() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cdWithHome("/tmp", "~", "/home/jerred"));
    }

    // New: symlink support
    @Test
    void scenario_C1() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L29wdC9iaW4="), solver.cdWithSymlinks("/home", "/usr/bin", symlinks));
    }

    @Test
    void scenario_C2() {
        var symlinks = Map.of("/usr/local/bin", "/opt/local/bin", "/usr", "/system/usr");
        assertEquals(d("L29wdC9sb2NhbC9iaW4="), solver.cdWithSymlinks("/", "/usr/local/bin", symlinks));
    }

    @Test
    void scenario_C3() {
        var symlinks = Map.of("/a", "/b", "/b", "/a");
        assertThrows(IllegalArgumentException.class, () -> solver.cdWithSymlinks("/", "/a", symlinks));
    }

    @Test
    void scenario_C4() {
        var symlinks = Map.of("/usr/bin", "/opt/bin");
        assertEquals(d("L2hvbWUvdXNlcg=="), solver.cdWithSymlinks("/home", "user", symlinks));
    }
}
