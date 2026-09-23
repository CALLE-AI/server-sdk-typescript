import assert from "node:assert/strict";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function compare(left, right) {
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

function parse(version) {
  const match = stableVersion.exec(version);
  if (!match) {
    throw new Error(`Invalid stable version: ${version}`);
  }
  return match.slice(1).map(BigInt);
}

const [candidate, current] = process.argv.slice(2);

try {
  if (candidate === "--self-test") {
    assert.equal(compare("0.7.1", "0.7.0"), 1);
    assert.equal(compare("1.0.0", "1.0.0"), 0);
    assert.equal(compare("2.0.0", "10.0.0"), -1);
    assert.equal(compare("100000000000000000000.0.0", "9.0.0"), 1);
    assert.throws(() => compare("1.0.0-beta.1", "1.0.0"));
  } else {
    if (!candidate || !current) {
      throw new Error("Usage: require-newer-stable-version <candidate> <current>");
    }
    if (compare(candidate, current) <= 0) {
      throw new Error(`Release version ${candidate} must be newer than npm latest ${current}.`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
