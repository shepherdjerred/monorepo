import React from "react";

export interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function TextInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: TextInputProps): React.ReactElement {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="control">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder || ""}
          className="input"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
