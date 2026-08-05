import {
  COMPILER_PROVIDER_TIMEOUTS_MS,
  LearnService,
} from "../src/modules/learn/learn.service";

describe("LearnService compiler reliability", () => {
  const originalFetch = global.fetch;
  const webRequestTimeoutMs = 30_000;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("retries a transient provider failure once", async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: {
              stdout: "Hello, AVS Learn!\n",
              stderr: "",
              code: 0,
              signal: null,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as jest.Mock;
    const service = new LearnService({} as never);

    await expect(
      service.runCode({} as never, {
        language: "c",
        sourceCode: "int main(void) { return 0; }",
        stdin: "",
      }),
    ).resolves.toMatchObject({
      ok: true,
      stdout: "Hello, AVS Learn!\n",
      provider: "piston",
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([
      COMPILER_PROVIDER_TIMEOUTS_MS.judge0,
      COMPILER_PROVIDER_TIMEOUTS_MS.judge0,
      COMPILER_PROVIDER_TIMEOUTS_MS.piston,
      COMPILER_PROVIDER_TIMEOUTS_MS.piston,
    ]);
  });

  it("does not retry a permanent provider rejection", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("", { status: 400 }),
    ) as jest.Mock;
    const service = new LearnService({} as never);

    const result = await service.runCode({} as never, {
      language: "c",
      sourceCode: "int main(void) { return 0; }",
      stdin: "",
    });
    expect(result).toMatchObject({
      ok: false,
      provider: "unavailable",
    });
    expect(result).not.toHaveProperty("detail");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the complete provider fallback budget below the web timeout", () => {
    const maximumProviderWait =
      COMPILER_PROVIDER_TIMEOUTS_MS.judge0 *
        COMPILER_PROVIDER_TIMEOUTS_MS.judge0Attempts +
      COMPILER_PROVIDER_TIMEOUTS_MS.piston *
        COMPILER_PROVIDER_TIMEOUTS_MS.pistonAttempts;

    expect(maximumProviderWait).toBeLessThan(webRequestTimeoutMs);
  });

  it.each([
    ["c", 103],
    ["cpp", 105],
    ["java", 91],
    ["python", 100],
    ["javascript", 102],
  ])("maps %s to the configured sandbox language and preserves output", async (language, languageId) => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      stdout: Buffer.from("first\r\nsecond\r", "utf8").toString("base64"),
      stderr: null,
      compile_output: null,
      status: { id: 3, description: "Accepted" },
      time: "0.025",
      memory: 12000,
    }), { status: 200, headers: { "content-type": "application/json" } })) as jest.Mock;
    const create = jest.fn().mockResolvedValue({ id: "execution-1" });
    const service = new LearnService({ compilerExecution: { create } } as never);
    await expect(service.runCode({ id: "user-1", collegeId: "college-1" } as never, {
      language,
      sourceCode: "configured source",
      stdin: "",
    })).resolves.toMatchObject({
      success: true,
      status: "ACCEPTED",
      stdout: "first\nsecond\n",
      executionTimeMs: 25,
      memoryKb: 12000,
    });
    const request = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0]![1].body));
    expect(request.language_id).toBe(languageId);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceLength: 17, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), status: "ACCEPTED" }) });
  });

  it.each([
    [6, "COMPILATION_ERROR", "compile_output"],
    [10, "RUNTIME_ERROR", "stderr"],
    [5, "TIME_LIMIT_EXCEEDED", "stderr"],
  ])("normalizes Judge0 status %s as %s", async (statusId, expectedStatus, errorField) => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      stdout: null,
      stderr: errorField === "stderr" ? Buffer.from("safe error", "utf8").toString("base64") : null,
      compile_output: errorField === "compile_output" ? Buffer.from("safe compile error", "utf8").toString("base64") : null,
      status: { id: statusId },
    }), { status: 200, headers: { "content-type": "application/json" } })) as jest.Mock;
    const service = new LearnService({ compilerExecution: { create: jest.fn() } } as never);
    await expect(service.runCode({ id: "user-1", collegeId: "college-1" } as never, { language: "python", sourceCode: "print('x')", stdin: "" })).resolves.toMatchObject({
      success: false,
      status: expectedStatus,
    });
  });
});
