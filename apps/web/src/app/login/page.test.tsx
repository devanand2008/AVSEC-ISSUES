import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  warmup: vi.fn(),
  router: { prefetch: vi.fn(), push: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock("@/lib/api", () => ({ api: { warmup: mocks.warmup } }));
vi.mock("@/components/college-branding", () => ({ CollegeBranding: () => null }));
vi.mock("@/features/auth/post-login-routing", () => ({
  getPostAuthenticationRoute: () => "/",
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.warmup.mockResolvedValue(undefined);
  mocks.login.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("campus sign-in", () => {
  it("accepts sign-in while the single Strict Mode connection check is pending", async () => {
    mocks.warmup.mockReturnValue(new Promise<void>(() => undefined));
    render(<StrictMode><LoginPage /></StrictMode>);
    const submit = screen.getByRole("button", { name: "Secure sign in" });

    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText("College ID or Email"), { target: { value: "QA01" } });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "ExamplePass123!" } });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/"));
    expect(mocks.login).toHaveBeenCalledWith("QA01", "ExamplePass123!", undefined);
    expect(mocks.warmup).toHaveBeenCalledTimes(1);
  });

  it("completes sign-in when the browser disallows saving an ID", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("College ID or Email"), { target: { value: "QA01" } });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "ExamplePass123!" } });
    fireEvent.click(screen.getByLabelText("Remember my ID on this device"));
    const submit = screen.getByRole("button", { name: "Secure sign in" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/"));
    expect(mocks.login).toHaveBeenCalledWith("QA01", "ExamplePass123!", undefined);
  });
});
