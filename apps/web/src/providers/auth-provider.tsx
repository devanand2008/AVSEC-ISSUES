"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue { user: User | null; loading: boolean; login: (identifier: string, password: string, collegeCode?: string) => Promise<User>; logout: () => Promise<void>; refetch: () => Promise<unknown> }
const AuthContext = createContext<AuthContextValue | null>(null);
const publicAuthRoutes = new Set(["/login", "/forgot-password", "/reset-password"]);

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
  const pathname = usePathname();
  const needsSession = !publicAuthRoutes.has(pathname);
  const query = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api.get<User>("/auth/me", { signal }),
    enabled: needsSession,
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!needsSession) return;
    // A page restored from the browser cache can contain stale account state.
    const refreshAfterRestore = (event: PageTransitionEvent) => {
      if (event.persisted) void client.invalidateQueries({ queryKey: ["me"], exact: true });
    };
    window.addEventListener("pageshow", refreshAfterRestore);
    return () => window.removeEventListener("pageshow", refreshAfterRestore);
  }, [client, needsSession]);
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
