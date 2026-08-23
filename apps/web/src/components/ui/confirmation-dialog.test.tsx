import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./confirmation-dialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <ConfirmationDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={vi.fn()}
        title="Confirm change"
        description="Review this change before continuing."
      />
    </>
  );
}

describe("ConfirmationDialog keyboard behavior", () => {
  it("traps focus, closes on Escape, and restores focus to its opener", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("alertdialog");
    const close = screen.getByRole("button", { name: "Close" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await waitFor(() => expect(close).toHaveFocus());

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
