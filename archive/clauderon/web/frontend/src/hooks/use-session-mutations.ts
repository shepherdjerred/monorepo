import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { CreateSessionRequest } from "@clauderon/shared";
import type { MergeMethod } from "@clauderon/shared";

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateSessionRequest) =>
      apiClient.createSession(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useArchiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.archiveSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useUnarchiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.unarchiveSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRefreshSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.refreshSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.startSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useRecreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.recreateSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useCleanupSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.cleanupSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useUpdateSessionMetadata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      title,
      description,
    }: {
      id: string;
      title?: string;
      description?: string;
    }) => apiClient.updateSessionMetadata(id, title, description),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRegenerateMetadata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.regenerateMetadata(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useMergePr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      method,
      deleteBranch,
    }: {
      id: string;
      method: MergeMethod;
      deleteBranch: boolean;
    }) => apiClient.mergePr(id, method, deleteBranch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
