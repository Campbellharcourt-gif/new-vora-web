import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny local stand-in for the Cloudflare REST API, so the REAL `wrangler deploy` (the exact
 * version in package-lock.json) can be exercised without an account or any network access.
 * It records every call, answers the pre-upload questions Wrangler asks, and always REFUSES the
 * final upload, so a test run can never publish anything even by mistake.
 */
export interface MockScenario {
  /** Does the Worker already exist in the (pretend) account? */
  workerExists: boolean;
  /** R2 buckets that exist. */
  buckets: string[];
  /** Secrets already stored on the Worker. */
  secrets: string[];
}

export interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

export interface UploadBinding {
  name: string;
  type: string;
  [key: string]: unknown;
}

export const MOCK_REFUSAL = "mock API refuses every upload (test harness)";

function envelope(res: ServerResponse, status: number, result: unknown, errors: object[] = []) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: errors.length === 0, errors, messages: [], result }));
}

function notFound(res: ServerResponse, code: number, message: string) {
  envelope(res, 404, null, [{ code, message }]);
}

/** Pulls the JSON `metadata` part out of a multipart Worker upload. */
export function uploadMetadata(body: string): { bindings: UploadBinding[] } | null {
  const match = /name="metadata"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/.exec(body);
  return match?.[1] ? (JSON.parse(match[1]) as { bindings: UploadBinding[] }) : null;
}

export class MockCloudflareApi {
  readonly calls: RecordedCall[] = [];
  private server: Server | null = null;

  constructor(private readonly scenario: MockScenario) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/client/v4`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  /** Calls whose path matches a pattern (paths are recorded without the /client/v4 prefix). */
  find(method: string, pattern: RegExp): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }

  /** The metadata of the (refused) upload, if Wrangler got that far. */
  upload(): { bindings: UploadBinding[] } | null {
    const call = this.calls.find(
      (c) =>
        (c.method === "PUT" && /\/workers\/scripts\/[^/]+$/.test(c.path)) ||
        (c.method === "POST" && /\/workers\/scripts\/[^/]+\/versions$/.test(c.path)),
    );
    return call ? uploadMetadata(call.body) : null;
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const url = new URL(req.url ?? "/", "http://mock");
      const path = url.pathname.replace(/^\/client\/v4/, "");
      const method = req.method ?? "GET";
      this.calls.push({ method, path, body });
      const { workerExists, buckets, secrets } = this.scenario;
      const missingWorker = () => notFound(res, 10007, "workers.api.error.script_not_found");

      if (method === "GET" && /^\/accounts\/[^/]+\/workers\/services\/[^/]+$/.test(path)) {
        return workerExists
          ? envelope(res, 200, {
              default_environment: {
                environment: "production",
                script: { tag: "mock", tags: [], last_deployed_from: "wrangler" },
              },
            })
          : missingWorker();
      }
      if (method === "GET" && /\/workers\/scripts\/[^/]+\/secrets$/.test(path)) {
        return workerExists
          ? envelope(
              res,
              200,
              secrets.map((name) => ({ name, type: "secret_text" })),
            )
          : missingWorker();
      }
      if (method === "GET" && /\/workers\/scripts\/[^/]+\/deployments$/.test(path)) {
        return workerExists ? envelope(res, 200, { deployments: [] }) : missingWorker();
      }
      if (method === "GET" && /\/workers\/scripts\/[^/]+\/settings$/.test(path)) {
        return workerExists ? envelope(res, 200, { bindings: [] }) : missingWorker();
      }
      if (method === "GET" && /\/r2\/buckets\/[^/]+$/.test(path)) {
        const name = decodeURIComponent(path.split("/").pop() ?? "");
        return buckets.includes(name)
          ? envelope(res, 200, { name, location: "OC" })
          : notFound(res, 10006, "The specified bucket does not exist.");
      }
      if (method === "GET" && /\/r2\/buckets$/.test(path)) {
        return envelope(res, 200, { buckets: buckets.map((name) => ({ name })) });
      }
      if (method === "POST" && /\/r2\/buckets$/.test(path)) {
        return envelope(res, 200, {}); // recorded above — tests assert this never happens
      }
      const isUpload =
        (method === "PUT" && /\/workers\/scripts\/[^/]+$/.test(path)) ||
        (method === "POST" && /\/workers\/scripts\/[^/]+\/versions$/.test(path));
      if (isUpload) {
        const inherited = (uploadMetadata(body)?.bindings ?? [])
          .filter((b) => b.type === "inherit")
          .map((b) => b.name);
        const missing = inherited.filter((name) => !secrets.includes(name));
        if (missing.length > 0) {
          // What Cloudflare answers when an inherited secret does not exist (code 10057).
          return envelope(
            res,
            400,
            null,
            missing.map((name) => ({
              code: 10057,
              message: `inherit binding '${name}' is invalid: no such secret on the Worker (mock)`,
            })),
          );
        }
        return envelope(res, 400, null, [{ code: 10021, message: MOCK_REFUSAL }]);
      }
      return envelope(res, 404, null, [
        { code: 99999, message: `mock: no handler for ${method} ${path}` },
      ]);
    });
  }
}
