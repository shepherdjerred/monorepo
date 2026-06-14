package sjer.red.openai.ipcidr;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class IpCidrP3Test {
    private IpCidrP3 ipCidr;

    @BeforeEach
    void setUp() {
        ipCidr = new IpCidrP3();
    }

    @Test
    void scenario_A1_parseIp_regression() {
        assertEquals(4294967295L, ipCidr.parseIp("255.255.255.255"));
    }

    @Test
    void scenario_A2_iterateDescending_regression() {
        assertEquals(
                List.of("192.168.1.5", "192.168.1.4", "192.168.1.3"),
                ipCidr.iterateDescending("192.168.1.5", 3)
        );
    }

    @Test
    void scenario_B1_iterateCidr_slash32_single_ip() {
        assertEquals(
                List.of("192.168.1.0"),
                ipCidr.iterateCidr("192.168.1.0/32")
        );
    }

    @Test
    void scenario_B2_iterateCidr_slash30_four_ips() {
        assertEquals(
                List.of("192.168.1.0", "192.168.1.1", "192.168.1.2", "192.168.1.3"),
                ipCidr.iterateCidr("192.168.1.0/30")
        );
    }

    @Test
    void scenario_B3_iterateCidr_slash24_256_ips() {
        List<String> result = ipCidr.iterateCidr("10.0.0.0/24");
        assertEquals(256, result.size());
        assertEquals("10.0.0.0", result.get(0));
        assertEquals("10.0.0.255", result.get(255));
    }

    @Test
    void scenario_B4_iterateCidr_slash31_two_ips() {
        assertEquals(
                List.of("0.0.0.0", "0.0.0.1"),
                ipCidr.iterateCidr("0.0.0.0/31")
        );
    }

    @Test
    void scenario_B5_iterateCidr_ascending_order() {
        List<String> result = ipCidr.iterateCidr("192.168.1.0/29");
        for (int i = 1; i < result.size(); i++) {
            assertTrue(ipCidr.parseIp(result.get(i)) > ipCidr.parseIp(result.get(i - 1)));
        }
    }

    @Test
    void scenario_B6_iterateCidr_slash16_size() {
        List<String> result = ipCidr.iterateCidr("192.168.0.0/16");
        assertEquals(65536, result.size());
    }
}
