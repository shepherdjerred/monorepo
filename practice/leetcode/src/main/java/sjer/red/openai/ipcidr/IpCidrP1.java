package sjer.red.openai.ipcidr;

import java.util.List;

/**
 * PROBLEM: IP / CIDR Iteration
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Parse and Iterate Ascending
 * - parseIp(String ip) — parse dotted-decimal IPv4 (e.g. "192.168.1.0") to long
 * - formatIp(long ip) — long back to dotted-decimal
 * - iterateAscending(String startIp, int count) — return count IPs starting from startIp, ascending
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class IpCidrP1 {

    /**
     * Parse a dotted-decimal IPv4 address to a long.
     * E.g. "192.168.1.0" → 3232235776L
     */
    public long parseIp(String ip) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Format a long back to dotted-decimal IPv4 string.
     * E.g. 3232235776L → "192.168.1.0"
     */
    public String formatIp(long ip) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return count IPs starting from startIp, ascending.
     * E.g. iterateAscending("192.168.1.0", 3) → ["192.168.1.0", "192.168.1.1", "192.168.1.2"]
     */
    public List<String> iterateAscending(String startIp, int count) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
