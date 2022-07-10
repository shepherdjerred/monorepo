import axios from "axios";
import { InstanceStatus, stringToInstanceStatus } from "./components/InstanceStatusNotification";
import { Settings } from "./settings";

const endpoint = "https://instance-api.shepherdjerred.com";

export interface ApiResponse {
  statusCode: number;
  body: string | ApiResponseBody;
}

export interface ApiResponseBody {
  message: string;
  details: string;
}

export async function getInstanceStatus(settings: Settings): Promise<InstanceStatus | undefined> {
  const response = await makeApiRequest(settings, "/status");

  let status: InstanceStatus | undefined;
  if (typeof response.body === "string") {
    const lastWord: string = response.body.split(" ").pop() || "";
    status = stringToInstanceStatus(lastWord);
  } else {
    status = undefined;
  }

  return status;
}

export async function startInstance(settings: Settings): Promise<ApiResponse> {
  return makeApiRequest(settings, "/start");
}

export async function stopInstance(settings: Settings): Promise<ApiResponse> {
  return makeApiRequest(settings, "/stop");
}

async function makeApiRequest(settings: Settings, path: string): Promise<ApiResponse> {
  console.log("Calling %s", path);

  const response = await axios.post<ApiResponse>(endpoint + path, {
    aws_secret_access_key: settings.awsSecretAccessKey,
    aws_access_key_id: settings.awsAccessKeyId,
    instance_id: settings.instance.instanceId,
    region: "us-east-1",
  });

  return {
    statusCode: response.status,
    body: response.data.body,
  };
}
