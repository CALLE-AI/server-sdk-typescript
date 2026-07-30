import { CalleCalls } from "./calls.js";
import { CalleGoals } from "./goals.js";
import { CalleWebhooks } from "./webhooks.js";

type FetchLike = (input: Request) => Promise<Response>;

export interface CalleClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export class CalleClient {
  readonly calls: CalleCalls;
  readonly goals: CalleGoals;
  readonly webhooks: CalleWebhooks;

  constructor(options: CalleClientOptions) {
    const baseUrl = options.baseUrl ?? "https://api.heycall-e.com";
    this.calls =
      options.fetch !== undefined
        ? new CalleCalls({ apiKey: options.apiKey, baseUrl, fetch: options.fetch })
        : new CalleCalls({ apiKey: options.apiKey, baseUrl });
    this.goals =
      options.fetch !== undefined
        ? new CalleGoals({ apiKey: options.apiKey, baseUrl, fetch: options.fetch })
        : new CalleGoals({ apiKey: options.apiKey, baseUrl });
    this.webhooks = new CalleWebhooks();
  }
}
