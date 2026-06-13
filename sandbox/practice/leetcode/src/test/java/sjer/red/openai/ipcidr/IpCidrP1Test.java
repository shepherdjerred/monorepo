package sjer.red.openai.ipcidr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class IpCidrP1Test {
    private IpCidrP1 ipCidr;

    @BeforeEach
    void setUp() {
        ipCidr = new IpCidrP1();
    }

    @Test
    void scenario_A1_parseIp_all_zeros() {
        assertEquals(0L, ipCidr.parseIp("0.0.0.0"));
    }

    @Test
    void scenario_A2_parseIp_max_value() {
        assertEquals(4294967295L, ipCidr.parseIp("255.255.255.255"));
    }

    @Test
    void scenario_A3_formatIp_zero() {
        assertEquals("0.0.0.0", ipCidr.formatIp(0));
    }

    @Test
    void scenario_A4_formatIp_round_trip() {
        String original = "192.168.1.100";
        assertEquals(original, ipCidr.formatIp(ipCidr.parseIp(original)));
    }

    @Test
    void scenario_A5_iterateAscending_basic() {
        assertEquals(
                List.of("192.168.1.0", "192.168.1.1", "192.168.1.2"),
                ipCidr.iterateAscending("192.168.1.0", 3)
        );
    }

    @Test
    void scenario_A6_iterateAscending_crosses_octet_boundary() {
        assertEquals(
                List.of("192.168.1.254", "192.168.1.255", "192.168.2.0", "192.168.2.1"),
                ipCidr.iterateAscending("192.168.1.254", 4)
        );
    }

    @Test
    void scenario_A7_parseIp_ten_dot_zero_dot_zero_dot_one() {
        assertEquals(167772161L, ipCidr.parseIp("10.0.0.1"));
    }

    @Test
    void scenario_A8_iterateAscending_count_one() {
        assertEquals(
                List.of("10.0.0.1"),
                ipCidr.iterateAscending("10.0.0.1", 1)
        );
    }
}
