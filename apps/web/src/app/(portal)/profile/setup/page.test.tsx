import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSetupPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      id: "student-1",
      fullName: "AVS Student",
      email: "student@example.edu",
      status: "ACTIVE",
      mustChangePassword: false,
      profileCompletionStatus: "IN_PROGRESS",
      allowedNextRoute: "/profile/setup",
      roles: ["STUDENT"],
      permissions: [],
    },
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    get: mocks.get,
    patch: mocks.patch,
    post: mocks.post,
  },
}));

const requirements = {
  role: "STUDENT",
  profileKind: "STUDENT",
  requiredFields: [
    "fullName",
    "collegeId",
    "departmentId",
    "mobileNumber",
    "programmeId",
    "academicYearId",
    "studyYear",
    "semesterId",
    "sectionId",
  ],
  lockedFields: [
    "email",
    "collegeId",
    "registerNumber",
    "departmentId",
    "studyYear",
    "programmeId",
    "academicYearId",
    "semesterId",
    "sectionId",
  ],
  lockedValues: {
    email: "student@example.edu",
    fullName: "AVS Student",
    collegeIdentityId: "AVS001",
    registerNumber: "REG001",
    studyYear: 2,
    department: {
      id: "department-1",
      code: "CSE",
      name: "Computer Science",
    },
    programmeId: "programme-1",
    academicYearId: "academic-year-1",
    semesterId: "semester-1",
    sectionId: "section-1",
    primaryRole: "STUDENT",
  },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProfileSetupPage />
    </QueryClientProvider>,
  );
}

describe("Profile setup academic ownership", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation((path: string) => {
      if (path === "/users/me/profile-requirements")
        return Promise.resolve(requirements);
      if (path === "/profile/me")
        return Promise.resolve({
          fullName: "AVS Student",
          mobile: "9876543210",
          profilePhotoKey: null,
          studentProfile: {
            studentId: "AVS001",
            registerNumber: "REG001",
            departmentId: "department-1",
            programmeId: "programme-1",
            sectionId: "section-1",
            section: {
              id: "section-1",
              semester: {
                id: "semester-1",
                academicYearId: "academic-year-1",
              },
            },
            studyYear: 2,
            dateOfBirth: null,
            gender: null,
            parentMobileNumber: null,
            emergencyContact: null,
          },
          staffProfile: null,
        });
      if (path === "/academic/programmes?departmentId=department-1")
        return Promise.resolve([
          { id: "programme-1", code: "CSE", name: "Computer Science" },
        ]);
      if (path === "/academic/years")
        return Promise.resolve([
          { id: "academic-year-1", name: "2025-26", isCurrent: true },
        ]);
      if (
        path ===
        "/academic/semesters?programmeId=programme-1&academicYearId=academic-year-1"
      )
        return Promise.resolve([{ id: "semester-1", name: "Semester 3" }]);
      if (path === "/academic/sections?semesterId=semester-1")
        return Promise.resolve([
          { id: "section-1", code: "A", name: "Section A" },
        ]);
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
  });

  it("renders every authoritative academic placement select as locked", async () => {
    renderPage();

    expect(await screen.findByLabelText(/Programme/)).toBeDisabled();
    expect(screen.getByLabelText(/Academic Year/)).toBeDisabled();
    expect(screen.getByLabelText(/Study Year/)).toBeDisabled();
    expect(screen.getByLabelText(/Semester/)).toBeDisabled();
    expect(screen.getByLabelText(/Section/)).toBeDisabled();

    expect(screen.getByLabelText(/Programme/)).toHaveValue("programme-1");
    expect(screen.getByLabelText(/Academic Year/)).toHaveValue(
      "academic-year-1",
    );
    expect(screen.getByLabelText(/Semester/)).toHaveValue("semester-1");
    expect(screen.getByLabelText(/Section/)).toHaveValue("section-1");
  });
});
