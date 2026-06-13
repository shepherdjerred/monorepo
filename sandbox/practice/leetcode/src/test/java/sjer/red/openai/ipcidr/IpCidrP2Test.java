package sjer.red.openai.ipcidr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class IpCidrP2Test {
    private IpCidrP2 ipCidr;

    @BeforeEach
    void setUp() {
        ipCidr = new IpCidrP2();
    }

    @Test
    void scenario_A1_parseIp_regression() {
        assertEquals(0L, ipCidr.parseIp("0.0.0.0"));
    }

    @Test
    void scenario_A2_formatIp_regression() {
        assertEquals("0.0.0.0", ipCidr.formatIp(0));
    }

    @Test
    void scenario_A3_iterateAscending_regression() {
        assertEquals(
                List.of("192.168.1.0", "192.168.1.1", "192.168.1.2"),
                ipCidr.iterateAscending("192.168.1.0", 3)
        );
    }

    @Test
    void scenario_B1_iterateDescending_basic() {
        assertEquals(
                List.of("192.168.1.5", "192.168.1.4", "192.168.1.3"),
                ipCidr.iterateDescending("192.168.1.5", 3)
        );
    }

    @Test
    void scenario_B2_iterateDescending_crosses_octet_boundary() {
        assertEquals(
                List.of("192.168.2.1", "192.168.2.0", "192.168.1.255", "192.168.1.254"),
                ipCidr.iterateDescending("192.168.2.1", 4)
        );
    }

    @Test
    void scenario_B3_iterateDescending_to_zero() {
        assertEquals(
                List.of("0.0.0.1", "0.0.0.0"),
                ipCidr.iterateDescending("0.0.0.1", 2)
        );
    }

    @Test
    void scenario_B4_iterateDescending_count_one() {
        assertEquals(
                List.of("10.0.0.5"),
                ipCidr.iterateDescending("10.0.0.5", 1)
        );
    }

    @Test
    void scenario_B5_iterateDescending_from_ten_dot_zero_dot_one_dot_zero() {
        assertEquals(
                List.of("10.0.1.0", "10.0.0.255", "10.0.0.254"),
                ipCidr.iterateDescending("10.0.1.0", 3)
        );
    }
}
