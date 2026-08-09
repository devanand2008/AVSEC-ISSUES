import { ConfigService } from "@nestjs/config";
import express from "express";
import request from "supertest";
import { createCorsOriginGuard } from "../src/common/http/allowed-origins";

function config(): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === "CORS_ALLOWED_ORIGINS"
        ? "https://avs-college-portal.onrender.com"
        : undefined,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (key === "WEB_URL") {
        return "https://avs-college-portal.onrender.com";
      }
      throw new Error(`Unexpected configuration key: ${key}`);
    }),
  } as unknown as ConfigService;
}

describe("CORS origin guard", () => {
  function application() {
    const app = express();
    app.use(createCorsOriginGuard(config()));
    app.all("/resource", (_request, response) => {
      response.json({ ok: true });
    });
    return app;
  }

  it("returns a controlled 403 without a CORS allow header", async () => {
    const response = await request(application())
      .options("/resource")
      .set("Origin", "https://malicious.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(403);

    expect(response.body).toEqual({
      statusCode: 403,
      error: "Forbidden",
      message: "Request origin is not allowed.",
    });
    expect(response.headers.vary).toContain("Origin");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows configured and origin-less requests to continue", async () => {
    await request(application())
      .get("/resource")
      .set("Origin", "https://avs-college-portal.onrender.com")
      .expect(200, { ok: true });
    await request(application()).get("/resource").expect(200, { ok: true });
  });
});
