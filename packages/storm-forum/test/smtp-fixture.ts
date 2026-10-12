// This deliberately offers AUTH without STARTTLS. The client must refuse it.
Bun.listen({
  hostname: "127.0.0.1",
  port: 19_002,
  socket: {
    open(socket) {
      socket.write("220 disposable SMTP fixture\r\n");
    },
    data(socket, bytes) {
      const command = bytes.toString();
      if (command.startsWith("EHLO ")) {
        socket.write("250-fixture\r\n250 AUTH PLAIN LOGIN\r\n");
      } else if (command.startsWith("AUTH ")) {
        void Bun.write("/tmp/storm-forum/cleartext-auth-observed", "refused\n");
        socket.end("535 refused\r\n");
      } else if (command.startsWith("QUIT")) {
        socket.end("221 bye\r\n");
      } else {
        socket.write("500 unsupported fixture command\r\n");
      }
    },
  },
});
