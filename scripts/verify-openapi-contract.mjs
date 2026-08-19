import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

const specPath = resolve("openapi/calle.openapi.yaml");
const spec = YAML.parse(readFileSync(specPath, "utf8"));

function assertContract(condition, message) {
  if (!condition) {
    throw new Error(`OpenAPI contract check failed: ${message}`);
  }
}

function responseSchemaRef(path, method, status = "200") {
  return spec.paths?.[path]?.[method]?.responses?.[status]?.content?.[
    "application/json"
  ]?.schema?.$ref;
}

function requestSchemaRef(path, method) {
  return spec.paths?.[path]?.[method]?.requestBody?.content?.[
    "application/json"
  ]?.schema?.$ref;
}

function parameterRefs(path, method) {
  return (spec.paths?.[path]?.[method]?.parameters ?? []).map(
    (parameter) => parameter.$ref,
  );
}

assertContract(spec.openapi === "3.1.0", "expected OpenAPI 3.1.0");
assertContract(spec.info?.title === "CALL-E Developer API", "unexpected title");
assertContract(spec.info?.version === "0.7.0", "unexpected API version");

const requiredOperations = [
  {
    path: "/v1/calls",
    method: "post",
    operationId: "createCall",
    requestSchema: "#/components/schemas/CreateCallRequest",
    responseStatus: "201",
    responseSchema: "#/components/schemas/CallTask",
    errorStatuses: ["400", "401", "403", "409", "422", "429", "500"],
  },
  {
    path: "/v1/calls/{call_id}",
    method: "get",
    operationId: "getCall",
    responseSchema: "#/components/schemas/CallTask",
    errorStatuses: ["401", "403", "404", "429", "500"],
  },
  {
    path: "/v1/calls/{call_id}/events",
    method: "get",
    operationId: "listCallEvents",
    responseSchema: "#/components/schemas/EventList",
    errorStatuses: ["401", "403", "404", "429", "500"],
  },
  {
    path: "/v1/goals",
    method: "get",
    operationId: "listGoals",
    responseSchema: "#/components/schemas/GoalList",
    errorStatuses: ["400", "401", "403", "429", "500"],
  },
  {
    path: "/v1/goals/{goal_id}",
    method: "get",
    operationId: "getGoal",
    responseSchema: "#/components/schemas/Goal",
    errorStatuses: ["401", "403", "404", "409", "429", "500", "502", "503"],
  },
  {
    path: "/v1/goals/{goal_id}/runs",
    method: "post",
    operationId: "createGoalRun",
    requestSchema: "#/components/schemas/CreateGoalRunRequest",
    responseStatus: "201",
    responseSchema: "#/components/schemas/GoalRun",
    errorStatuses: ["400", "401", "402", "403", "404", "409", "422", "429", "500", "502", "503"],
  },
  {
    path: "/v1/goals/{goal_id}/runs/{goal_run_id}",
    method: "get",
    operationId: "getGoalRun",
    responseSchema: "#/components/schemas/GoalRun",
    errorStatuses: ["401", "403", "404", "429", "500", "502", "503"],
  },
  {
    path: "/calle/webhook",
    method: "post",
    operationId: "receiveWebhookEvent",
    requestSchema: "#/components/schemas/WebhookEvent",
    responseSchema: "#/components/schemas/WebhookAcknowledgement",
    errorStatuses: [],
  },
];

for (const operation of requiredOperations) {
  const endpoint = spec.paths?.[operation.path]?.[operation.method];
  assertContract(endpoint, `missing ${operation.method.toUpperCase()} ${operation.path}`);
  assertContract(
    endpoint.operationId === operation.operationId,
    `unexpected operationId for ${operation.method.toUpperCase()} ${operation.path}`,
  );
  assertContract(
    responseSchemaRef(operation.path, operation.method, operation.responseStatus) === operation.responseSchema,
    `unexpected ${operation.responseStatus ?? "200"} response schema for ${operation.method.toUpperCase()} ${operation.path}`,
  );

  if (operation.requestSchema) {
    assertContract(
      requestSchemaRef(operation.path, operation.method) === operation.requestSchema,
      `unexpected request schema for ${operation.method.toUpperCase()} ${operation.path}`,
    );
  }

  for (const status of operation.errorStatuses) {
    assertContract(
      endpoint.responses?.[status]?.$ref === "#/components/responses/ErrorResponse",
      `missing stable ${status} error response for ${operation.method.toUpperCase()} ${operation.path}`,
    );
  }
}

const webhookRefs = parameterRefs("/calle/webhook", "post");
assertContract(
  JSON.stringify(webhookRefs) === JSON.stringify(["#/components/parameters/WebhookEventId"]),
  "webhook endpoint must expose only the event id header",
);
assertContract(
  spec.components?.parameters?.WebhookTimestamp === undefined &&
    spec.components?.parameters?.WebhookSignature === undefined,
  "webhook contract must not expose legacy signature parameters",
);
assertContract(
  JSON.stringify(spec.paths?.["/calle/webhook"]?.post?.security) === "[]",
  "webhook endpoint must not require bearer auth",
);

const schemas = spec.components?.schemas ?? {};
for (const schemaName of [
  "CreateCallRequest",
  "CallTaskRecipientRequest",
  "CallStatus",
  "CompletionConfidence",
  "RecipientStatus",
  "AttemptStatus",
  "TranscriptSpeaker",
  "CallTranscriptTurn",
  "CallTaskAttempt",
  "CallTaskRecipient",
  "CallTask",
  "DeveloperEvent",
  "EventList",
  "WebhookEventType",
  "WebhookEvent",
  "WebhookCallData",
  "WebhookAcknowledgement",
  "GoalList",
  "Goal",
  "GoalPublishedRunSpec",
  "CreateGoalRunRequest",
  "GoalVariables",
  "GoalRun",
  "GoalRunSpecSnapshot",
  "GoalRunStatus",
  "GoalRunError",
  "ErrorEnvelope",
  "APIError",
]) {
  assertContract(schemas[schemaName], `missing schema ${schemaName}`);
}

const createCallProperties = schemas.CreateCallRequest?.properties ?? {};
for (const property of [
  "task",
  "recipients",
  "result_schema",
  "recipient_result_schema",
  "metadata",
  "webhook_url",
]) {
  assertContract(
    createCallProperties[property],
    `CreateCallRequest missing ${property}`,
  );
}
assertContract(
  JSON.stringify(schemas.CreateCallRequest?.required) === JSON.stringify(["task"]),
  "CreateCallRequest must require only task",
);

const callProperties = schemas.CallTask?.properties ?? {};
for (const property of [
  "id",
  "object",
  "status",
  "task",
  "recipients",
  "structured_result",
  "summary",
  "task_completed",
  "completion_confidence",
  "evidence",
  "metadata",
  "created_at",
  "completed_at",
]) {
  assertContract(callProperties[property], `CallTask missing ${property}`);
}

assertContract(!callProperties.result_validation, "CallTask must not expose result_validation");

const eventListDataRef = schemas.EventList?.properties?.data?.items?.$ref;
assertContract(
  eventListDataRef === "#/components/schemas/DeveloperEvent",
  "EventList.data must contain DeveloperEvent items",
);

const createGoalRunProperties = schemas.CreateGoalRunRequest?.properties ?? {};
assertContract(
  JSON.stringify(Object.keys(createGoalRunProperties).sort()) ===
    JSON.stringify(["phone", "variables"]),
  "CreateGoalRunRequest must contain only phone and variables",
);
assertContract(
  JSON.stringify(schemas.CreateGoalRunRequest?.required) === JSON.stringify(["phone"]),
  "CreateGoalRunRequest must require only phone",
);
assertContract(
  schemas.CreateGoalRunRequest?.additionalProperties === false,
  "CreateGoalRunRequest must reject unknown fields",
);

const goalProperties = schemas.Goal?.properties ?? {};
for (const property of ["id", "title", "description", "status", "published_run_spec"]) {
  assertContract(goalProperties[property], `Goal missing ${property}`);
}
for (const checksum of ["semantic_checksum", "input_schema_checksum", "result_schema_checksum"]) {
  assertContract(!goalProperties[checksum], `Goal must not expose ${checksum}`);
  assertContract(
    !schemas.GoalPublishedRunSpec?.properties?.[checksum],
    `GoalPublishedRunSpec must not expose ${checksum}`,
  );
}

const goalRunProperties = schemas.GoalRun?.properties ?? {};
for (const property of [
  "id",
  "goal_id",
  "run_id",
  "call_id",
  "run_spec",
  "status",
  "result",
  "error",
  "created_at",
  "completed_at",
]) {
  assertContract(goalRunProperties[property], `GoalRun missing ${property}`);
}
assertContract(
  JSON.stringify(goalRunProperties.call_id?.type?.slice().sort()) ===
    JSON.stringify(["null", "string"]),
  "GoalRun.call_id must be nullable string",
);

const goalRunParameterRefs = parameterRefs("/v1/goals/{goal_id}/runs", "post");
assertContract(
  goalRunParameterRefs.includes("#/components/parameters/GoalRunIdempotencyKey"),
  "create Goal Run must require the stable idempotency header",
);

console.log(`Verified CALL-E OpenAPI contract at ${specPath}.`);
