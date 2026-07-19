import { skipToken, useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDotDashedIcon,
  FileTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, useParams, useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";

import { DocumentSidebar } from "./document-sidebar.tsx";
import { useTRPC } from "./trpc.ts";
import { COLUMN_LABELS } from "./workflow.ts";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import { Skeleton } from "#components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#components/ui/tabs";
import { DocumentIdSchema, type DocumentDetail } from "#shared/schema";

function MarkdownContent({
  markdown,
  emptyMessage,
}: {
  markdown: string | null;
  emptyMessage: string;
}): React.JSX.Element {
  if (markdown === null || markdown.trim() === "") {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="typeset">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function FocusCard({
  document,
}: {
  document: DocumentDetail;
}): React.JSX.Element {
  if (document.status === "awaiting-human") {
    return (
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </div>
          <CardTitle className="text-xl">Ready for your verification</CardTitle>
          <CardDescription>
            These are the checks the agent needs you to perform before signing
            off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarkdownContent
            emptyMessage="No verification instructions were recorded. Request changes so the agent can add concrete checks."
            markdown={document.workflow.humanVerificationMarkdown}
          />
        </CardContent>
      </Card>
    );
  }

  if (document.status === "planned" || document.status === "in-progress") {
    return (
      <Card>
        <CardHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-secondary">
            <CircleDotDashedIcon className="size-4" />
          </div>
          <CardTitle className="text-xl">
            {document.status === "planned"
              ? "Planned work"
              : "Work in progress"}
          </CardTitle>
          <CardDescription>
            Review what remains and leave a steering comment if priorities or
            constraints have changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarkdownContent
            emptyMessage="No structured Remaining section is present. Use the Full Document tab for context or leave a steering comment."
            markdown={document.workflow.remainingMarkdown}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckCircle2Icon className="size-4" />
        </div>
        <CardTitle className="text-xl">Complete</CardTitle>
        <CardDescription>
          No human action is currently required. The verification record and
          discussion remain below.
        </CardDescription>
      </CardHeader>
      {document.workflow.humanVerificationMarkdown === null ? null : (
        <CardContent>
          <MarkdownContent
            emptyMessage="Verification completed without additional instructions."
            markdown={document.workflow.humanVerificationMarkdown}
          />
        </CardContent>
      )}
    </Card>
  );
}

function DocumentNotFound({
  boardHref,
}: {
  boardHref: string;
}): React.JSX.Element {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Document not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been renamed, archived, or removed from this checkout.
        </p>
        <Button
          className="mt-5"
          nativeButton={false}
          render={<Link to={boardHref} />}
        >
          <ArrowLeftIcon /> Return to the board
        </Button>
      </div>
    </main>
  );
}

export function DocumentPage(): React.JSX.Element {
  const trpc = useTRPC();
  const parameters = useParams();
  const [searchParameters] = useSearchParams();
  const idResult = DocumentIdSchema.safeParse(parameters["id"]);
  const boardHref = `/${searchParameters.size === 0 ? "" : `?${searchParameters.toString()}`}`;
  const documentQuery = useQuery(
    trpc.documents.byId.queryOptions(
      idResult.success ? { id: idResult.data } : skipToken,
    ),
  );
  const repositoryQuery = useQuery(trpc.documents.list.queryOptions());
  const document = documentQuery.data;
  const actor = repositoryQuery.data?.repository.actor;

  if (!idResult.success || documentQuery.error?.data?.code === "NOT_FOUND") {
    return <DocumentNotFound boardHref={boardHref} />;
  }

  if (document === undefined) {
    return (
      <main className="mx-auto min-h-svh max-w-6xl space-y-5 p-5 md:p-8">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="h-[55vh] w-full rounded-2xl" />
      </main>
    );
  }

  return (
    <main className="min-h-svh bg-muted/20 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
          <Button
            className="mb-6 -ml-2"
            nativeButton={false}
            render={<Link to={boardHref} />}
            variant="ghost"
          >
            <ArrowLeftIcon /> Back to board
          </Button>
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{document.type}</Badge>
                <Badge variant="secondary">
                  {COLUMN_LABELS[document.status]}
                </Badge>
                {document.verification === "human" ? (
                  <Badge>
                    <ShieldCheckIcon /> Human verification
                  </Badge>
                ) : null}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-4xl">
                {document.title}
              </h1>
              <p className="mt-3 truncate font-mono text-xs text-muted-foreground">
                packages/docs/{document.path}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 text-xs text-muted-foreground">
              {repositoryQuery.data === undefined ? null : (
                <>
                  <Badge variant="outline">
                    {repositoryQuery.data.repository.branch}
                  </Badge>
                  <Badge variant="secondary">
                    {repositoryQuery.data.repository.actor}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
        <Tabs defaultValue="task">
          <TabsList>
            <TabsTrigger value="task">
              <ShieldCheckIcon /> Human task
            </TabsTrigger>
            <TabsTrigger value="document">
              <FileTextIcon /> Full document
            </TabsTrigger>
          </TabsList>
          <TabsContent className="pt-5" value="task">
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-5">
                <FocusCard document={document} />
                <Card>
                  <CardHeader>
                    <CardTitle>Comment log</CardTitle>
                    <CardDescription>
                      Steering notes, status changes, and verification evidence
                      stored in this document.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MarkdownContent
                      emptyMessage="No comments or workflow activity have been recorded yet."
                      markdown={document.workflow.commentLogMarkdown}
                    />
                  </CardContent>
                </Card>
              </div>

              <DocumentSidebar actor={actor} document={document} />
            </div>
          </TabsContent>
          <TabsContent className="pt-5" value="document">
            <Card>
              <CardHeader>
                <CardTitle>Full document</CardTitle>
                <CardDescription>
                  The complete Markdown source, rendered for reference.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MarkdownContent
                  emptyMessage="This document has no Markdown body."
                  markdown={document.markdown}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
