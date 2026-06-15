import React from "react";
import Card from "./Card";
import { ButtonGroup } from "../ButtonGroup";
import Spinner from "../Spinner";
import { Type } from "../Type";
import Button from "../Button";
import { Server, ServerStatus } from "@mira-hq/model/dist/index";

export interface ServerCardProps {
  server: Server;
}

export default function ServerCard({
  server,
}: ServerCardProps): React.ReactElement {
  const { serverName, status, uptime, maxUptime, address, playersOnline } =
    server;
  const actions: React.ReactNode[] = [];

  const isTransientStatus =
    status == ServerStatus.Stopping || status === ServerStatus.Starting;

  if (status === ServerStatus.Running || status === ServerStatus.Starting) {
    actions.push(
      ...[
        <Button
          text={"Stop"}
          type={Type.DANGER}
          disabled={isTransientStatus}
          key={status}
          onClick={() => console.log("Stopping...")}
        />,
      ],
    );
  } else if (
    status === ServerStatus.Stopped ||
    status === ServerStatus.Stopping
  ) {
    actions.push(
      <Button
        text={"Start"}
        type={Type.SUCCESS}
        disabled={isTransientStatus}
        key={status}
        onClick={() => console.log("Starting...")}
      />,
    );
  }

  if (status !== ServerStatus.Terminated) {
    actions.push(
      ...[
        <Button
          text={"Terminate"}
          type={Type.DANGER}
          disabled={isTransientStatus}
          key={status}
          onClick={() => console.log("Terminating...")}
        />,
      ],
    );
  }

  const actionsWrapper = <ButtonGroup>{actions}</ButtonGroup>;

  const timeRemainingText = ` (${maxUptime - uptime}  minutes remaining )`;

  const canConnect =
    status !== ServerStatus.Terminated &&
    status !== ServerStatus.Stopping &&
    status !== ServerStatus.Stopped;
  const isRunning = status == ServerStatus.Running;

  return (
    <Card
      content={
        <>
          <h2 className={"text-2xl"}>{serverName}</h2>
          <p>
            <span className={"uppercase text-sm tracking-wide font-bold"}>
              {status} {isTransientStatus && <Spinner />}
            </span>
            {isRunning && timeRemainingText}
          </p>
          {canConnect && (
            <p>
              Connect with{" "}
              <span className={"font-bold"}>{address}.mira-hq.com</span>
            </p>
          )}
          {isRunning && <p>{playersOnline} players online</p>}
        </>
      }
      footer={actionsWrapper}
    />
  );
}
