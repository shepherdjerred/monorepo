import { useState, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Dashboard } from "@/pages/dashboard";
import { Jobs } from "@/pages/jobs";
import { JobDetailPage } from "@/pages/job-detail-page";
import { Approvals } from "@/pages/approvals";
import { Sessions } from "@/pages/sessions";
import { Conversation } from "@/pages/conversation";

export type Page =
  | { name: "dashboard" }
  | { name: "jobs" }
  | { name: "job-detail"; jobId: string }
  | { name: "approvals" }
  | { name: "sessions" }
  | { name: "conversation" }
  | { name: "conversation"; sessionId: string };

export function App() {
  const [page, setPage] = useState<Page>({ name: "dashboard" });

  const navigate = useCallback((p: Page) => {
    setPage(p);
  }, []);

  function renderPage() {
    switch (page.name) {
      case "dashboard":
        return <Dashboard onNavigate={navigate} />;
      case "jobs":
        return <Jobs onNavigate={navigate} />;
      case "job-detail":
        return <JobDetailPage jobId={page.jobId} onNavigate={navigate} />;
      case "approvals":
        return <Approvals onNavigate={navigate} />;
      case "sessions":
        return <Sessions onNavigate={navigate} />;
      case "conversation":
        return (
          <Conversation
            initialSessionId={"sessionId" in page ? page.sessionId : undefined}
          />
        );
    }
  }

  return (
    <Layout currentPage={page.name} onNavigate={navigate}>
      {renderPage()}
    </Layout>
  );
}
