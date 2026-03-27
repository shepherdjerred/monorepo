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
 * PART 1:
 * - Implement countNodes() on the root node that returns total machine count
 * - Root sends "count" request down to children
 * - Leaves respond with 1
 * - Internal nodes wait for all children, sum up, add 1 for self, respond to parent
 * <p>
 * TIME TARGET: ~20-30 minutes
 */
public class NodeCountingP1 {

    /**
     * Count total nodes in the tree starting from the root.
     * You must implement the distributed protocol — each node only communicates
     * with its direct parent and children.
     */
    public int countNodes(Map<Integer, TreeNode> nodes, int rootId) {
        // TODO: implement distributed counting protocol
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
