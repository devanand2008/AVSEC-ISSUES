"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue { user: User | null; loading: boolean; login: (identifier: string, password: string, collegeCode?: string) => Promise<User>; logout: () => Promise<void>; refetch: () => Promise<unknown> }
const AuthContext = createContext<AuthContextValue | null>(null);

function clearAuthenticatedState(client: QueryClient) {
  client.setQueryData(["me"], null);
  client.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== "me" });
}

export function performLogout(
  client: QueryClient,
  revokeSession: () => Promise<unknown> = () =>
    api.post("/auth/logout", undefined, undefined, { keepalive: true }),
): Promise<void> {
  void client.cancelQueries().catch(() => undefined);
  clearAuthenticatedState(client);
  void revokeSession()
    .catch(() => undefined)
    .finally(() => clearAuthenticatedState(client));
  return Promise.resolve();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => api.get<User>("/auth/me", { signal }), retry: false, staleTime: 60_000 });
  const { refetch } = query;
  useEffect(() => {
    // On BFCache restore (mobile Safari/Chrome back-navigation), the page is
    // re-shown from cache without re-running React. We must refetch the user
    // state immediately so `mustChangePassword` reflects the actual DB value
    // instead of whatever was in the React tree when the page was cached.
    const refreshAfterRestore = async (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Invalidate the React Query cache for "me" so the next call hits the network
      await client.invalidateQueries({ queryKey: ["me"] });
      void refetch();
    };
    window.addEventListener("pageshow", refreshAfterRestore);
    return () => window.removeEventListener("pageshow", refreshAfterRestore);
  }, [client, refetch]);
  const value: AuthContextValue = {
    user: query.data ?? null,
    loading: query.isLoading,
    async login(identifier, password, collegeCode) {
      // Use the user returned by /auth/login directly — no second /auth/me call needed
      const { user } = await api.post<{ user: User }>("/auth/login", { identifier, password, ...(collegeCode ? { collegeCode } : {}) });
      client.cancelQueries({ predicate: ({ queryKey }) => queryKey[0] !== "me" });
      client.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== "me" });
      client.setQueryData(["me"], user);
      return user;
    },
    async logout() { await performLogout(client); },
    refetch: query.refetch,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
