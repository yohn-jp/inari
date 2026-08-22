import {
  assertSemanticInput,
  repairPartialSemanticInput,
  SemanticValidationError,
  validatePartialSemanticInput,
  validateSemanticInput,
  type PartialSemanticValidationResult,
  type PartialSemanticRepairResult,
  type SemanticValidationResult,
  type SemanticViolation,
} from "./contract/validation.js";
import {
  createArtifactDiagnostic,
  createArtifactDiagnosticReport,
  type ArtifactDiagnosticReport,
} from "./diagnostics.js";
import {
  assertCanonicalContract,
  type CanonicalContract,
  type CanonicalField,
  type ContractProvenance,
} from "./contract/ir.js";
import { type ValidatedRenderedIssueArtifact, type ValidatedRenderedPullRequestArtifact } from "./github/types.js";
import {
  createValidatedRenderedIssueArtifact,
  createValidatedRenderedPullRequestArtifact,
} from "./github/capability.js";

export interface ArtifactInputMetadata {
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
  readonly head?: string;
  readonly base?: string;
  readonly draft?: boolean;
  readonly maintainerCanModify?: boolean;
}

export interface ArtifactInputDocument {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly metadata: ArtifactInputMetadata;
}

/**
 * A representation-independent candidate entering the canonical contract.
 * Adapters may decode JSON, native Markdown, an existing GitHub body, or
 * internal field input, but they never validate or materialize contract
 * semantics themselves.
 */
export type ArtifactCandidateSource = "json" | "markdown" | "existing" | "fields";

export interface ArtifactCandidate {
  readonly fields: unknown;
  readonly metadata: ArtifactInputMetadata;
  readonly source: ArtifactCandidateSource;
}

export interface ArtifactCandidateAdapterResult {
  readonly parsed: boolean;
  readonly candidate?: ArtifactCandidate;
  readonly diagnostics: readonly ExistingArtifactDiagnostic[];
}

/** Result of the one candidate -> selected contract -> canonical JSON boundary. */
export interface CanonicalArtifactLoadResult {
  readonly valid: boolean;
  readonly complete: boolean;
  /** Canonical contract-shaped semantic JSON. Never contains rejected fields. */
  readonly canonical: Readonly<Record<string, unknown>>;
  /** Explicit alias for callers that name the output canonical JSON. */
  readonly canonicalJson: Readonly<Record<string, unknown>>;
  /** Backward-compatible semantic value name used by renderer callers. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly candidate: ArtifactCandidate;
  readonly acceptedFields: readonly string[];
  readonly missingFields: PartialSemanticValidationResult["missingFields"];
  readonly invalidFields: PartialSemanticValidationResult["invalidFields"];
  readonly diagnostics: ArtifactDiagnosticReport;
  readonly violations: readonly SemanticViolation[];
}

export interface ArtifactMetadataViolation {
  readonly code: "INPUT_METADATA_INVALID";
  readonly path: string;
  readonly message: string;
}

export type ArtifactInputErrorCode = "INPUT_DOCUMENT_INVALID" | "INPUT_METADATA_INVALID";

export class ArtifactInputError extends Error {
  readonly code: ArtifactInputErrorCode;
  readonly path: string;

  constructor(code: ArtifactInputErrorCode, message: string, path = "$") {
    super(message);
    this.name = "ArtifactInputError";
    this.code = code;
    this.path = path;
  }
}

export type ArtifactPreparationErrorCode = "ARTIFACT_PROVENANCE_MISSING" | "ARTIFACT_ROUND_TRIP_INVALID";

export type ArtifactRoundTripDiagnosticCode = "ROUND_TRIP_PARSE" | "ROUND_TRIP_SEMANTIC" | "ROUND_TRIP_MISMATCH";

export interface ArtifactRoundTripDiagnostic {
  readonly code: ArtifactRoundTripDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

/** Stable failures raised before a mutation-capable artifact is created. */
export class ArtifactPreparationError extends Error {
  readonly code: ArtifactPreparationErrorCode;
  readonly diagnostics: readonly ArtifactRoundTripDiagnostic[];

  constructor(
    code: ArtifactPreparationErrorCode,
    message: string,
    diagnostics: readonly ArtifactRoundTripDiagnostic[] = [],
  ) {
    super(message);
    this.name = "ArtifactPreparationError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export interface PreparedIssueArtifact {
  readonly input: ArtifactInputDocument;
  readonly validation: SemanticValidationResult;
  readonly artifact: ValidatedRenderedIssueArtifact;
}

export interface PreparedPullRequestArtifact {
  readonly input: ArtifactInputDocument;
  readonly validation: SemanticValidationResult;
  readonly artifact: ValidatedRenderedPullRequestArtifact;
}

export type ExistingArtifactClassification = "valid" | "semantic" | "wrong-template" | "unparseable" | "ambiguous";

export type ExistingArtifactDiagnosticCode =
  | "EXISTING_WRONG_TEMPLATE"
  | "EXISTING_UNPARSEABLE"
  | "EXISTING_EXTRA_CONTENT"
  | "EXISTING_UNKNOWN_CHECKLIST_ITEM"
  | "EXISTING_AMBIGUOUS_TEMPLATE"
  | "EXISTING_NON_CANONICAL"
  | "EXISTING_TEMPLATE_COMPILE_FAILED";

export interface ExistingArtifactDiagnostic {
  readonly code: ExistingArtifactDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ExistingArtifactParseResult {
  readonly parsed: boolean;
  readonly values: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly ExistingArtifactDiagnostic[];
}

export interface ExistingArtifactValidationResult {
  readonly valid: boolean;
  readonly classification: ExistingArtifactClassification;
  readonly parse: ExistingArtifactParseResult;
  readonly violations: readonly ExistingArtifactDiagnostic[] | readonly SemanticViolation[];
  /** Template paths tried against a multi-candidate match that produced no single parse. */
  readonly attemptedTemplates?: readonly string[];
}

export interface ExistingIssueReader {
  getIssue(issueNumber: number): Promise<{ readonly body: string | null; readonly url: string }>;
}

export interface ExistingPullRequestReader {
  getPullRequest(pullRequestNumber: number): Promise<{ readonly body: string | null; readonly url: string }>;
}

const GITHUB_NO_RESPONSE = "_No response_";

export interface FetchedExistingArtifact {
  readonly number: number;
  readonly url: string;
  readonly result: ExistingArtifactValidationResult;
}

/** Parse the documented JSON input envelope while keeping field semantics adapter-independent. */
export function parseArtifactInputDocument(input: unknown): ArtifactInputDocument {
  if (!isRecord(input)) throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "Input must be a JSON object.");
  const metadataKeys = ["title", "labels", "assignees", "head", "base", "draft", "maintainerCanModify"];
  if (Object.prototype.hasOwnProperty.call(input, "fields")) {
    if (!isRecord(input.fields))
      throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "fields must be an object.", "$.fields");
    const metadata: Record<string, unknown> = {};
    for (const key of metadataKeys) {
      if (input[key] !== undefined) metadata[key] = input[key];
    }
    const unknown = Object.keys(input).filter(
      (key) => key !== "fields" && !Object.prototype.hasOwnProperty.call(metadata, key),
    );
    if (unknown.length > 0)
      throw new ArtifactInputError(
        "INPUT_DOCUMENT_INVALID",
        `Unknown input property "${unknown[0]}".`,
        `$.${unknown[0]}`,
      );
    return { fields: input.fields, metadata: parseMetadata(metadata) };
  }
  const reservedInBare = Object.keys(input).find((key) => metadataKeys.includes(key));
  if (reservedInBare !== undefined) {
    throw new ArtifactInputError(
      "INPUT_DOCUMENT_INVALID",
      `Reserved metadata key "${reservedInBare}" cannot appear without a fields property.`,
      `$.${reservedInBare}`,
    );
  }
  return { fields: input, metadata: {} };
}

/** Adapt a parsed JSON envelope without granting it canonical status. */
export function adaptJsonArtifactCandidate(input: unknown): ArtifactCandidate {
  const document = parseArtifactInputDocument(input);
  return { ...document, source: "json" };
}

/** Adapt internal structured fields to the same candidate shape as JSON. */
export function adaptFieldArtifactCandidate(fields: unknown, metadata: ArtifactInputMetadata = {}): ArtifactCandidate {
  if (!isRecord(fields)) {
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "Candidate fields must be an object.", "$.fields");
  }
  return { fields, metadata, source: "fields" };
}

/** Alias used by command adapters that call this input the CLI field path. */
export const adaptCliFieldCandidate = adaptFieldArtifactCandidate;

/** Generic adapter spelling for callers that already hold structured fields. */
export const adaptArtifactCandidate = adaptFieldArtifactCandidate;

/** Adapt an existing native artifact body through the repository parser. */
export function adaptMarkdownArtifactCandidate(
  contractInput: unknown,
  body: string | null | undefined,
): ArtifactCandidateAdapterResult {
  assertCanonicalContract(contractInput);
  const contract = contractInput;
  const parse =
    contract.artifactKind === "issue"
      ? parseExistingIssueArtifact(contract, body)
      : parseExistingPullRequestArtifact(contract, body);
  if (!parse.parsed) return { parsed: false, diagnostics: parse.diagnostics };
  return {
    parsed: true,
    candidate: { fields: parse.values, metadata: {}, source: "markdown" },
    diagnostics: parse.diagnostics,
  };
}

/** Existing GitHub bodies use the same native Markdown adapter by design. */
export function adaptExistingArtifactCandidate(
  contractInput: unknown,
  body: string | null | undefined,
): ArtifactCandidateAdapterResult {
  const adapted = adaptMarkdownArtifactCandidate(contractInput, body);
  return adapted.candidate === undefined
    ? adapted
    : { ...adapted, candidate: { ...adapted.candidate, source: "existing" } };
}

/**
 * Reload a candidate against the selected canonical contract.  Complete input
 * takes the normal one-pass validator (and therefore may materialize contract
 * defaults); incomplete/invalid input uses the bounded partial contract and
 * exposes only accepted semantic values.
 */
export function loadCanonicalArtifact(contractInput: unknown, candidateInput: unknown): CanonicalArtifactLoadResult {
  assertCanonicalContract(contractInput);
  const candidate = normalizeArtifactCandidate(candidateInput);
  const validation = validateSemanticInput(contractInput, candidate.fields);
  if (validation.valid) {
    const acceptedFields = Object.keys(validation.values)
      .sort(compareStrings)
      .map((field) => `$.fields.${field}`);
    const diagnostics = createArtifactDiagnosticReport([], acceptedFields);
    return {
      valid: true,
      complete: true,
      canonical: validation.values,
      canonicalJson: validation.values,
      values: validation.values,
      candidate,
      acceptedFields,
      missingFields: [],
      invalidFields: [],
      diagnostics,
      violations: [],
    };
  }

  const partial = validatePartialSemanticInput(contractInput, candidate.fields);
  return {
    valid: false,
    complete: false,
    canonical: partial.values,
    canonicalJson: partial.values,
    values: partial.values,
    candidate,
    acceptedFields: partial.acceptedFields,
    missingFields: partial.missingFields,
    invalidFields: partial.invalidFields,
    diagnostics: partial.diagnostics,
    violations: validation.violations,
  };
}

/** Explicitly named alias for callers that pass a candidate object. */
export const loadCanonicalCandidate = loadCanonicalArtifact;

/** Load a JSON representation through the canonical contract boundary. */
export function loadCanonicalJsonArtifact(contractInput: unknown, input: unknown): CanonicalArtifactLoadResult {
  return loadCanonicalArtifact(contractInput, adaptJsonArtifactCandidate(input));
}

/** Load native Markdown through the same parser and canonical contract. */
export function loadCanonicalMarkdownArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): CanonicalArtifactLoadResult {
  const adapted = adaptMarkdownArtifactCandidate(contractInput, body);
  if (!adapted.parsed || adapted.candidate === undefined) {
    const candidate: ArtifactCandidate = { fields: {}, metadata: {}, source: "markdown" };
    const diagnostics = markdownDiagnostics(adapted.diagnostics);
    return {
      valid: false,
      complete: false,
      canonical: {},
      canonicalJson: {},
      values: {},
      candidate,
      acceptedFields: [],
      missingFields: [],
      invalidFields: [],
      diagnostics,
      violations: [],
    };
  }
  return loadCanonicalArtifact(contractInput, adapted.candidate);
}

/** Existing-body spelling retained so read/repair callers share one boundary. */
export function loadCanonicalExistingArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): CanonicalArtifactLoadResult {
  const adapted = adaptExistingArtifactCandidate(contractInput, body);
  if (!adapted.parsed || adapted.candidate === undefined) {
    const candidate: ArtifactCandidate = { fields: {}, metadata: {}, source: "existing" };
    const diagnostics = markdownDiagnostics(adapted.diagnostics);
    return {
      valid: false,
      complete: false,
      canonical: {},
      canonicalJson: {},
      values: {},
      candidate,
      acceptedFields: [],
      missingFields: [],
      invalidFields: [],
      diagnostics,
      violations: [],
    };
  }
  return loadCanonicalArtifact(contractInput, adapted.candidate);
}

function normalizeArtifactCandidate(input: unknown): ArtifactCandidate {
  if (isArtifactCandidate(input)) return input;
  if (isRecord(input) && input.parsed === true && isArtifactCandidate(input.candidate)) return input.candidate;
  if (isArtifactInputDocument(input)) return { ...input, source: "json" };
  return adaptJsonArtifactCandidate(input);
}

function isArtifactCandidate(input: unknown): input is ArtifactCandidate {
  return (
    isRecord(input) &&
    (input.source === "json" ||
      input.source === "markdown" ||
      input.source === "existing" ||
      input.source === "fields") &&
    Object.prototype.hasOwnProperty.call(input, "fields") &&
    isRecord(input.metadata)
  );
}

function isArtifactInputDocument(input: unknown): input is ArtifactInputDocument {
  return isRecord(input) && Object.prototype.hasOwnProperty.call(input, "fields") && isRecord(input.metadata);
}

function markdownDiagnostics(diagnostics: readonly ExistingArtifactDiagnostic[]): ArtifactDiagnosticReport {
  const projected = diagnostics.slice(0, 32).map((diagnostic) =>
    createArtifactDiagnostic({
      state: "unsupported",
      code: "FIELD_UNSUPPORTED",
      detailCode: diagnostic.code === "EXISTING_AMBIGUOUS_TEMPLATE" ? "TEMPLATE_AMBIGUOUS" : "TEMPLATE_UNPARSEABLE",
      reason: "unsupported",
      path: diagnostic.path,
      message: diagnostic.message,
      recovery: [
        {
          action: diagnostic.code === "EXISTING_AMBIGUOUS_TEMPLATE" ? "select-template" : "retry",
          path: diagnostic.path,
        },
      ],
    }),
  );
  return createArtifactDiagnosticReport(projected, []);
}

/** Classify an artifact input envelope without applying semantic defaults. */
export function validatePartialArtifactInput(contractInput: unknown, input: unknown): PartialSemanticValidationResult {
  assertCanonicalContract(contractInput);
  return validatePartialSemanticInput(contractInput, parseArtifactInputDocument(input).fields);
}

/** Terminology alias for callers that treat validation as classification. */
export const classifyPartialArtifactInput = validatePartialArtifactInput;

/** Merge only a targeted field patch into a prior stateless partial result. */
export function repairPartialArtifactInput(
  contractInput: unknown,
  previous: unknown,
  patch?: unknown,
): PartialSemanticRepairResult {
  assertCanonicalContract(contractInput);
  return repairPartialSemanticInput(contractInput, previous, patch);
}

/** Terminology alias for callers that describe targeted repair as a merge. */
export const mergePartialArtifactInput = repairPartialArtifactInput;

export function renderIssueArtifact(contractInput: unknown, input: unknown): string {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "issue")
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "An Issue contract is required.");
  const loaded = loadCanonicalArtifact(contractInput, input);
  if (!loaded.valid) throw new SemanticValidationError(loaded.violations);
  return renderIssueBody(contractInput, loaded.canonical);
}

export function renderPullRequestArtifact(contractInput: unknown, input: unknown): string {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "pull_request") {
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "A pull request contract is required.");
  }
  const loaded = loadCanonicalArtifact(contractInput, input);
  if (!loaded.valid) throw new SemanticValidationError(loaded.violations);
  return renderPullRequestBody(contractInput, loaded.canonical);
}

/** Construct the only values accepted by the GitHub mutation adapter. */
export function prepareIssueArtifact(contractInput: unknown, input: ArtifactInputDocument): PreparedIssueArtifact {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "issue")
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "An Issue contract is required.");
  requireTrustedProvenance(contractInput);
  const loaded = loadCanonicalArtifact(contractInput, input);
  if (!loaded.valid) throw new SemanticValidationError(loaded.violations);
  const title = requiredMetadataString(input.metadata.title ?? contractInput.nativeMetadata.title, "title");
  const labels = mergeIssueLabels(contractInput.nativeMetadata.labels, input.metadata.labels);
  const body = renderIssueBody(contractInput, loaded.canonical);
  verifyRenderedRoundTrip(contractInput, loaded.canonical, body, "issue");
  const artifact = createValidatedRenderedIssueArtifact({
    kind: "issue",
    title,
    body,
    provenance: contractInput.provenance,
    ...(labels === undefined ? {} : { labels }),
    ...(input.metadata.assignees === undefined ? {} : { assignees: input.metadata.assignees }),
  });
  return { input, validation: semanticValidationFromLoad(loaded), artifact };
}

export function preparePullRequestArtifact(
  contractInput: unknown,
  input: ArtifactInputDocument,
): PreparedPullRequestArtifact {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "pull_request") {
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "A pull request contract is required.");
  }
  requireTrustedProvenance(contractInput);
  const loaded = loadCanonicalArtifact(contractInput, input);
  if (!loaded.valid) throw new SemanticValidationError(loaded.violations);
  const title = requiredMetadataString(input.metadata.title, "title");
  const head = requiredMetadataString(input.metadata.head, "head");
  const base = requiredMetadataString(input.metadata.base, "base");
  const body = renderPullRequestBody(contractInput, loaded.canonical);
  verifyRenderedRoundTrip(contractInput, loaded.canonical, body, "pull_request");
  const artifact = createValidatedRenderedPullRequestArtifact({
    kind: "pull_request",
    title,
    body,
    provenance: contractInput.provenance,
    head,
    base,
    ...(input.metadata.draft === undefined ? {} : { draft: input.metadata.draft }),
    ...(input.metadata.maintainerCanModify === undefined
      ? {}
      : { maintainerCanModify: input.metadata.maintainerCanModify }),
  });
  return { input, validation: semanticValidationFromLoad(loaded), artifact };
}

export function parseExistingIssueArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): ExistingArtifactParseResult {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "issue")
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "An Issue contract is required.");
  return parseRenderedBody(contractInput, body ?? "", 3, false);
}

export function parseExistingPullRequestArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): ExistingArtifactParseResult {
  assertCanonicalContract(contractInput);
  if (contractInput.artifactKind !== "pull_request") {
    throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", "A pull request contract is required.");
  }
  return parseRenderedBody(contractInput, body ?? "", undefined, true);
}

export function validateExistingIssueArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): ExistingArtifactValidationResult {
  assertCanonicalContract(contractInput);
  const parse = parseExistingIssueArtifact(contractInput, body);
  return validateParsedArtifact(contractInput, parse);
}

export function validateExistingPullRequestArtifact(
  contractInput: unknown,
  body: string | null | undefined,
): ExistingArtifactValidationResult {
  assertCanonicalContract(contractInput);
  const parse = parseExistingPullRequestArtifact(contractInput, body);
  return validateParsedArtifact(contractInput, parse);
}

export interface ExistingArtifactCandidate {
  readonly contract: CanonicalContract;
  readonly result: ExistingArtifactValidationResult;
}

export interface ExistingArtifactSelection {
  readonly contract?: CanonicalContract;
  readonly result: ExistingArtifactValidationResult;
}

export interface ExistingArtifactProjection {
  readonly valid: boolean;
  readonly projection: "canonical" | "unavailable";
  readonly classification: ExistingArtifactClassification;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly ExistingArtifactDiagnostic[];
  readonly violations?: readonly SemanticViolation[];
  readonly attemptedTemplates?: readonly string[];
}

/** Project only validated semantic values; invalid artifacts never expose parsed fields. */
export function projectExistingArtifact(result: ExistingArtifactValidationResult): ExistingArtifactProjection {
  return {
    valid: result.valid,
    projection: result.valid ? "canonical" : "unavailable",
    classification: result.classification,
    ...(result.valid ? { fields: result.parse.values } : {}),
    diagnostics: result.parse.diagnostics,
    ...(result.classification === "semantic" ? { violations: result.violations as readonly SemanticViolation[] } : {}),
    ...(result.attemptedTemplates === undefined ? {} : { attemptedTemplates: result.attemptedTemplates }),
  };
}

/** Select a uniquely parsed governed artifact, failing closed on ambiguity. */
export function selectExistingArtifactCandidate(
  candidates: readonly ExistingArtifactCandidate[],
): ExistingArtifactSelection {
  const parsed = candidates.filter((candidate) => candidate.result.parse.parsed);
  if (parsed.length === 1) {
    const selected = parsed[0] as ExistingArtifactCandidate;
    return selected;
  }
  if (parsed.length > 1) {
    const paths = parsed.map((candidate) => candidate.contract.templateIdentity.path).sort(compareStrings);
    const diagnostic: ExistingArtifactDiagnostic = {
      code: "EXISTING_AMBIGUOUS_TEMPLATE",
      path: "$.template",
      message: `Artifact structure matches multiple repository-native templates: ${paths.join(", ")}.`,
    };
    return {
      result: {
        valid: false,
        classification: "ambiguous",
        parse: { parsed: false, values: {}, diagnostics: [diagnostic] },
        violations: [diagnostic],
      },
    };
  }

  const attemptedTemplates = candidates
    .map((candidate) => candidate.contract.templateIdentity.path)
    .sort(compareStrings);
  const classification = candidates.some((candidate) =>
    candidate.result.parse.diagnostics.some((diagnostic) => diagnostic.code === "EXISTING_WRONG_TEMPLATE"),
  )
    ? "wrong-template"
    : "unparseable";
  const diagnostic: ExistingArtifactDiagnostic = {
    code: classification === "wrong-template" ? "EXISTING_WRONG_TEMPLATE" : "EXISTING_UNPARSEABLE",
    path: "$.template",
    message:
      classification === "wrong-template"
        ? `Artifact structure does not match any repository-native template. Tried: ${attemptedTemplates.join(", ")}.`
        : `Artifact could not be parsed against any repository-native template. Tried: ${attemptedTemplates.join(", ")}.`,
  };
  return {
    result: {
      valid: false,
      classification,
      parse: { parsed: false, values: {}, diagnostics: [diagnostic] },
      violations: [diagnostic],
      attemptedTemplates,
    },
  };
}

/** Validate the same required string metadata enforced by mutation preparation. */
export function validateRequiredMetadataString(value: unknown, key: string): ArtifactMetadataViolation | undefined {
  if (typeof value === "string" && value.trim().length > 0) return undefined;
  return {
    code: "INPUT_METADATA_INVALID",
    path: `$.${key}`,
    message: `${key} must be a non-empty string.`,
  };
}

export async function validateExistingIssueFromAdapter(
  reader: ExistingIssueReader,
  contract: unknown,
  issueNumber: number,
): Promise<FetchedExistingArtifact> {
  const issue = await reader.getIssue(issueNumber);
  return { number: issueNumber, url: issue.url, result: validateExistingIssueArtifact(contract, issue.body) };
}

export async function validateExistingPullRequestFromAdapter(
  reader: ExistingPullRequestReader,
  contract: unknown,
  pullRequestNumber: number,
): Promise<FetchedExistingArtifact> {
  const pullRequest = await reader.getPullRequest(pullRequestNumber);
  return {
    number: pullRequestNumber,
    url: pullRequest.url,
    result: validateExistingPullRequestArtifact(contract, pullRequest.body),
  };
}

function validateParsedArtifact(
  contract: CanonicalContract,
  parse: ExistingArtifactParseResult,
): ExistingArtifactValidationResult {
  if (!parse.parsed) {
    const classification = parse.diagnostics.some((diagnostic) => diagnostic.code === "EXISTING_WRONG_TEMPLATE")
      ? "wrong-template"
      : "unparseable";
    return { valid: false, classification, parse, violations: parse.diagnostics };
  }
  const semantic = loadCanonicalArtifact(contract, {
    fields: parse.values,
    metadata: {},
    source: "existing",
  });
  return {
    valid: semantic.valid,
    classification: semantic.valid ? "valid" : "semantic",
    parse,
    violations: semantic.violations,
  };
}

function requireTrustedProvenance(
  contract: CanonicalContract,
): asserts contract is CanonicalContract & { readonly provenance: ContractProvenance } {
  if (contract.provenance === undefined) {
    throw new ArtifactPreparationError(
      "ARTIFACT_PROVENANCE_MISSING",
      "Mutation preparation requires a contract bound to trusted repository governance.",
      [
        {
          code: "ROUND_TRIP_PARSE",
          path: "$.provenance",
          message: "The compiled contract has no trusted repository/ref provenance.",
        },
      ],
    );
  }
}

function verifyRenderedRoundTrip(
  contract: CanonicalContract,
  expectedValues: Readonly<Record<string, unknown>>,
  body: string,
  kind: "issue" | "pull_request",
): void {
  const parsed =
    kind === "issue" ? parseExistingIssueArtifact(contract, body) : parseExistingPullRequestArtifact(contract, body);
  if (!parsed.parsed) {
    throw new ArtifactPreparationError(
      "ARTIFACT_ROUND_TRIP_INVALID",
      `Rendered ${kind} artifact did not reparse under the compiled contract.`,
      parsed.diagnostics.map((diagnostic) => ({
        code: "ROUND_TRIP_PARSE" as const,
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    );
  }

  const reconstructed = validateSemanticInput(contract, parsed.values);
  if (!reconstructed.valid) {
    throw new ArtifactPreparationError(
      "ARTIFACT_ROUND_TRIP_INVALID",
      `Rendered ${kind} artifact failed semantic validation after reparsing.`,
      reconstructed.violations.map((violation) => ({
        code: "ROUND_TRIP_SEMANTIC" as const,
        path: violation.path,
        message: violation.message,
      })),
    );
  }

  const mismatches = compareMaterializedValues(expectedValues, reconstructed.values);
  if (mismatches.length > 0) {
    throw new ArtifactPreparationError(
      "ARTIFACT_ROUND_TRIP_INVALID",
      `Rendered ${kind} artifact did not preserve its validated semantic values.`,
      mismatches,
    );
  }
}

function compareMaterializedValues(
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
): readonly ArtifactRoundTripDiagnostic[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort(compareStrings);
  const diagnostics: ArtifactRoundTripDiagnostic[] = [];
  for (const key of keys) {
    const expectedPresent = Object.prototype.hasOwnProperty.call(expected, key);
    const actualPresent = Object.prototype.hasOwnProperty.call(actual, key);
    const path = `$.${key}`;
    if (!expectedPresent || !actualPresent) {
      diagnostics.push({
        code: "ROUND_TRIP_MISMATCH",
        path,
        message: "Rendered artifact changed whether a semantic field was materialized.",
        ...(expectedPresent ? { expected: expected[key] } : {}),
        ...(actualPresent ? { actual: actual[key] } : {}),
      });
      continue;
    }
    if (stableValue(expected[key]) !== stableValue(actual[key])) {
      diagnostics.push({
        code: "ROUND_TRIP_MISMATCH",
        path,
        message: "Rendered artifact changed a materialized semantic value.",
        expected: expected[key],
        actual: actual[key],
      });
    }
  }
  return diagnostics;
}

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableValue(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`)
    .join(",")}}`;
}

function renderIssueBody(contract: CanonicalContract, values: Readonly<Record<string, unknown>>): string {
  const blocks: string[] = [];
  for (let sectionIndex = 0; sectionIndex < contract.sections.length; sectionIndex += 1) {
    const section = contract.sections[sectionIndex] as CanonicalContract["sections"][number];
    if (section.kind === "documentation") {
      // GitHub renders Issue Form markdown in the form only; it is not part of
      // the submitted Issue body. The content remains in the contract for
      // schema/explain and native-source traceability.
      continue;
    }
    const title = section.title ?? section.fields[0]?.label;
    if (title === undefined) continue;
    const body = section.fields
      .map((field) => renderFieldValue(field, values[field.id], "issue"))
      .filter(Boolean)
      .join("\n\n");
    blocks.push([`### ${escapeHeading(title)}`, body].filter((part) => part.length > 0).join("\n\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

function renderPullRequestBody(contract: CanonicalContract, values: Readonly<Record<string, unknown>>): string {
  const blocks: string[] = [];
  for (let sectionIndex = 0; sectionIndex < contract.sections.length; sectionIndex += 1) {
    const section = contract.sections[sectionIndex] as CanonicalContract["sections"][number];
    if (section.kind === "documentation") {
      const content = trimBlankLines(section.content ?? "");
      if (content !== undefined)
        blocks.push(section.title === undefined ? content : renderDocumentation(section, content));
      continue;
    }
    const title = section.title ?? section.fields[0]?.label;
    const level = section.render.headingLevel ?? section.nativeMetadata.headingLevel;
    if (title === undefined || level === undefined)
      throw new ArtifactInputError("INPUT_DOCUMENT_INVALID", `PR section "${section.id}" has no heading identity.`);
    const rendered = section.fields
      .map((field) => renderFieldValue(field, values[field.id], "pull_request"))
      .filter(Boolean);
    blocks.push([`${"#".repeat(level)} ${escapeHeading(title)}`, ...rendered].join("\n\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

function renderDocumentation(section: CanonicalContract["sections"][number], content: string): string {
  const level = section.render.headingLevel ?? section.nativeMetadata.headingLevel;
  if (section.title === undefined || level === undefined) return content;
  return [`${"#".repeat(level)} ${escapeHeading(section.title)}`, content].join("\n\n");
}

function renderFieldValue(field: CanonicalField, value: unknown, kind: "issue" | "pull_request"): string {
  if (field.type === "string" || field.type === "enum") {
    if (typeof value === "string" && (kind !== "issue" || value.trim().length > 0)) {
      const renderedValue = kind === "issue" ? issueNativeValue(field, value) : value;
      return field.nativeMetadata.render === undefined
        ? escapeMarkdownValue(renderedValue)
        : renderCodeBlock(renderedValue, field.nativeMetadata.render);
    }
    if (kind === "pull_request") return field.nativeMetadata.placeholder ?? "";
    return field.nativeMetadata.render === undefined
      ? GITHUB_NO_RESPONSE
      : renderCodeBlock("", field.nativeMetadata.render);
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) return kind === "issue" ? GITHUB_NO_RESPONSE : "";
    if (value.length === 0) return kind === "issue" ? GITHUB_NO_RESPONSE : "";
    const renderedValues =
      kind === "issue"
        ? value.map((entry) => (typeof entry === "string" ? issueNativeValue(field, entry) : String(entry)))
        : value.map((entry) => String(entry));
    if (field.nativeMetadata.multiple === true)
      return renderedValues.map((entry) => escapeMarkdownValue(entry)).join(", ");
    return renderedValues.map((entry) => `- ${escapeMarkdownValue(entry)}`).join("\n");
  }
  const selected = new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
  );
  const placeholder = kind === "pull_request" ? field.nativeMetadata.placeholder : undefined;
  const lines = field.items.map(
    (item) => `- [${selected.has(item.id) ? "x" : " "}] ${escapeMarkdownValue(item.label)}`,
  );
  return [placeholder === undefined ? "" : placeholder, lines.join("\n")].filter(Boolean).join("\n\n");
}

/** Map canonical Issue semantic values to the labels shown by GitHub Issue Forms. */
function issueNativeValue(field: CanonicalField, value: string): string {
  if (field.type === "enum") return field.options.find((option) => option.value === value)?.label ?? value;
  if (field.type === "array") return field.items.options?.find((option) => option.value === value)?.label ?? value;
  return value;
}

/** Map GitHub Issue Form labels back to canonical semantic values. */
function issueSemanticValue(field: CanonicalField, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (field.type === "enum") return field.options.find((option) => option.label === value)?.value ?? value;
  if (field.type === "array") return field.items.options?.find((option) => option.label === value)?.value ?? value;
  return value;
}

function parseRenderedBody(
  contract: CanonicalContract,
  body: string,
  issueHeadingLevel: number | undefined,
  stripComments: boolean,
): ExistingArtifactParseResult {
  const source = normalizeSource(stripComments ? removeHtmlComments(body) : body);
  const lines = source.split("\n");
  const values: Record<string, unknown> = {};
  const diagnostics: ExistingArtifactDiagnostic[] = [];
  let cursor = 0;

  for (let sectionIndex = 0; sectionIndex < contract.sections.length; sectionIndex += 1) {
    const section = contract.sections[sectionIndex] as CanonicalContract["sections"][number];
    while (lines[cursor] !== undefined && lines[cursor]?.trim().length === 0) cursor += 1;
    if (section.kind === "documentation") {
      if (issueHeadingLevel !== undefined) continue;
      const expected = trimBlankLines(
        stripComments ? removeHtmlComments(section.content ?? "") : (section.content ?? ""),
      );
      if (expected !== undefined) {
        const expectedLines = expected.split("\n");
        if (!sameLines(lines.slice(cursor, cursor + expectedLines.length), expectedLines)) {
          diagnostics.push({
            code: "EXISTING_UNPARSEABLE",
            path: `$.sections.${section.id}`,
            message: "Documentation structure does not match the native template.",
          });
          return { parsed: false, values: {}, diagnostics };
        }
        cursor += expectedLines.length;
      }
      continue;
    }
    const expectedTitle = section.title ?? section.fields[0]?.label;
    const field = section.fields[0];
    if (expectedTitle === undefined || field === undefined) continue;
    const heading = lines[cursor];
    const level = issueHeadingLevel ?? section.render.headingLevel ?? section.nativeMetadata.headingLevel;
    const expectedHeading = `${"#".repeat(level ?? 3)} ${escapeHeading(expectedTitle)}`;
    if (heading?.trim() !== expectedHeading) {
      const hasHeading = lines.some((line) => isHeading(line));
      diagnostics.push({
        code: hasHeading ? "EXISTING_WRONG_TEMPLATE" : "EXISTING_UNPARSEABLE",
        path: `$.sections.${section.id}`,
        message: `Expected native section heading "${expectedHeading}".`,
      });
      return { parsed: false, values: {}, diagnostics };
    }
    cursor += 1;
    const contentStart = cursor;
    const nextIssueHeading = issueHeadingLevel === undefined ? undefined : findNextIssueHeading(contract, sectionIndex);
    let openFence: string | undefined;
    while (cursor < lines.length) {
      const line = lines[cursor] ?? "";
      const fenceMatch = /^(`{3,})/u.exec(line);
      if (openFence === undefined) {
        if (
          nextIssueHeading === undefined
            ? issueHeadingLevel === undefined && isHeading(line)
            : line.trim() === nextIssueHeading
        )
          break;
        if (fenceMatch !== null) openFence = fenceMatch[1];
      } else if (fenceMatch !== null && fenceMatch[1] === openFence) {
        openFence = undefined;
      }
      cursor += 1;
    }
    let fieldEnd = cursor;
    const nextSection = contract.sections[sectionIndex + 1];
    const nextDocumentation =
      issueHeadingLevel === undefined && nextSection?.kind === "documentation"
        ? trimBlankLines(stripComments ? removeHtmlComments(nextSection.content ?? "") : (nextSection.content ?? ""))
        : undefined;
    if (nextDocumentation !== undefined) {
      const documentationLines = nextDocumentation.split("\n");
      const rawCandidate = lines.slice(contentStart, fieldEnd);
      const candidate = trimLineRange(rawCandidate);
      if (
        candidate.length >= documentationLines.length &&
        sameLines(candidate.slice(-documentationLines.length), documentationLines)
      ) {
        const leadingBlankLines = rawCandidate.findIndex((line) => line.trim().length > 0);
        const candidateStart = contentStart + Math.max(leadingBlankLines, 0);
        fieldEnd = candidateStart + candidate.length - documentationLines.length;
        cursor = fieldEnd;
      }
    }
    const fieldLines = trimLineRange(lines.slice(contentStart, fieldEnd));
    const parsed = parseFieldLines(field, fieldLines, `$.${field.id}`, stripComments, issueHeadingLevel !== undefined);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value !== undefined) values[field.id] = parsed.value;
    if (parsed.diagnostics.length > 0) return { parsed: false, values: {}, diagnostics };
  }
  while (lines[cursor] !== undefined && lines[cursor]?.trim().length === 0) cursor += 1;
  if (cursor < lines.length && lines.slice(cursor).some((line) => line.trim().length > 0)) {
    diagnostics.push({
      code: "EXISTING_EXTRA_CONTENT",
      path: "$",
      message: "Artifact contains content outside the compiled template structure.",
    });
  }
  if (diagnostics.length > 0) return { parsed: false, values: {}, diagnostics };
  return { parsed: true, values, diagnostics: [] };
}

function parseFieldLines(
  field: CanonicalField,
  lines: readonly string[],
  path: string,
  stripComments: boolean,
  issueBody: boolean,
): { value: unknown; diagnostics: readonly ExistingArtifactDiagnostic[] } {
  const diagnostics: ExistingArtifactDiagnostic[] = [];
  const filtered = stripComments ? lines.filter((line) => line.trim().length > 0) : lines;
  if (filtered.length === 1 && filtered[0]?.trim() === GITHUB_NO_RESPONSE) {
    // GitHub uses the same marker for an empty optional selection. Preserve
    // the materialized empty array so prepared artifacts remain reversible.
    return { value: field.type === "array" ? [] : undefined, diagnostics };
  }
  if (field.type === "string" || field.type === "enum") {
    const parsedValue =
      field.nativeMetadata.render === undefined
        ? trimBlankLines(unescapeMarkdownValue(filtered.join("\n")))
        : parseRenderedCodeBlock(filtered, field.nativeMetadata.render, path, diagnostics);
    const placeholder = stripComments
      ? removeHtmlComments(field.nativeMetadata.placeholder ?? "")
      : (field.nativeMetadata.placeholder ?? "");
    if (stripComments && parsedValue !== undefined && parsedValue === trimBlankLines(placeholder))
      return { value: undefined, diagnostics };
    return { value: issueBody ? issueSemanticValue(field, parsedValue) : parsedValue, diagnostics };
  }
  if (field.type === "array") {
    if (field.nativeMetadata.multiple === true) {
      const value = trimBlankLines(unescapeMarkdownValue(filtered.join("\n")));
      if (value === undefined) return { value: undefined, diagnostics };
      const values = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (values.length === 0) return { value: undefined, diagnostics };
      return { value: issueBody ? values.map((value) => issueSemanticValue(field, value)) : values, diagnostics };
    }
    const values = filtered
      .map((line) => {
        const value = /^[-+*][ \t]+(.+)$/u.exec(line)?.[1]?.trim();
        return value === undefined ? undefined : unescapeMarkdownValue(value);
      })
      .filter((value): value is string => value !== undefined);
    if (values.length !== filtered.length) {
      diagnostics.push({
        code: "EXISTING_UNPARSEABLE",
        path,
        message: "Array values must be a canonical Markdown list.",
      });
      return { value: undefined, diagnostics };
    }
    return { value: values, diagnostics };
  }
  const values: string[] = [];
  const checklistLines = stripComments
    ? removeRenderedPlaceholder(filtered, field.nativeMetadata.placeholder)
    : filtered;
  for (const line of checklistLines) {
    const match = /^[-+*][ \t]+\[([ xX])\][ \t]+(.+)$/u.exec(line);
    if (match === null) {
      diagnostics.push({
        code: "EXISTING_UNPARSEABLE",
        path,
        message: "Checklist values must use canonical task-list syntax.",
      });
      continue;
    }
    const label = unescapeMarkdownValue(match[2]?.trim() ?? "");
    const item = field.items.find((candidate) => candidate.label === label);
    if (item === undefined) {
      diagnostics.push({
        code: "EXISTING_UNKNOWN_CHECKLIST_ITEM",
        path,
        message: `Unknown checklist item "${label}".`,
      });
    } else if (match[1]?.toLowerCase() === "x") {
      values.push(item.id);
    }
  }
  return { value: values, diagnostics };
}

function removeRenderedPlaceholder(lines: readonly string[], placeholder: string | undefined): readonly string[] {
  if (placeholder === undefined) return lines;
  const placeholderLines = nonEmptyLines(removeHtmlComments(placeholder));
  return placeholderLines.length > 0 && sameLines(lines.slice(0, placeholderLines.length), placeholderLines)
    ? lines.slice(placeholderLines.length)
    : lines;
}

function findNextIssueHeading(contract: CanonicalContract, sectionIndex: number): string | undefined {
  for (let index = sectionIndex + 1; index < contract.sections.length; index += 1) {
    const section = contract.sections[index] as CanonicalContract["sections"][number];
    if (section.kind !== "input") continue;
    const title = section.title ?? section.fields[0]?.label;
    if (title !== undefined) return `### ${escapeHeading(title)}`;
  }
  return undefined;
}

function parseRenderedCodeBlock(
  lines: readonly string[],
  language: string,
  path: string,
  diagnostics: ExistingArtifactDiagnostic[],
): string | undefined {
  const opening = /^(`{3,})(.*)$/u.exec(lines[0] ?? "");
  if (opening === null || opening[2] !== language || lines.length < 2) {
    diagnostics.push({
      code: "EXISTING_UNPARSEABLE",
      path,
      message: `Rendered textarea values must use a fenced ${language} code block.`,
    });
    return undefined;
  }
  const fence = opening[1];
  if (lines.at(-1) !== fence) {
    diagnostics.push({
      code: "EXISTING_UNPARSEABLE",
      path,
      message: "Rendered textarea code blocks must have a matching closing fence.",
    });
    return undefined;
  }
  const value = lines.slice(1, -1).join("\n");
  return value.length === 0 ? undefined : value;
}

function renderCodeBlock(value: string, language: string): string {
  const normalized = normalizeSource(value);
  const longestFence = Math.max(0, ...Array.from(normalized.matchAll(/`+/gu), (match) => match[0]?.length ?? 0));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${normalized}\n${fence}`;
}

function mergeIssueLabels(
  nativeLabels: readonly string[] | undefined,
  callerLabels: readonly string[] | undefined,
): readonly string[] | undefined {
  if (nativeLabels === undefined && callerLabels === undefined) return undefined;
  const labels: string[] = [];
  for (const label of [...(nativeLabels ?? []), ...(callerLabels ?? [])]) {
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function parseMetadata(input: Record<string, unknown>): ArtifactInputMetadata {
  const metadata: MutableArtifactInputMetadata = {};
  if (input.title !== undefined) metadata.title = requiredMetadataString(input.title, "title");
  for (const key of ["labels", "assignees"] as const) {
    if (input[key] !== undefined) metadata[key] = stringArray(input[key], key);
  }
  for (const key of ["head", "base"] as const) {
    if (input[key] !== undefined) metadata[key] = requiredMetadataString(input[key], key);
  }
  for (const key of ["draft", "maintainerCanModify"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean")
        throw new ArtifactInputError("INPUT_METADATA_INVALID", `${key} must be a boolean.`, `$.${key}`);
      metadata[key] = input[key];
    }
  }
  return metadata;
}

type MutableArtifactInputMetadata = {
  -readonly [Key in keyof ArtifactInputMetadata]?: ArtifactInputMetadata[Key];
};

function requiredMetadataString(value: unknown, key: string): string {
  const violation = validateRequiredMetadataString(value, key);
  if (violation !== undefined) throw new ArtifactInputError(violation.code, violation.message, violation.path);
  return value as string;
}

function stringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new ArtifactInputError("INPUT_METADATA_INVALID", `${key} must be an array of non-empty strings.`, `$.${key}`);
  }
  return [...(value as string[])];
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

/** Escape only Markdown constructs that could change the canonical section structure. */
export function escapeMarkdownValue(value: string): string {
  return normalizeSource(value)
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(?:#{1,6})(?:[ \t]+|$)/u.test(line)) return line.replace(/^( {0,3})(#)/u, "$1\\$2");
      if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+\[[ xX]\]/u.test(line))
        return line.replace(/^( {0,3})([-+*]|\d+[.)])/u, "$1\\$2");
      if (/^ {0,3}(?:```|~~~)/u.test(line)) return line.replace(/^([ \t]{0,3})([`~])/u, "$1\\$2");
      if (/^ {0,3}>[ \t]?/u.test(line)) return line.replace(/^( {0,3})(>)/u, "$1\\$2");
      if (/^ {0,3}<!--/u.test(line)) return line.replace(/^( {0,3})(<!--)/u, "$1\\$2");
      return line;
    })
    .join("\n");
}

function unescapeMarkdownValue(value: string): string {
  return normalizeSource(value)
    .split("\n")
    .map((line) => line.replace(/^( {0,3})\\(#{1,6}|[-+*]|\d+[.)]|[`~]|>|<!--)/u, "$1$2"))
    .join("\n");
}

export function removeHtmlComments(value: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("<!--", cursor);
    if (start < 0) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, start);
    const end = value.indexOf("-->", start + 4);
    if (end < 0) break;
    cursor = end + 3;
  }
  return result;
}

function normalizeSource(value: string): string {
  return value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

function trimBlankLines(value: string): string | undefined {
  const lines = value.split("\n");
  while (lines[0] !== undefined && lines[0].trim().length === 0) lines.shift();
  while (lines.at(-1) !== undefined && lines.at(-1)?.trim().length === 0) lines.pop();
  return lines.length === 0 ? undefined : lines.join("\n");
}

function trimLineRange(lines: readonly string[]): readonly string[] {
  const copy = [...lines];
  while (copy[0] !== undefined && copy[0].trim().length === 0) copy.shift();
  while (copy.at(-1) !== undefined && copy.at(-1)?.trim().length === 0) copy.pop();
  return copy;
}

function nonEmptyLines(value: string): readonly string[] {
  return normalizeSource(value)
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function isHeading(line: string): boolean {
  return /^#{1,6}[ \t]+\S/u.test(line);
}

function sameLines(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((line, index) => line === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticValidationFromLoad(loaded: CanonicalArtifactLoadResult): SemanticValidationResult {
  return { valid: loaded.valid, violations: loaded.violations, values: loaded.canonical };
}
