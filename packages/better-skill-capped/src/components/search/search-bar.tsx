import React from "react";
import { Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Input } from "#components/ui/input";
import { PatchIndicator } from "#src/features/layout/patch-indicator";

export type SearchBarProps = {
  value: string;
  onValueUpdate: (newValue: string) => void;
  placeholder: string;
};

export function SearchBar({
  value,
  onValueUpdate,
  placeholder,
}: SearchBarProps): React.ReactElement {
  return (
    <section className="border-b bg-primary py-8 text-primary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4">
        <div className="flex items-baseline justify-between gap-2">
          <Link to="/" className="text-xl font-bold tracking-tight">
            Better Skill Capped
          </Link>
          <PatchIndicator />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              onValueUpdate(event.target.value);
            }}
            className="h-12 bg-card pl-10 text-base text-foreground md:text-lg"
          />
        </div>
      </div>
    </section>
  );
}
