#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { CalleClient } from "./client.js";
import { CalleAPIError, CalleTimeoutError } from "./errors.js";
import type { Call, CreateCallInput, EventList, ListEventsOptions } from "./calls.js";

interface CliClient {
  calls: {
    create(input: CreateCallInput, options?: RequestOptions): Promise<Call>;
    createAndWait(input: CreateCallInput, options?: RequestOptions & WaitOptions): Promise<Call>;
    get(callId: string): Promise<Call>;
    listEvents(callId: string, options?: ListEventsOptions): Promise<EventList>;
  };
}

interface RequestOptions {
  idempotencyKey?: string;
}

interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
}

interface CliFlags {
  apiKey?: string;
  baseUrl?: string;
  help: boolean;
  idempotencyKey?: string;
  intervalMs?: number;
  json: boolean;
  phones: string[];
  task?: string;
  timeoutMs?: number;
  wait: boolean;
}

interface ParsedArgs {
  positionals: string[];
  flags: CliFlags;
}

interface EventProgressState {
  cursor?: string;
  seenEventIds: Set<string>;
}

export interface RunCalleCliOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  createClient?: (options: ClientOptions) => CliClient;
}

const usage = `Usage:
  calle calls create --task <text> [--phone <E164>] [--wait] [--api-key <key>]
  calle calls get <call_id> [--api-key <key>]

Options:
  --api-key <key>             CALL-E API key. Overrides CALLE_API_KEY.
  --base-url <url>            CALL-E API base URL. Overrides CALLE_BASE_URL.
  --phone <number>            E.164 phone number. Repeatable.
  --task <text>               Call task instruction.
  --wait                      Poll until the call reaches a terminal status.
  --idempotency-key <key>     Idempotency key for create requests.
  --interval-ms <ms>          Poll interval when --wait is used.
  --timeout-ms <ms>           Wait timeout when --wait is used.
  --json                      Print the full call object as JSON.
  --help                      Show this help.
`;

function readOption(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = {
    help: false,
    json: false,
    phones: [],
    wait: false
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--wait") {
      flags.wait = true;
    } else if (arg === "--api-key") {
      flags.apiKey = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      flags.baseUrl = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--phone") {
      flags.phones.push(readOption(argv, index, arg));
      index += 1;
    } else if (arg === "--task") {
      flags.task = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--idempotency-key") {
      flags.idempotencyKey = readOption(argv, index, arg);
      index += 1;
    } else if (arg === "--interval-ms") {
      flags.intervalMs = parsePositiveInteger(readOption(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--timeout-ms") {
      flags.timeoutMs = parsePositiveInteger(readOption(argv, index, arg), arg);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

function requireApiKey(flags: CliFlags, env: Record<string, string | undefined>): string {
  const apiKey = flags.apiKey ?? env.CALLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. Pass --api-key or set CALLE_API_KEY.");
  }
  return apiKey;
}

function clientOptions(apiKey: string, flags: CliFlags, env: Record<string, string | undefined>): ClientOptions {
  const baseUrl = flags.baseUrl ?? env.CALLE_BASE_URL;
  if (baseUrl) {
    return { apiKey, baseUrl };
  }
  return { apiKey };
}

function createInput(flags: CliFlags): CreateCallInput {
  if (!flags.task) {
    throw new Error("Missing call task. Pass --task <text>.");
  }
  const input: CreateCallInput = { task: flags.task };
  if (flags.phones.length > 0) {
    input.recipients = flags.phones.map((phone) => ({ phones: [phone] }));
  }
  return input;
}

function createRequestOptions(flags: CliFlags): RequestOptions {
  const options: RequestOptions = {};
  if (flags.idempotencyKey !== undefined) {
    options.idempotencyKey = flags.idempotencyKey;
  }
  return options;
}

function printCall(call: Call, json: boolean, stdout: (text: string) => void): void {
  if (json) {
    stdout(`${JSON.stringify(call, null, 2)}\n`);
    return;
  }
  stdout(`${call.id}\t${call.status}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof CalleAPIError) {
    return `${error.name}: ${error.message} (${error.code}, HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isTerminalCall(call: Call): boolean {
  return call.status === "completed" || call.status === "failed" || call.status === "canceled";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function printNewEvents(
  callId: string,
  client: CliClient,
  state: EventProgressState,
  stderr: (text: string) => void
): Promise<void> {
  const options: ListEventsOptions = { limit: 100 };
  if (state.cursor !== undefined) {
    options.cursor = state.cursor;
  }

  const events = await client.calls.listEvents(callId, options);
  for (const event of events.data) {
    if (state.seenEventIds.has(event.id)) {
      continue;
    }
    state.seenEventIds.add(event.id);
    if (event.message.trim()) {
      stderr(`Event: ${event.message}\n`);
    }
  }
  if (events.nextCursor !== null) {
    state.cursor = events.nextCursor;
  }
}

async function waitForCallResult(
  call: Call,
  flags: CliFlags,
  client: CliClient,
  stderr: (text: string) => void
): Promise<Call> {
  if (isTerminalCall(call)) {
    return call;
  }

  const intervalMs = flags.intervalMs ?? 2000;
  const timeoutMs = flags.timeoutMs ?? 600000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = call.status;
  const eventState: EventProgressState = { seenEventIds: new Set<string>() };

  stderr("Waiting for call result...\n");
  await printNewEvents(call.id, client, eventState, stderr);

  while (Date.now() <= deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(intervalMs, remainingMs));

    const nextCall = await client.calls.get(call.id);
    await printNewEvents(call.id, client, eventState, stderr);
    if (nextCall.status !== lastStatus) {
      stderr(`Status: ${nextCall.status}\n`);
      lastStatus = nextCall.status;
    }
    if (isTerminalCall(nextCall)) {
      return nextCall;
    }
  }

  throw new CalleTimeoutError(`Timed out waiting for CALL-E call ${call.id}.`);
}

async function runCreate(
  flags: CliFlags,
  client: CliClient,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<void> {
  const input = createInput(flags);
  const options = createRequestOptions(flags);
  if (!flags.wait) {
    const created = await client.calls.create(input, options);
    printCall(created, flags.json, stdout);
    return;
  }

  stderr("Creating call task...\n");
  const created = await client.calls.create(input, options);
  stderr(`Created ${created.id} with status ${created.status}.\n`);
  const call = await waitForCallResult(created, flags, client, stderr);
  printCall(call, flags.json, stdout);
}

async function runGet(positionals: string[], flags: CliFlags, client: CliClient, stdout: (text: string) => void): Promise<void> {
  const callId = positionals[0];
  if (!callId) {
    throw new Error("Missing call id. Usage: calle calls get <call_id>");
  }
  const call = await client.calls.get(callId);
  printCall(call, flags.json, stdout);
}

export async function runCalleCli(options: RunCalleCliOptions): Promise<number> {
  const createClient = options.createClient ?? ((clientInput: ClientOptions) => new CalleClient(clientInput));

  try {
    const parsed = parseArgs(options.argv);
    if (parsed.flags.help || parsed.positionals.length === 0) {
      options.stdout(usage);
      return 0;
    }

    const [resource, action, ...positionals] = parsed.positionals;
    if (resource !== "calls") {
      throw new Error(`Unknown command: ${resource}`);
    }

    const apiKey = requireApiKey(parsed.flags, options.env);
    const client = createClient(clientOptions(apiKey, parsed.flags, options.env));

    if (action === "create") {
      await runCreate(parsed.flags, client, options.stdout, options.stderr);
      return 0;
    }
    if (action === "get") {
      await runGet(positionals, parsed.flags, client, options.stdout);
      return 0;
    }

    throw new Error(`Unknown calls command: ${action ?? ""}`);
  } catch (error) {
    options.stderr(`${formatError(error)}\n`);
    return 1;
  }
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectRun()) {
  const exitCode = await runCalleCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  });
  process.exitCode = exitCode;
}
