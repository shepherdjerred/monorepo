package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ResumableIteratorP5Test {

    // --- Helpers ---
    private static <T> List<T> drain(Iterator<T> it) {
        var list = new ArrayList<T>();
        while (it.hasNext()) list.add(it.next());
        return list;
    }

    private static <T> String sig(List<T> items) {
        try {
            var md = MessageDigest.getInstance("MD5");
            for (var item : items) {
                md.update(String.valueOf(item).getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0x1F);
            }
            byte[] hash = md.digest();
            var sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // --- A1-A3 (from P1) ---
    @Test
    void scenario_A1_basic_iteration() {
        var it = new ResumableIteratorP5.ResumableListIterator<>(List.of(10, 20, 30));
        var acc = drain(it);
        assertEquals(sig(List.of(10, 20, 30)), sig(acc));
    }

    @Test
    void scenario_A2_empty_list() {
        var it = new ResumableIteratorP5.ResumableListIterator<>(List.of());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A3_single_element() {
        var it = new ResumableIteratorP5.ResumableListIterator<>(List.of(99));
        assertTrue(it.hasNext());
        assertEquals(99, (int) it.next());
        assertFalse(it.hasNext());
    }

    // --- A4-A5 (from P2) ---
    @Test
    void scenario_A4_save_restore() {
        var it = new ResumableIteratorP5.ResumableListIterator<>(List.of(1, 2, 3, 4, 5));
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        assertEquals(3, (int) it.next()); // 3
        assertEquals(4, (int) it.next()); // 4
        it.setState(state);
        // Should replay from position after 2
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertEquals(5, (int) it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A5_multiple_saves() {
        var it = new ResumableIteratorP5.ResumableListIterator<>(List.of(10, 20, 30, 40));
        var s1 = it.getState();
        it.next(); // 10
        var s2 = it.getState();
        it.next(); // 20
        it.next(); // 30
        it.setState(s1);
        assertEquals(10, (int) it.next());
        it.setState(s2);
        assertEquals(20, (int) it.next());
    }

    // --- B1-B4 (from P3) ---
    @Test
    void scenario_B1_across_files() {
        var files = List.of(
                List.of(1, 2),
                List.of(3),
                List.of(4, 5, 6)
        );
        var it = new ResumableIteratorP5.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3, 4, 5, 6)), sig(acc));
    }

    @Test
    void scenario_B2_empty_files() {
        var files = List.of(
                List.<Integer>of(),
                List.of(1),
                List.<Integer>of(),
                List.<Integer>of(),
                List.of(2, 3),
                List.<Integer>of()
        );
        var it = new ResumableIteratorP5.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_B3_all_empty() {
        var files = List.of(
                List.<Integer>of(),
                List.<Integer>of()
        );
        var it = new ResumableIteratorP5.MultiFileIterator<>(files);
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_B4_save_across_boundary() {
        var files = List.of(List.of(1, 2), List.of(3, 4));
        var it = new ResumableIteratorP5.MultiFileIterator<>(files);
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        it.setState(state);
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertFalse(it.hasNext());
    }

    // --- C1-C3 (from P4) ---
    @Test
    void scenario_C1_2d_basic() {
        var data = List.of(
                List.of(1, 2, 3),
                List.of(4, 5),
                List.of(6)
        );
        var it = new ResumableIteratorP5.ResumableIterator2D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3, 4, 5, 6)), sig(acc));
    }

    @Test
    void scenario_C2_2d_with_empties() {
        var data = List.of(
                List.<Integer>of(),
                List.of(1),
                List.<Integer>of(),
                List.of(2, 3)
        );
        var it = new ResumableIteratorP5.ResumableIterator2D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_C3_2d_save_restore() {
        var data = List.of(List.of(10, 20), List.of(30, 40));
        var it = new ResumableIteratorP5.ResumableIterator2D<>(data);
        it.next(); // 10
        var state = it.getState();
        it.next(); // 20
        it.next(); // 30
        it.setState(state);
        assertEquals(20, (int) it.next());
        assertEquals(30, (int) it.next());
        assertEquals(40, (int) it.next());
    }

    // --- D1-D3 (new in P5) ---
    @Test
    void scenario_D1_3d_basic() {
        var data = List.of(
                List.of(List.of(1, 2), List.of(3)),
                List.of(List.of(4, 5, 6))
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3, 4, 5, 6)), sig(acc));
    }

    @Test
    void scenario_D2_3d_with_empties() {
        var data = List.of(
                List.of(List.<Integer>of(), List.of(1)),
                List.<List<Integer>>of(),
                List.of(List.of(2, 3), List.<Integer>of())
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_D3_3d_save_restore() {
        var data = List.of(
                List.of(List.of(1, 2), List.of(3)),
                List.of(List.of(4))
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        it.setState(state);
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_D4_all_empty_3d() {
        var data = List.of(
                List.of(List.<Integer>of(), List.<Integer>of()),
                List.of(List.<Integer>of())
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_D5_outer_list_empty() {
        var data = List.<List<List<Integer>>>of();
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_D6_single_elements_per_dimension() {
        var data = List.of(
                List.of(List.of(1)),
                List.of(List.of(2)),
                List.of(List.of(3))
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_D7_middle_dimension_empty() {
        var data = List.of(
                List.of(List.of(1, 2)),
                List.<List<Integer>>of(),
                List.of(List.of(3))
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_D8_save_across_3d_boundaries() {
        var data = List.of(
                List.of(List.of(1, 2)),
                List.of(List.of(3), List.of(4))
        );
        var it = new ResumableIteratorP5.ResumableIterator3D<>(data);
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertFalse(it.hasNext());
        it.setState(state);
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertFalse(it.hasNext());
    }
}
