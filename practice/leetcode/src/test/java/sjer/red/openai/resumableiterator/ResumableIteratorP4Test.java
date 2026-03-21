package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ResumableIteratorP4Test {

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

    // Regression
    @Test
    void scenario_B1_across_files() {
        var files = List.of(
                List.of(1, 2),
                List.of(3),
                List.of(4, 5, 6)
        );
        var it = new ResumableIteratorP4.MultiFileIterator<>(files);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3, 4, 5, 6)), sig(acc));
    }

    // New
    @Test
    void scenario_C1_2d_basic() {
        var data = List.of(
                List.of(1, 2, 3),
                List.of(4, 5),
                List.of(6)
        );
        var it = new ResumableIteratorP4.ResumableIterator2D<>(data);
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
        var it = new ResumableIteratorP4.ResumableIterator2D<>(data);
        var acc = drain(it);
        assertEquals(sig(List.of(1, 2, 3)), sig(acc));
    }

    @Test
    void scenario_C3_2d_save_restore() {
        var data = List.of(List.of(10, 20), List.of(30, 40));
        var it = new ResumableIteratorP4.ResumableIterator2D<>(data);
        it.next(); // 10
        var state = it.getState();
        it.next(); // 20
        it.next(); // 30
        it.setState(state);
        assertEquals(20, it.next());
        assertEquals(30, it.next());
        assertEquals(40, it.next());
    }
}
