import * as path from "path";
import * as os from "os";
import { config as dotenvConfig } from "dotenv";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "granola");
export const CONFIG_ENV = path.join(CONFIG_DIR, ".env");

const BASE_URL = "https://public-api.granola.ai";

export function loadConfig(): void {
  dotenvConfig({ path: CONFIG_ENV });
  dotenvConfig({ path: path.join(process.cwd(), ".env"), override: true });
}

loadConfig();

export class APIError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class GranolaClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async get(
    urlPath: string,
    params?: Record<string, string | number>,
  ): Promise<unknown> {
    const url = new URL(BASE_URL + urlPath);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }

    let retries = 0;
    while (true) {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 429 && retries < 3) {
        const wait = parseFloat(response.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, wait * 1000));
        retries++;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new APIError(response.status, text);
      }

      return await response.json();
    }
  }
}

let _client: GranolaClient | null = null;

export function getClient(): GranolaClient {
  if (!_client) {
    const apiKey = process.env.GRANOLA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GRANOLA_API_KEY not set. Run `granola init` to configure.",
      );
    }
    _client = new GranolaClient(apiKey);
  }
  return _client;
}

export function _setClient(client: GranolaClient | null): void {
  _client = client;
}
