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
assertContract(spec.info?.version === "0.2.0", "unexpected API version");

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
for (const ref of [
  "#/components/parameters/WebhookEventId",
  "#/components/parameters/WebhookTimestamp",
  "#/components/parameters/WebhookSignature",
]) {
  assertContract(webhookRefs.includes(ref), `missing webhook parameter ${ref}`);
}
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

console.log(`Verified CALL-E OpenAPI contract at ${specPath}.`);
