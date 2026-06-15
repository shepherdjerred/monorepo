package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;

import static org.junit.jupiter.api.Assertions.*;

class ResumableIteratorP3Test {

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
        var it = new ResumableIteratorP3.ResumableListIterator<>(List.of(10, 20, 30));
        var acc = drain(it);
        assertEquals(sig(List.of(10, 20, 30)), sig(acc));
    }

    @Test
    void scenario_A2_empty_list() {
        var it = new ResumableIteratorP3.ResumableListIterator<>(List.of());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A3_single_element() {
        var it = new ResumableIteratorP3.ResumableListIterator<>(List.of(99));
        assertTrue(it.hasNext());
        assertEquals(99, (int) it.next());
        assertFalse(it.hasNext());
    }

    // --- A4-A5 (from P2) ---
    @Test
    void scenario_A4_save_restore() {
        var it = new ResumableIteratorP3.ResumableListIterator<>(List.of(1, 2, 3, 4, 5));
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
        var it = new ResumableIteratorP3.ResumableListIterator<>(List.of(10, 20, 30, 40));
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

    // --- B1-B4 (new in P3) ---
    @Test
    void scenario_B1_across_files() {
        var files = List.of(
                List.of(1, 2),
                List.of(3),
                List.of(4, 5, 6)
        );
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
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
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_B3_all_empty() {
        var files = List.of(
                List.<Integer>of(),
                List.<Integer>of()
        );
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_B4_save_across_boundary() {
        var files = List.of(List.of(1, 2), List.of(3, 4));
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
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
    void scenario_B5_single_file() {
        var files = List.of(List.of(1, 2, 3));
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_B6_first_file_empty() {
        var files = List.of(List.<Integer>of(), List.of(1, 2));
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2)), sig(acc));
    }

    @Test
    void scenario_B7_last_file_empty() {
        var files = List.of(List.of(1, 2), List.<Integer>of());
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2)), sig(acc));
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_B8_save_at_file_boundary() {
        var files = List.of(List.of(1), List.of(2));
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        assertEquals(1, (int) it.next());
        var state = it.getState();
        assertEquals(2, (int) it.next());
        it.setState(state);
        assertEquals(2, (int) it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_B9_next_after_exhaustion() {
        var files = List.of(List.of(1), List.of(2));
        var it = new ResumableIteratorP3.MultiFileIterator<>(files);
        it.next(); // 1
        it.next(); // 2
        assertFalse(it.hasNext());
        assertThrows(NoSuchElementException.class, it::next);
    }
}
