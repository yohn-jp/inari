import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCanonicalMarkdownArtifact } from "./artifact.js";
import { issueContractFixture } from "./contract/fixtures.js";

test("unparseable Markdown yields diagnostics without canonical semantic state", () => {
  const result = loadCanonicalMarkdownArtifact(issueContractFixture, "not a governed template");

  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.canonical, {});
  assert.deepEqual(result.values, {});
  assert.equal(result.acceptedFields.length, 0);
  assert.equal(result.diagnostics.diagnostics.length > 0, true);
  assert.equal(result.diagnostics.diagnostics.length <= 32, true);
});
