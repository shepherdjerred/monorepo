// Package client provides an HTTP client for the Asuswrt-Merlin router API.
package client

// Service restart constants for rc_service parameter.
const (
	ServiceDNSMasq  = "restart_dnsmasq"
	ServiceFirewall = "restart_firewall"
	ServiceWireless = "restart_wireless"
	ServiceTime     = "restart_time"
	ServiceNet      = "restart_net"
	ServiceHTTPD    = "restart_httpd"
	ServiceUPnP     = "restart_upnp"
	ServiceCron     = "restart_cron"
)
