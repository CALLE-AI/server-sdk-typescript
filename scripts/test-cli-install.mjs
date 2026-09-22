import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "calle CLI install "));
const windows = process.platform === "win32";
const mcpPackage = "@call-e/cli@0.5.0";
const oldSdkPackage = "@call-e/calle@0.7.0";
const environment = {
  ...process.env,
  CALLE_API_KEY: "",
  CALLE_BASE_URL: "",
  CALLE_TELEMETRY: "0",
  DO_NOT_TRACK: "1"
};

function findCommand(name) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const command = path.join(directory, `${name}${windows ? ".cmd" : ""}`);
    if (fs.existsSync(command)) return command;
  }
  throw new Error(`Cannot find ${name} on PATH`);
}

async function run(command, args, { cwd = root, env = {}, success = true } = {}) {
  const options = { cwd, env: { ...environment, ...env }, timeout: 120000, maxBuffer: 2 * 1024 * 1024 };
  if (windows && command.endsWith(".cmd")) {
    // .cmd shims need cmd.exe; reject expansion/quoting characters in this fixed test argv.
    for (const value of [command, ...args]) assert.doesNotMatch(value, /[%"\r\n]/u);
    args = ["/d", "/s", "/v:off", "/c", `"${[command, ...args].map((value) => `"${value}"`).join(" ")}"`];
    command = path.join(process.env.SystemRoot, "System32", "cmd.exe");
    options.windowsVerbatimArguments = true;
  }
  const result = await new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
  if (success) assert.equal(result.code, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

function makeInstallation(name, global) {
  const directory = path.join(temporaryRoot, `${global ? "global" : "local"} ${name}`);
  fs.mkdirSync(directory);
  if (!global) fs.writeFileSync(path.join(directory, "package.json"), '{"private":true}\n');
  return {
    directory,
    global,
    npmOptions: global ? ["--global", "--prefix", directory] : [],
    modules: path.join(directory, global && !windows ? "lib/node_modules" : "node_modules"),
    binaries: global ? path.join(directory, windows ? "" : "bin") : path.join(directory, "node_modules/.bin")
  };
}

function shim(installation, name) {
  return path.join(installation.binaries, `${name}${windows ? ".cmd" : ""}`);
}

function assertNoLegacyShim(installation) {
  for (const suffix of ["", ".cmd", ".ps1"]) {
    assert.throws(() => fs.lstatSync(path.join(installation.binaries, `calle${suffix}`)), { code: "ENOENT" });
  }
}

function assertSdkHelp(output, legacy = false) {
  for (const subcommand of ["calls create", "calls get", "goals run"]) {
    assert.ok(output.includes(`${legacy ? "calle" : "calle-api"} ${subcommand}`), `Unexpected SDK help:\n${output}`);
  }
  assert.equal(output.includes("auth login"), false);
}

function assertMcpHelp(output) {
  for (const subcommand of ["auth login", "call plan", "call recover"]) assert.ok(output.includes(subcommand));
  assert.equal(output.includes("calls create"), false);
}

async function verifyInstalled(installation, hasMcp, npx) {
  const sdk = path.join(installation.modules, "@call-e/calle");
  const manifest = JSON.parse(fs.readFileSync(path.join(sdk, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "calle-api": "./dist/cli.js" });
  assert.equal(manifest.license, "MIT");
  assert.equal(fs.readFileSync(path.join(sdk, "LICENSE"), "utf8"), fs.readFileSync(path.join(root, "LICENSE"), "utf8"));
  await run(process.execPath, ["--input-type=module", "--eval", [
    "import { CalleClient } from '@call-e/calle';",
    "const client = new CalleClient({ apiKey: 'install-smoke' });",
    "if (typeof client.goals.runAndWait !== 'function') process.exit(1);"
  ].join("\n")], { cwd: path.dirname(installation.modules) });
  assertSdkHelp((await run(shim(installation, "calle-api"), ["--help"])).stdout);
  if (hasMcp) assertMcpHelp((await run(shim(installation, "calle"), ["--help"])).stdout);
  else assertNoLegacyShim(installation);
  if (!installation.global) {
    for (const name of ["calle-api", "@call-e/calle"]) {
      assertSdkHelp((await run(npx, ["--offline", "--yes=false", "--", name, "--help"], { cwd: installation.directory })).stdout);
    }
    if (hasMcp) {
      assertMcpHelp((await run(npx, ["--offline", "--yes=false", "--", "@call-e/cli", "--help"], { cwd: installation.directory })).stdout);
    }
  }
}

async function verifyHttpRouting(installation, npx) {
  const sdkKey = "local-sdk-test-key";
  const mcpToken = "local-mcp-test-token";
  const sessionSecret = "local-session-secret";
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const call = { id: "call_install_test", object: "call_task", status: "completed", task: "Local test", recipients: [], metadata: {} };
  const requests = [];
  const failures = [];
  let baseUrl;
  const server = http.createServer(async (req, res) => {
    const reply = (payload, status = 200, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const pathname = new URL(req.url, baseUrl).pathname;
      if (req.method === "GET" && pathname === "/v1/calls/call_install_test") {
        assert.equal(req.headers.authorization, `Bearer ${sdkKey}`);
        requests.push("sdk:get");
        reply(call);
      } else if (req.method === "POST" && pathname === "/v1/calls") {
        assert.equal(req.headers.authorization, `Bearer ${sdkKey}`);
        assert.equal(req.headers["idempotency-key"], "local-create-idempotency");
        assert.deepEqual(body, { task: "Local create test", recipients: [{ phones: ["+15551234567"] }] });
        requests.push("sdk:create");
        reply(call);
      } else if (req.method === "POST" && pathname === "/v1/goals/goal_install_test/runs") {
        assert.equal(req.headers.authorization, `Bearer ${sdkKey}`);
        assert.equal(req.headers["idempotency-key"], "local-goal-idempotency");
        assert.deepEqual(body, { phone: "+15551234567", variables: {} });
        requests.push("sdk:goal");
        reply({ object: "goal_run", id: "goal_run_install_test", goal_id: "goal_install_test", status: "completed", run_spec: { id: "spec_test", version: 1 }, result: {}, error: null });
      } else if (req.method === "POST" && pathname === "/api/v1/openagent-auth/sessions") {
        assert.equal(body.server_url, `${baseUrl}/mcp/openagent_oauth`);
        assert.equal(body.auth_base_url, baseUrl);
        requests.push("mcp:login");
        reply({ session_id: "session-test", session_secret: sessionSecret, login_url: `${baseUrl}/login`, status: "PENDING", poll_after_ms: 1, expires_at: expiresAt }, 201);
      } else if (req.method === "GET" && pathname === "/api/v1/openagent-auth/sessions/session-test") {
        assert.equal(req.headers["x-openagent-session-secret"], sessionSecret);
        reply({ status: "AUTHORIZED", expires_at: expiresAt });
      } else if (req.method === "POST" && pathname === "/api/v1/openagent-auth/sessions/session-test/exchange") {
        assert.equal(req.headers["x-openagent-session-secret"], sessionSecret);
        reply({ token: { access_token: mcpToken }, expires_at: expiresAt });
      } else if (req.method === "POST" && pathname === "/mcp/openagent_oauth") {
        assert.equal(req.headers.authorization, `Bearer ${mcpToken}`);
        if (body.method === "initialize") {
          reply({ jsonrpc: "2.0", id: body.id, result: {} }, 200, { "mcp-session-id": "mcp-test" });
        } else {
          assert.equal(req.headers["mcp-session-id"], "mcp-test");
          if (body.method === "notifications/initialized") reply({});
          else if (body.method === "tools/list") reply({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "plan_call" }, { name: "run_call" }, { name: "get_call_run" }] } });
          else {
            assert.equal(body.method, "tools/call");
            assert.equal(body.params.name, "plan_call");
            assert.deepEqual(body.params.arguments, { to_phones: ["+15551234567"], goal: "Local routing test" });
            requests.push("mcp:plan");
            reply({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { plan_id: "local-plan", confirm_token: "local-confirm", ready_to_run: true } } });
          }
        }
      } else throw new Error(`Unexpected local request: ${req.method} ${pathname}`);
    } catch (error) {
      failures.push(error.message);
      reply({ error: "local_test_failure" }, 500);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = ["calls", "get", "call_install_test", "--base-url", baseUrl, "--api-key", sdkKey, "--json"];
    for (const result of [
      await run(shim(installation, "calle-api"), get),
      await run(npx, ["--yes=false", "--", "calle-api", ...get], { cwd: installation.directory })
    ]) assert.equal(JSON.parse(result.stdout).id, "call_install_test");
    for (const args of [
      ["calls", "create", "--phone", "+15551234567", "--task", "Local create test", "--idempotency-key", "local-create-idempotency"],
      ["goals", "run", "--goal-id", "goal_install_test", "--phone", "+15551234567", "--idempotency-key", "local-goal-idempotency"]
    ]) {
      const result = await run(npx, ["--yes=false", "--", "calle-api", ...args, "--base-url", baseUrl, "--api-key", sdkKey, "--json"], { cwd: installation.directory });
      assert.equal(JSON.parse(result.stdout).status, "completed");
    }
    const common = ["--base-url", baseUrl, "--cache-root", path.join(installation.directory, "auth cache"), "--no-telemetry"];
    const login = await run(shim(installation, "calle"), ["auth", "login", "--no-browser-open", ...common]);
    assert.equal(JSON.parse(login.stdout).status, "logged_in");
    const status = await run(shim(installation, "calle"), ["auth", "status", ...common]);
    assert.equal(JSON.parse(status.stdout).usable, true);
    const plan = await run(shim(installation, "calle"), ["call", "plan", "--to-phone", "+15551234567", "--goal", "Local routing test", ...common]);
    assert.equal(JSON.parse(plan.stdout).result.structuredContent.ready_to_run, true);
    assert.deepEqual(requests, ["sdk:get", "sdk:get", "sdk:create", "sdk:goal", "mcp:login", "mcp:plan"]);
    assert.deepEqual(failures, []);
    console.log("PASS localhost SDK get/create/goal and MCP login/plan use separate credentials and endpoints");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  const npm = findCommand("npm");
  const npx = findCommand("npx");
  for (const filename of ["dist/cli.js", "dist/index.js"]) assert.ok(fs.statSync(path.join(root, filename)).isFile());
  for (const filename of fs.readdirSync(root).filter((name) => /^call-e-calle-.*\.tgz$/u.test(name))) fs.rmSync(path.join(root, filename));
  const packed = JSON.parse((await run(npm, ["pack", "--json", "--ignore-scripts"])).stdout);
  assert.equal(packed.length, 1);
  assert.ok(packed[0].files.some((file) => file.path === "LICENSE"));
  assert.ok(packed[0].files.some((file) => file.path === "dist/cli.js"));
  const candidate = path.join(root, packed[0].filename);
  const install = (installation, spec, force = false) => run(npm, [
    "install", ...installation.npmOptions, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock",
    ...(force ? ["--force"] : []), spec
  ], { cwd: installation.directory });
  let httpInstallation;
  for (const global of [false, true]) {
    for (const scenario of ["upgrade-with-mcp", "sdk-first", "mcp-first", "sdk-upgrade"]) {
      const installation = makeInstallation(scenario, global);
      if (scenario === "upgrade-with-mcp") {
        await install(installation, oldSdkPackage);
        // Only the legacy global fixture needs --force to reproduce the shared bin.
        await install(installation, mcpPackage, global);
        assertMcpHelp((await run(shim(installation, "calle"), ["--help"])).stdout);
        await install(installation, candidate);
        const beforeRebuild = fs.existsSync(shim(installation, "calle")) ? "present" : "missing";
        console.log(`${global ? "global" : "local"} MCP shim after SDK-only upgrade: ${beforeRebuild}`);
        // This is the explicit migration step documented for an existing MCP installation.
        await run(npm, ["rebuild", ...installation.npmOptions, "--ignore-scripts", "@call-e/cli"], { cwd: installation.directory });
      } else if (scenario === "mcp-first") {
        await install(installation, mcpPackage);
        await install(installation, candidate);
      } else {
        if (scenario === "sdk-upgrade") {
          await install(installation, oldSdkPackage);
          assertSdkHelp((await run(shim(installation, "calle"), ["--help"])).stdout, true);
        }
        await install(installation, candidate);
        await verifyInstalled(installation, false, npx);
        await install(installation, mcpPackage);
      }
      await verifyInstalled(installation, true, npx);
      if (!global && scenario === "sdk-first") httpInstallation = installation;
      console.log(`PASS ${global ? "global" : "local"} ${scenario}: SDK calle-api, MCP calle, package import and help`);
    }
  }
  await verifyHttpRouting(httpInstallation, npx);
  const missing = makeInstallation("missing-package", false);
  const emptyCache = path.join(missing.directory, "empty npm cache");
  const missingResult = await run(npx, ["--offline", "--yes=false", "--", "calle-api", "--help"], {
    cwd: missing.directory, env: { npm_config_cache: emptyCache }, success: false
  });
  assert.notEqual(missingResult.code, 0);
  assert.equal(fs.existsSync(path.join(emptyCache, "_npx")), false);
  console.log("PASS npx --yes=false -- calle-api refuses a missing package with an empty offline cache");
  console.log(`PASS packed artifact: ${path.basename(candidate)}`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
