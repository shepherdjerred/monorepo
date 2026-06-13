import Datastore from "./datastore";
import { Server, ServerStatus, ServerType } from "@mira-hq/model";
import DynamoDB from "aws-sdk/clients/dynamodb";

export default class DynamoDbDatastore implements Datastore {
  private readonly dynamodb: DynamoDB;

  constructor() {
    this.dynamodb = new DynamoDB({
      region: "us-east-1",
    });
  }

  async getServers(): Promise<Server[]> {
    const request: DynamoDB.Types.ScanInput = {
      TableName: "MiraHq",
    };

    let servers: Server[] = [];

    try {
      const response = await this.dynamodb.scan(request).promise();

      const items = response.Items || [];

      servers = items.map((item) => {
        console.log(item);

        return {
          uuid: item.pk1.S,
          serverName: item.serverName?.S,
          status: item.status?.S,
          address: item.address?.S,
          type: item.type?.S,
          playersOnline: item.type?.N,
          owner: {
            uuid: item.owner?.S,
          },
        } as Server;
      });

      return servers;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  putServer(server: Server) {
    const request: DynamoDB.Types.PutItemInput = {
      TableName: "MiraHq",
      Item: {
        pk1: {
          S: server.uuid,
        },
        sk1: {
          S: server.uuid,
        },
        serverName: {
          S: server.serverName,
        },
        status: {
          S: server.status,
        },
        address: {
          S: server.address?.toString() || undefined,
        },
        type: {
          S: server.type?.toString(),
        },
        playersOnline: {
          N: server.playersOnline?.toString() || "0",
        },
        owner: {
          S: server.owner?.uuid,
        },
      },
    };

    this.dynamodb.putItem(request, (error) => {
      if (error) {
        throw error;
      }
    });
  }

  getUsers(): [] {
    return [];
  }
}
