import type { Page } from "@/app";
import { JobDetail } from "@/components/job-detail";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

type JobDetailPageProps = {
  jobId: string;
  onNavigate: (page: Page) => void;
};

export function JobDetailPage({ jobId, onNavigate }: JobDetailPageProps) {
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onNavigate({ name: "jobs" });
        }}
      >
        <ArrowLeft size={16} className="mr-1" />
        Back to Jobs
      </Button>
      <JobDetail jobId={jobId} onNavigate={onNavigate} />
    </div>
  );
}
