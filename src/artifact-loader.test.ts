import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adaptCliFieldCandidate,
  adaptExistingArtifactCandidate,
  loadCanonicalArtifact,
  loadCanonicalExistingArtifact,
  loadCanonicalJsonArtifact,
  loadCanonicalMarkdownArtifact,
  renderIssueArtifact,
  renderPullRequestArtifact,
} from "./artifact.js";
import { issueContractFixture, pullRequestContractFixture } from "./contract/fixtures.js";

const issueFields = {
  problem: "A useful problem statement",
  category: "feature",
  affected_areas: ["contracts"],
  acceptance: ["tests", "docs"],
};

const prFields = {
  summary: "A deterministic summary",
  linked_issue: "Closes #21",
  acceptance: ["tests"],
  scope: "Small and explicit",
};

test("Issue JSON and native Markdown candidates converge to identical canonical JSON", () => {
  const body = renderIssueArtifact(issueContractFixture, issueFields);
  const fromJson = loadCanonicalJsonArtifact(issueContractFixture, { fields: issueFields });
  const fromMarkdown = loadCanonicalMarkdownArtifact(issueContractFixture, body);

  assert.equal(fromJson.valid, true);
  assert.equal(fromMarkdown.valid, true);
  assert.deepEqual(fromMarkdown.canonicalJson, fromJson.canonicalJson);
  assert.equal(loadCanonicalExistingArtifact(issueContractFixture, body).candidate.source, "existing");
});

test("PR JSON and native Markdown candidates converge to identical canonical JSON", () => {
  const body = renderPullRequestArtifact(pullRequestContractFixture, prFields);
  const fromJson = loadCanonicalJsonArtifact(pullRequestContractFixture, prFields);
  const fromMarkdown = loadCanonicalMarkdownArtifact(pullRequestContractFixture, body);

  assert.equal(fromJson.valid, true);
  assert.equal(fromMarkdown.valid, true);
  assert.deepEqual(fromMarkdown.canonicalJson, fromJson.canonicalJson);
});

test("invalid candidate reload is bounded and preserves accepted fields", () => {
  const result = loadCanonicalArtifact(
    issueContractFixture,
    adaptCliFieldCandidate({ ...issueFields, category: "not-a-contract-value", secret: "do-not-echo" }),
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.canonical, {
    problem: issueFields.problem,
    affected_areas: issueFields.affected_areas,
    acceptance: issueFields.acceptance,
  });
  assert.deepEqual(
    result.invalidFields.map((field) => field.field),
    ["category", "secret"],
  );
  assert.equal(JSON.stringify(result.diagnostics).includes("do-not-echo"), false);
  assert.equal(adaptExistingArtifactCandidate(issueContractFixture, "not a template").parsed, false);
});
