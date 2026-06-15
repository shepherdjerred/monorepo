package sjer.red.openai.ipcidr;

import java.util.List;

/**
 * PROBLEM: IP / CIDR Iteration
 * <p>
 * PART 2: Iterate Descending (cumulative ~25-30 minutes)
 * - All Part 1 functionality, plus:
 * - iterateDescending(String startIp, int count) — count IPs starting from startIp, descending
 * <p>
 * TIME TARGET: ~10 minutes (cumulative ~25-30)
 */
public class IpCidrP2 {

    /**
     * Parse a dotted-decimal IPv4 address to a long.
     */
    public long parseIp(String ip) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Format a long back to dotted-decimal IPv4 string.
     */
    public String formatIp(long ip) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return count IPs starting from startIp, ascending.
     */
    public List<String> iterateAscending(String startIp, int count) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return count IPs starting from startIp, descending.
     * E.g. iterateDescending("192.168.1.5", 3) → ["192.168.1.5", "192.168.1.4", "192.168.1.3"]
     */
    public List<String> iterateDescending(String startIp, int count) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
