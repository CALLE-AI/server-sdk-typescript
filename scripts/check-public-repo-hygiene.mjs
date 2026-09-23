import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedCalleRepositories = new Set([
  "awesome-phone-call-agents",
  "call-e-integrations",
  "calle-docs",
  "n8n-nodes-calle",
  "server-sdk-python",
  "server-sdk-typescript",
]);

const collaborationHosts = [
  "feishu.cn",
  "larksuite.com",
  "linear.app",
  "notion.site",
  "notion.so",
  "slack.com",
];

const findings = [];

function positionFor(text, index) {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function addFinding(location, text, index, type) {
  const position = positionFor(text, index);
  findings.push({ location, ...position, type });
}

function isHostOrSubdomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isGitLabHost(hostname) {
  return (
    hostname === "gitlab.com" ||
    hostname.startsWith("gitlab.") ||
    hostname.includes(".gitlab.")
  );
}

function isIpv4(hostname) {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function isLoopbackIpv4(hostname) {
  return hostname.startsWith("127.");
}

function scanText(location, text) {
  const urlPattern = /\bhttps?:\/\/[^\s<>{}\[\]"']+/giu;
  for (const match of text.matchAll(urlPattern)) {
    const candidate = match[0].replace(/[),.;:!?]+$/u, "");
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }

    const hostname = url.hostname.toLowerCase();
    if (isGitLabHost(hostname)) {
      addFinding(location, text, match.index, "gitlab-link");
    } else if (
      collaborationHosts.some((host) => isHostOrSubdomain(hostname, host))
    ) {
      addFinding(location, text, match.index, "internal-collaboration-link");
    }

    if (
      url.protocol === "http:" &&
      isIpv4(hostname) &&
      !isLoopbackIpv4(hostname)
    ) {
      addFinding(location, text, match.index, "raw-http-ip");
    }
  }

  const repositoryPattern = /\bCALLE-AI\/([A-Za-z0-9_.-]+)/giu;
  for (const match of text.matchAll(repositoryPattern)) {
    const repository = match[1].toLowerCase().replace(/\.git$/u, "");
    if (!allowedCalleRepositories.has(repository)) {
      addFinding(location, text, match.index, "unconfirmed-calle-repository");
    }
  }
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

for (const path of trackedFiles()) {
  scanText(`path ${path}`, path);
  const contents = readFileSync(path);
  if (contents.includes(0)) {
    continue;
  }
  scanText(path, contents.toString("utf8"));
}

if (process.env.PR_TITLE) {
  scanText("pull_request.title", process.env.PR_TITLE);
}

if (process.env.PR_BODY) {
  scanText("pull_request.body", process.env.PR_BODY);
}

if (findings.length > 0) {
  console.error("Public repository hygiene check failed:");
  for (const finding of findings) {
    console.error(
      `${JSON.stringify(finding.location)}:${finding.line}:${finding.column} ${finding.type}`,
    );
  }
  process.exit(1);
}

console.log("Public repository hygiene check passed.");
