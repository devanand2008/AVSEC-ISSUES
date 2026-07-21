import { z } from "zod";

export const uuidSchema = z.uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(200),
});

export const issueCreateSchema = z.object({
  roomId: uuidSchema,
  categoryId: uuidSchema,
  issueTypeId: uuidSchema.optional(),
  assetId: uuidSchema.optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  prioritySuggestion: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"]),
  exactPosition: z.string().trim().max(250).optional(),
  createDespiteDuplicate: z.boolean().default(false),
});

export const attendanceRecordSchema = z.object({
  studentUserId: uuidSchema,
  status: z.enum([
    "PRESENT",
    "ABSENT",
    "LATE",
    "ON_DUTY",
    "MEDICAL_LEAVE",
    "AUTHORIZED_LEAVE",
  ]),
  note: z.string().trim().max(500).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type AttendanceRecordInput = z.infer<typeof attendanceRecordSchema>;
