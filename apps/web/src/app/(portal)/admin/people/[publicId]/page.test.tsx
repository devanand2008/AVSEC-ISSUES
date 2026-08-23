import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks }));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: {
      permissions: [
        "users.read",
        "users.update",
        "roles.read",
        "roles.manage",
        "scopes.manage",
      ],
      roles: ["MAIN_ADMIN"],
    },
  }),
}));

const person = {
  id: "internal-user-id",
  publicId: "person-public-id",
  collegeIdentityId: "AVS001",
  fullName: "Imported Student",
  email: null,
  mobile: "9876543210",
  whatsappNumber: null,
  status: "ACTIVE",
  mustChangePassword: true,
  firstLoginCompletedAt: null,
  lastLoginAt: null,
  archivedAt: null,
  roles: [
    {
      roleId: "student-role-id",
      role: { code: "STUDENT", name: "Student" },
      isPrimary: true,
    },
  ],
  scopes: [
    { scopeType: "SECTION", scopeId: "section-id", issueCategoryId: null },
  ],
  studentProfile: {
    departmentId: "department-id",
    programmeId: "programme-id",
    sectionId: "section-id",
    studentId: "AVS001",
    registerNumber: null,
    rollNumber: null,
    studyYear: 2,
    dateOfBirth: null,
    gender: null,
    admissionYear: 2026,
    parentName: null,
    parentMobileNumber: null,
    emergencyContact: null,
    department: { name: "Computer Science", code: "CSE" },
    programme: { name: "B.E. Computer Science", code: "B.E.CSE" },
    section: {
      id: "section-id",
      name: "Section A",
      code: "A",
      semesterId: "semester-id",
      studyYear: 2,
      assignedRoom: {
        id: "room-id",
        code: "CSE-201",
        name: "Second Year Classroom",
        roomNumber: "201",
      },
    },
  },
  staffProfile: null,
};

const staffPerson = {
  ...person,
  collegeIdentityId: "FAC001",
  fullName: "Faculty Member",
  email: "faculty@college.edu",
  roles: [
    {
      roleId: "faculty-role-id",
      role: { code: "FACULTY", name: "Faculty" },
      isPrimary: true,
    },
  ],
  scopes: [],
  studentProfile: null,
  staffProfile: {
    departmentId: "00000000-0000-4000-8000-000000000010",
    employeeId: "FAC001",
    designation: "Assistant Professor",
    specialization: "Networks",
    department: { name: "Computer Science", code: "CSE" },
  },
};

const paramsValue = { publicId: "person-public-id" };
const params = Object.assign(Promise.resolve(paramsValue), {
  status: "fulfilled",
  value: paramsValue,
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div>Loading test page</div>}>
        <PersonDetailPage params={params} />
      </Suspense>
    </QueryClientProvider>,
  );
}

describe("People detail management", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation((path: string) => {
      if (path === "/admin/people/person-public-id") {
        return Promise.resolve(person);
      }
      if (path === "/roles") {
        return Promise.resolve([
          { code: "STUDENT", name: "Student", description: null },
          { code: "FACULTY", name: "Faculty", description: null },
        ]);
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    mocks.patch.mockResolvedValue({ ok: true });
  });

  it("uses update permission for identity edits and preserves scopes during role changes", async () => {
    renderPage();
    expect((await screen.findAllByText("Imported Student")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("alertdialog");
    fireEvent.change(within(editDialog).getByLabelText("User Name"), {
      target: { value: "Updated Student" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/admin/people/person-public-id",
        {
          fullName: "Updated Student",
          collegeIdentityId: "AVS001",
          email: null,
          mobile: "9876543210",
        },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage roles" }));
    const rolesDialog = screen.getByRole("alertdialog");
    fireEvent.click(await within(rolesDialog).findByLabelText("Faculty"));
    fireEvent.change(within(rolesDialog).getByLabelText("Reason for role change"), {
      target: { value: "Approved teaching assignment" },
    });
    fireEvent.click(within(rolesDialog).getByRole("button", { name: "Save roles" }));

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/users/person-public-id/access",
        {
          roleCodes: ["STUDENT", "FACULTY"],
          scopes: [{ type: "SECTION", id: "section-id" }],
          reason: "Approved teaching assignment",
        },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Academic / Employment" }));
    expect(screen.getByText("CSE-201 - Second Year Classroom")).toBeInTheDocument();
  });

  it("loads active departments and submits a changed staff department", async () => {
    const newDepartmentId = "00000000-0000-4000-8000-000000000020";
    mocks.get.mockImplementation((path: string) => {
      if (path === "/admin/people/person-public-id") {
        return Promise.resolve(staffPerson);
      }
      if (path === "/admin/people/filter-options") {
        return Promise.resolve({
          departments: [
            {
              id: staffPerson.staffProfile.departmentId,
              code: "CSE",
              name: "Computer Science",
            },
            {
              id: newDepartmentId,
              code: "ECE",
              name: "Electronics and Communication",
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    renderPage();
    await screen.findAllByText("Faculty Member");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("alertdialog");
    const department = await within(editDialog).findByLabelText("Department");
    await waitFor(() => expect(department).not.toBeDisabled());
    fireEvent.change(department, { target: { value: newDepartmentId } });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "/admin/people/person-public-id",
        {
          fullName: "Faculty Member",
          collegeIdentityId: "FAC001",
          email: "faculty@college.edu",
          mobile: "9876543210",
          departmentId: newDepartmentId,
        },
      ),
    );
  });
});
