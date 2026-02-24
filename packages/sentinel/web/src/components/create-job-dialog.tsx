import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Priority = "critical" | "high" | "normal" | "low";

type CreateJobDialogProps = {
  open: boolean;
  onClose: () => void;
};

const priorityOptions = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export function CreateJobDialog({ open, onClose }: CreateJobDialogProps) {
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");

  const queryClient = useQueryClient();
  const agents = trpc.agent.list.useQuery();
  const createJob = trpc.job.create.useMutation({
    onSuccess: () => {
      void queryClient.invalidateQueries();
      setAgent("");
      setPrompt("");
      setPriority("normal");
      onClose();
    },
  });

  const agentOptions =
    agents.data == null
      ? [{ value: "", label: "Loading..." }]
      : [
          { value: "", label: "Select an agent..." },
          ...agents.data.map((a) => ({ value: a.name, label: a.name })),
        ];

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (agent === "" || prompt.trim() === "") return;
    createJob.mutate({ agent, prompt, priority });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create Job">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Agent"
          options={agentOptions}
          value={agent}
          onChange={(e) => { setAgent(e.target.value); }}
        />
        <Textarea
          label="Prompt"
          placeholder="Describe what the agent should do..."
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); }}
        />
        <Select
          label="Priority"
          options={priorityOptions}
          value={priority}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "critical" || val === "high" || val === "normal" || val === "low") {
              setPriority(val);
            }
          }}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={agent === "" || prompt.trim() === "" || createJob.isPending}
          >
            {createJob.isPending ? "Creating..." : "Create Job"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
