import { useMutation } from "@tanstack/react-query";
import { api, queryClient } from "./api.ts";

function refresh(): void {
  void queryClient.invalidateQueries();
}

export function useSetKeep() {
  return useMutation({
    mutationFn: (input: { slug: string; keep: boolean }) =>
      api.boards.setKeep.mutate(input),
    onSuccess: refresh,
  });
}

export function useArchive() {
  return useMutation({
    mutationFn: (input: { slug: string; archived: boolean }) =>
      api.boards.archive.mutate(input),
    onSuccess: refresh,
  });
}

export function useCreateThread() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.threads.create.mutate>[0]) =>
      api.threads.create.mutate(input),
    onSuccess: refresh,
  });
}

export function useReply() {
  return useMutation({
    mutationFn: (input: { threadId: string; body: string }) =>
      api.threads.reply.mutate({ ...input, resolve: false }),
    onSuccess: refresh,
  });
}

export function useSetResolved() {
  return useMutation({
    mutationFn: (input: { threadId: string; resolved: boolean }) =>
      input.resolved
        ? api.threads.resolve.mutate({ threadId: input.threadId })
        : api.threads.reopen.mutate({ threadId: input.threadId }),
    onSuccess: refresh,
  });
}

export function useEditComment() {
  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) =>
      api.threads.editComment.mutate(input),
    onSuccess: refresh,
  });
}

export function useDeleteComment() {
  return useMutation({
    mutationFn: (input: { commentId: string }) =>
      api.threads.deleteComment.mutate(input),
    onSuccess: refresh,
  });
}

export function useRedeliver() {
  return useMutation({
    mutationFn: (input: { commentId: string }) =>
      api.feedback.redeliver.mutate(input),
    onSuccess: refresh,
  });
}
