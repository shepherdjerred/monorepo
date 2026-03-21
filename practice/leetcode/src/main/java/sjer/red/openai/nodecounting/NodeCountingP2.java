package sjer.red.openai.nodecounting;

import java.util.List;
import java.util.Map;

/**
 * PROBLEM: Node Counting (Distributed Tree)
 * <p>
 * You have a tree of machines. Each machine can only communicate with its
 * parent and children via message passing. Count the total number of machines.
 * <p>
 * SETUP:
 * - Each node knows its own ID, its parent ID (null for root), and its children IDs
 * - Communication is via sendAsyncMessage(targetId, message) and receiveMessage()
 * - Messages are strings; you define the protocol
 * <p>
 * PART 2:
 * - Handle timeout: if a node doesn't respond within timeoutMs, exclude it
 * - Still return the count of reachable/responsive machines
 * <p>
 * KEY INSIGHT:
 * - This is NOT a normal tree traversal — you simulate distributed message passing
 * - Think about what messages each node sends/receives and in what order
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~30-45 minutes)
 */
public class NodeCountingP2 {

    /**
     * Count total reachable nodes in the tree starting from the root.
     * Handle timeout: if a node doesn't respond within timeoutMs, exclude
     * unresponsive nodes from the count.
     */
    public int countNodes(Map<Integer, TreeNode> nodes, int rootId, long timeoutMs) {
        // TODO: implement distributed counting protocol with timeout handling
        throw new UnsupportedOperationException("Not yet implemented");
    }

    public interface MessageBus {
        void send(int fromId, int toId, String message);

        Message receive(int nodeId);
    }

    public static class TreeNode {
        public final int id;
        public final Integer parentId;
        public final List<Integer> childrenIds;
        private final MessageBus bus;

        public TreeNode(int id, Integer parentId, List<Integer> childrenIds, MessageBus bus) {
            this.id = id;
            this.parentId = parentId;
            this.childrenIds = childrenIds;
            this.bus = bus;
        }

        public void sendAsyncMessage(int targetId, String message) {
            bus.send(this.id, targetId, message);
        }

        public Message receiveMessage() {
            return bus.receive(this.id);
        }
    }

    public record Message(int fromId, String content) {
    }
}
