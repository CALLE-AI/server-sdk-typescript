import { CalleCalls } from "./calls";
import { CalleWebhooks } from "./webhooks";

type FetchLike = (input: Request) => Promise<Response>;

export interface CalleClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export class CalleClient {
  readonly calls: CalleCalls;
  readonly webhooks: CalleWebhooks;

  constructor(options: CalleClientOptions) {
    const baseUrl = options.baseUrl ?? "https://api.example.com";
    this.calls =
      options.fetch !== undefined
        ? new CalleCalls({ apiKey: options.apiKey, baseUrl, fetch: options.fetch })
        : new CalleCalls({ apiKey: options.apiKey, baseUrl });
    this.webhooks = new CalleWebhooks();
  }
}
