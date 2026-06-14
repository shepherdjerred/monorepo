import React, { useCallback, useEffect, useState } from "react";
import InstanceStatusNotification, { InstanceStatus } from "./InstanceStatusNotification";
import Hero from "./Hero";
import StartButton from "./StartButton";
import StopButton from "./StopButton";
import Buttons from "./Buttons";
import Notification, { Status } from "./Notification";
import SettingsInput from "./SettingsInput";
import { ApiResponse, getInstanceStatus, startInstance, stopInstance } from "../api";
import { load, save } from "../datastore";
import { Settings } from "../settings";
import ErrorBoundary from "./ErrorBoundary";

enum Button {
  START,
  STOP,
}

export default function Home(): React.ReactElement {
  const [activeButton, setActiveButton] = useState<Button | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiResponse, setApiResponse] = useState<ApiResponse | undefined>();
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>({
    ...load(),
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const status = await getInstanceStatus(settings);
        setInstanceStatus(status);
      })();
    }, 1000);
    return () => clearTimeout(timer);
  });

  const makeApiCall = (button: Button, functionToCall: (settings: Settings) => Promise<ApiResponse>) => {
    return () => {
      setActiveButton(button);
      setIsLoading(true);
      setApiResponse(undefined);

      save(settings);

      return (async () => {
        const response = await functionToCall(settings);
        setIsLoading(false);
        setActiveButton(undefined);
        setApiResponse(response);
      })();
    };
  };

  const start = useCallback(makeApiCall(Button.START, startInstance), [settings]);
  const stop = useCallback(makeApiCall(Button.STOP, stopInstance), [settings]);

  const notification =
    apiResponse !== undefined || isLoading ? (
      <Notification
        status={apiResponse ? (apiResponse?.statusCode < 400 ? Status.SUCCESS : Status.ERROR) : Status.LOADING}
        message={(apiResponse?.body as string) || "Loading..."}
      />
    ) : undefined;

  return (
    <div>
      <Hero />
      <section className="section">
        <div className="container">
          <div className="columns">
            <div className="column is-one-third is-offset-one-third">
              <ErrorBoundary>
                <>
                  {notification}
                  <InstanceStatusNotification status={instanceStatus} />
                  <SettingsInput
                    initialSettings={settings}
                    onSettingsChange={(newSettings) => {
                      setSettings(newSettings);
                    }}
                    isLoading={isLoading}
                  />
                  <Buttons>
                    <StartButton
                      onClick={start}
                      isActive={isLoading && activeButton !== Button.START}
                      isLoading={isLoading && activeButton === Button.START}
                    />
                    <StopButton
                      onClick={stop}
                      isActive={isLoading && activeButton !== Button.STOP}
                      isLoading={isLoading && activeButton === Button.STOP}
                    />
                  </Buttons>
                </>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
