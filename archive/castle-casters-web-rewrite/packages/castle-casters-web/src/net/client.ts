import { clientMessageSchema, serverMessageSchema, type ClientMessage, type ServerMessage } from "@castle-casters/core/schemas";

export type NetClient = {
  connect: (roomId: string, name: string) => void;
  send: (message: ClientMessage) => void;
  close: () => void;
};

export function createNetClient(baseUrl: string, onMessage: (message: ServerMessage) => void): NetClient {
  let socket: WebSocket | undefined;
  let clientSeq = 0;
  const clientId = localStorage.getItem("castle-casters-web:client-id") ?? crypto.randomUUID();
  localStorage.setItem("castle-casters-web:client-id", clientId);

  return {
    connect(roomId, name) {
      socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/rooms/${roomId}/ws`);
      socket.addEventListener("open", () => {
        const resumeToken = localStorage.getItem("castle-casters-web:resume-token") ?? undefined;
        this.send({ type: "hello", v: 1, clientId, name, resumeToken });
      });
      socket.addEventListener("message", (event) => {
        const parsed = serverMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) {
          return;
        }
        if (parsed.data.type === "helloAccepted") {
          localStorage.setItem("castle-casters-web:resume-token", parsed.data.resumeToken);
        }
        onMessage(parsed.data);
      });
    },
    send(message) {
      const outgoing = message.type === "hello" ? message : { ...message, clientSeq: "clientSeq" in message ? message.clientSeq : clientSeq };
      clientSeq += 1;
      clientMessageSchema.parse(outgoing);
      socket?.send(JSON.stringify(outgoing));
    },
    close() {
      socket?.close();
    },
  };
}
