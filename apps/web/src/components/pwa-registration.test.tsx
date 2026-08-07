import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaRegistration } from "./pwa-registration";

describe("PwaRegistration install instructions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves focus into the dialog, closes with Escape, and restores focus", async () => {
    render(<PwaRegistration />);
    const installButton = screen.getByRole("button", {
      name: "Install AVS app",
    });
    installButton.focus();
    fireEvent.click(installButton);

    const closeButton = await screen.findByRole("button", {
      name: "Close install instructions",
    });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Install app" }),
      ).not.toBeInTheDocument(),
    );
    expect(installButton).toHaveFocus();
  });

  it("bypasses HTTP caches when checking for a service-worker update", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = {
      addEventListener: vi.fn(),
      installing: null,
      update,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const register = vi.fn().mockResolvedValue(registration);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener,
        controller: {},
        register,
        removeEventListener,
      },
    });
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });

    render(<PwaRegistration />);

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }),
    );
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(addEventListener).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
    );
  });
});
