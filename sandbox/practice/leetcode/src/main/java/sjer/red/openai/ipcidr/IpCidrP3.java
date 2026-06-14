package sjer.red.openai.ipcidr;

import java.util.List;

/**
 * PROBLEM: IP / CIDR Iteration
 * <p>
 * PART 3: Iterate All IPs in CIDR Block (cumulative ~35-45 minutes)
 * - All Part 1 + Part 2 functionality, plus:
 * - iterateCidr(String cidr) — return all IPs in the CIDR block (e.g. "192.168.1.0/30" returns 4 IPs)
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~35-45)
 */
public class IpCidrP3 {

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
     */
    public List<String> iterateDescending(String startIp, int count) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return all IPs in the given CIDR block, in ascending order.
     * E.g. iterateCidr("192.168.1.0/30") → ["192.168.1.0", "192.168.1.1", "192.168.1.2", "192.168.1.3"]
     */
    public List<String> iterateCidr(String cidr) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
