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
      stdout: "Hello, AVS Learn!",
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

    await expect(
      service.runCode({} as never, {
        language: "c",
        sourceCode: "int main(void) { return 0; }",
        stdin: "",
      }),
    ).resolves.toMatchObject({
      ok: false,
      provider: "unavailable",
      detail: "Compiler returned HTTP 400.",
    });
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
});
