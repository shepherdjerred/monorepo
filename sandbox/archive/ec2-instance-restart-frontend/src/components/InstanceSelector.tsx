import React, { useState } from "react";
import { Instance } from "../instances";

export interface InstanceSelectorProps {
  instances: Instance[];
  isDisabled: boolean;
  onSelectedInstanceUpdate(newInstance: Instance): void;
}

export default function InstanceSelector({
  instances,
  onSelectedInstanceUpdate,
  isDisabled,
}: InstanceSelectorProps): React.ReactElement {
  const [selectedInstance, setSelectedInstance] = useState<Instance | undefined>(undefined);

  // TODO this is hacky
  if (!selectedInstance) {
    const defaultInstance = instances[0];
    setSelectedInstance(defaultInstance);
    onSelectedInstanceUpdate(defaultInstance);
  }

  const options = instances.map((instance) => {
    return (
      <option key={instance.instanceId} value={instance.instanceId}>
        {instance.name}
      </option>
    );
  });

  if (!selectedInstance) {
    return <></>;
  }

  return (
    <div className="field">
      <label className="label">Instance</label>
      <div className="control">
        <div className="select">
          <select
            value={selectedInstance.instanceId}
            disabled={isDisabled}
            onChange={(event) => {
              const newInstance = instances.find((instance) => {
                return instance.instanceId === event.target.value;
              });

              if (newInstance) {
                setSelectedInstance(newInstance);
                onSelectedInstanceUpdate(newInstance);
              }
            }}
          >
            {options}
          </select>
        </div>
      </div>
    </div>
  );
}
