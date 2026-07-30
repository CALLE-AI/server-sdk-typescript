import { CalleClient, type GoalVariables } from "../src/index.js";

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} before running this example.`);
  }
  return value;
}

function readGoalVariables(): GoalVariables {
  const raw = process.env.CALLE_GOAL_VARIABLES ?? "{}";
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("CALLE_GOAL_VARIABLES must be a JSON object.");
  }

  for (const value of Object.values(parsed)) {
    const isScalar =
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value));
    if (!isScalar) {
      throw new Error(
        "CALLE_GOAL_VARIABLES values must be finite JSON strings, numbers, or booleans."
      );
    }
  }
  return parsed as GoalVariables;
}

const clientOptions: { apiKey: string; baseUrl?: string } = {
  apiKey: requiredEnvironmentVariable("CALLE_API_KEY")
};
if (process.env.CALLE_BASE_URL) {
  clientOptions.baseUrl = process.env.CALLE_BASE_URL;
}

const goalId = requiredEnvironmentVariable("CALLE_GOAL_ID");
const client = new CalleClient(clientOptions);
const goal = await client.goals.get(goalId);

console.error(`Running Goal ${goal.id} (${goal.title ?? "untitled"})...`);
const run = await client.goals.runAndWait(
  {
    goalId,
    phone: requiredEnvironmentVariable("CALLE_EXAMPLE_PHONE"),
    variables: readGoalVariables(),
    idempotencyKey: requiredEnvironmentVariable("CALLE_IDEMPOTENCY_KEY")
  },
  {
    intervalMs: 1000,
    timeoutMs: 600000
  }
);

console.log(JSON.stringify(run, null, 2));
if (run.error !== null) {
  process.exitCode = 1;
}
