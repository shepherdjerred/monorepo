const transient =
  /Request timed out|i\/o timeout|TLS handshake|remote error: tls|connection reset|connection refused|net\/http:|failed to do request|dial tcp|temporary failure in name resolution|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|blob unknown|failed to resolve source metadata|unexpected EOF|error reading from server: EOF|failed to receive status|panic: send on closed channel|context deadline exceeded|error: failed to download/i;

export function bakeFailureIsTransient(log: string): boolean {
  return transient.test(log.split("\n").slice(-120).join("\n"));
}
