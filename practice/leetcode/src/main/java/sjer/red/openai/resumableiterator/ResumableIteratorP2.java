package sjer.red.openai.resumableiterator;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * PROBLEM: Resumable Iterator
 * <p>
 * PART 1:
 * - ResumableListIterator<T> over a List<T>
 * - hasNext(), next() -- standard iterator behavior
 * <p>
 * PART 2: Add pause/resume
 * - getState() -- returns an opaque state object capturing current position
 * - setState(state) -- restores the iterator to a previously captured position
 * - State should be serializable as a simple value
 * <p>
 * TIME TARGET: ~10 minutes (cumulative ~20 minutes)
 */
public class ResumableIteratorP2 {

    /**
     * Part 1-2: Resumable iterator over a single list.
     */
    public static class ResumableListIterator<T> implements Iterator<T> {
        public ResumableListIterator(List<T> data) {
            // TODO: implement
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public boolean hasNext() {
            // TODO: implement
            throw new UnsupportedOperationException("Not yet implemented");
        }

        @Override
        public T next() {
            // TODO: implement
            throw new UnsupportedOperationException("Not yet implemented");
        }

        /**
         * Capture current iterator state.
         */
        public Map<String, Object> getState() {
            // TODO: implement
            throw new UnsupportedOperationException("Not yet implemented");
        }

        /**
         * Restore iterator to a previously captured state.
         */
        public void setState(Map<String, Object> state) {
            // TODO: implement
            throw new UnsupportedOperationException("Not yet implemented");
        }
    }
}
