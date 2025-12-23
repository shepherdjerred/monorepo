import TextInput from "./TextInput";
import React, { useState } from "react";
import { Settings } from "../settings";
import InstanceSelector from "./InstanceSelector";
import instances, { Instance } from "../instances";

export interface SettingsInputProps {
  initialSettings: Settings;
  onSettingsChange: (credentials: Settings) => void;
  isLoading: boolean;
}

export default function SettingsInput({
  initialSettings,
  onSettingsChange,
  isLoading,
}: SettingsInputProps): React.ReactElement {
  const [settings, setSettings] = useState(initialSettings);

  const handleSettingsUpdate = (newSettings: Settings): void => {
    setSettings(newSettings);
    onSettingsChange(newSettings);
  };

  const handleInstanceIdChange = (newValue: Instance): void => {
    const newSettings = {
      ...settings,
      instance: newValue,
    };
    handleSettingsUpdate(newSettings);
  };

  const handleAwsAccessKeyIdChange = (newValue: string): void => {
    const newSettings = {
      ...settings,
      awsAccessKeyId: newValue,
    };
    handleSettingsUpdate(newSettings);
  };

  const handleAwsSecretAccessKeyChange = (newValue: string): void => {
    const newSettings = {
      ...settings,
      awsSecretAccessKey: newValue,
    };
    handleSettingsUpdate(newSettings);
  };

  return (
    <>
      <InstanceSelector
        instances={instances}
        isDisabled={isLoading}
        onSelectedInstanceUpdate={handleInstanceIdChange}
      />
      <TextInput
        label="AWS Access Key ID"
        value={settings.awsAccessKeyId}
        onChange={handleAwsAccessKeyIdChange}
        disabled={isLoading}
      />
      <TextInput
        label="AWS Secret Access Key"
        value={settings.awsSecretAccessKey}
        onChange={handleAwsSecretAccessKeyChange}
        disabled={isLoading}
      />
    </>
  );
}
