import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/schema.js";
import { CalleConnectionError, CalleTimeoutError, apiErrorFromResponse } from "./errors.js";

type ApiGoal = components["schemas"]["Goal"];
type ApiGoalList = components["schemas"]["GoalList"];
type ApiGoalRun = components["schemas"]["GoalRun"];
type ApiCreateGoalRunRequest = components["schemas"]["CreateGoalRunRequest"];
type FetchLike = (input: Request) => Promise<Response>;

export type GoalScalar = components["schemas"]["GoalScalar"];
export type GoalVariables = components["schemas"]["GoalVariables"];
export type GoalResult = NonNullable<ApiGoalRun["result"]>;
export type GoalRunStatus = components["schemas"]["GoalRunStatus"];
export type GoalRunErrorCode = components["schemas"]["GoalRunError"]["code"];

export interface GoalPublishedRunSpec {
  id: string;
  version: number;
  inputSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
}

export interface Goal {
  object: "goal";
  id: string;
  title: string | null;
  description: string;
  status: "active";
  publishedRunSpec: GoalPublishedRunSpec;
}

export interface GoalList {
  object: "list";
  data: Goal[];
  nextCursor: string | null;
}

export interface GoalRunSpec {
  id: string;
  version: number;
}

export interface GoalRunError {
  code: GoalRunErrorCode;
  message: string;
  detailCode: string | null;
}

export interface GoalRun {
  object: "goal_run";
  id: string;
  goalId: string;
  runId: string;
  runSpec: GoalRunSpec;
  status: GoalRunStatus;
  result: GoalResult | null;
  error: GoalRunError | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ListGoalsOptions {
  limit?: number;
  after?: string;
}

export interface RunGoalInput {
  goalId: string;
  phone: string;
  variables?: GoalVariables;
  idempotencyKey: string;
}

export interface WaitForGoalResultOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

function fromApiGoal(goal: ApiGoal): Goal {
  return {
    object: goal.object,
    id: goal.id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    publishedRunSpec: {
      id: goal.published_run_spec.id,
      version: goal.published_run_spec.version,
      inputSchema: goal.published_run_spec.input_schema,
      resultSchema: goal.published_run_spec.result_schema
    }
  };
}

function fromApiGoalList(list: ApiGoalList): GoalList {
  return {
    object: list.object,
    data: list.data.map(fromApiGoal),
    nextCursor: list.next_cursor
  };
}

function fromApiGoalRun(run: ApiGoalRun): GoalRun {
  return {
    object: run.object,
    id: run.id,
    goalId: run.goal_id,
    runId: run.run_id,
    runSpec: run.run_spec,
    status: run.status,
    result: run.result,
    error:
      run.error === null
        ? null
        : {
            code: run.error.code,
            message: run.error.message,
            detailCode: run.error.detail_code
          },
    createdAt: run.created_at,
    completedAt: run.completed_at
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requirePositiveDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number.`);
  }
  return value;
}

function waitDurations(options: WaitForGoalResultOptions): {
  intervalMs: number;
  timeoutMs: number;
} {
  return {
    intervalMs: requirePositiveDuration(options.intervalMs ?? 2000, "intervalMs"),
    timeoutMs: requirePositiveDuration(options.timeoutMs ?? 600000, "timeoutMs")
  };
}

export class CalleGoals {
  private readonly client: Client<paths>;

  constructor(input: { baseUrl: string; apiKey: string; fetch?: FetchLike }) {
    const clientOptions: {
      baseUrl: string;
      fetch?: FetchLike;
      headers: Record<string, string>;
    } = {
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      headers: {
        authorization: `Bearer ${input.apiKey}`
      }
    };
    if (input.fetch !== undefined) {
      clientOptions.fetch = input.fetch;
    }
    this.client = createClient<paths>(clientOptions);
  }

  async list(options: ListGoalsOptions = {}): Promise<GoalList> {
    const query: { limit?: number; after?: string } = {};
    if (options.limit !== undefined) {
      query.limit = options.limit;
    }
    if (options.after !== undefined) {
      query.after = options.after;
    }
    const response = await this.client.GET("/v1/goals", {
      params: { query }
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E list goals returned no response body.");
    }
    return fromApiGoalList(response.data);
  }

  async get(goalId: string): Promise<Goal> {
    const response = await this.client.GET("/v1/goals/{goal_id}", {
      params: { path: { goal_id: goalId } }
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E get goal returned no response body.");
    }
    return fromApiGoal(response.data);
  }

  async run(input: RunGoalInput): Promise<GoalRun> {
    const body: ApiCreateGoalRunRequest = {
      phone: input.phone,
      variables: input.variables ?? {}
    };
    const response = await this.client.POST("/v1/goals/{goal_id}/runs", {
      params: {
        path: { goal_id: input.goalId },
        header: { "Idempotency-Key": input.idempotencyKey }
      },
      body
    });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E create goal run returned no response body.");
    }
    return fromApiGoalRun(response.data);
  }

  async getRun(goalId: string, goalRunId: string): Promise<GoalRun> {
    return await this.getRunWithSignal(goalId, goalRunId);
  }

  private async getRunWithSignal(
    goalId: string,
    goalRunId: string,
    signal?: AbortSignal
  ): Promise<GoalRun> {
    const params = {
      path: {
        goal_id: goalId,
        goal_run_id: goalRunId
      }
    };
    const response =
      signal === undefined
        ? await this.client.GET("/v1/goals/{goal_id}/runs/{goal_run_id}", { params })
        : await this.client.GET("/v1/goals/{goal_id}/runs/{goal_run_id}", {
            params,
            signal
          });
    if (response.error) {
      throw apiErrorFromResponse(response.response.status, response.error);
    }
    if (!response.data) {
      throw new CalleConnectionError("CALL-E get goal run returned no response body.");
    }
    return fromApiGoalRun(response.data);
  }

  async waitForResult(
    goalId: string,
    goalRunId: string,
    options: WaitForGoalResultOptions = {}
  ): Promise<GoalRun> {
    const { intervalMs, timeoutMs } = waitDurations(options);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const remainingBeforeRequest = deadline - Date.now();
      if (remainingBeforeRequest <= 0) {
        break;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingBeforeRequest);
      let run: GoalRun;
      try {
        run = await this.getRunWithSignal(goalId, goalRunId, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new CalleTimeoutError(`Timed out waiting for CALL-E Goal Run ${goalRunId}.`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (run.result !== null || run.error !== null) {
        return run;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await sleep(Math.min(intervalMs, remainingMs));
    }
    throw new CalleTimeoutError(`Timed out waiting for CALL-E Goal Run ${goalRunId}.`);
  }

  async runAndWait(
    input: RunGoalInput,
    options: WaitForGoalResultOptions = {}
  ): Promise<GoalRun> {
    waitDurations(options);
    const run = await this.run(input);
    if (run.result !== null || run.error !== null) {
      return run;
    }
    return await this.waitForResult(input.goalId, run.id, options);
  }
}
