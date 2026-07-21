import type { Request } from "express";

export interface AuthPrincipal {
  id: string;
  publicId: string;
  collegeId: string;
  fullName: string;
  email: string | null;
  status: string;
  mustChangePassword: boolean;
  firstLoginCompletedAt?: Date | null;
  sessionId: string;
  roles: string[];
  permissions: string[];
  scopes: Array<{ type: string; id: string | null; issueCategoryId: string | null }>;
}

export interface AuthenticatedRequest extends Request {
  id: string;
  user: AuthPrincipal;
}

export interface RequestWithId extends Request {
  id: string;
}
