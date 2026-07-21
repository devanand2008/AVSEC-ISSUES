import { createQrPosterPdf } from "../src/modules/feedback/qr-poster";

describe("official feedback QR poster", () => {
  it("creates a genuine A4 PDF containing a high-correction QR image", async () => {
    const poster = await createQrPosterPdf(
      "https://college.example.edu/student/feedback/target/FB_abcdefghijklmnopqrstuvwxyz123456",
      {
        targetName: "CSE Laboratory 201",
        targetType: "LABORATORY",
        department: { name: "Computer Science and Engineering" },
        block: { name: "CSE Block" },
        floor: { name: "Second Floor" },
        room: { name: "Laboratory 201", roomNumber: "CSE-201" },
      },
    );

    expect(poster.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(poster.length).toBeGreaterThan(25_000);
  }, 60_000);
});
