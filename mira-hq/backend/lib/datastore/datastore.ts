import { Server, User } from "@mira-hq/model";

export default interface Datastore {
  getServers(): Promise<Server[]>;
  putServer(server: Server): void;
  getUsers(): User[];
}
