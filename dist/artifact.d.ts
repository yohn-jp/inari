import { type PartialSemanticValidationResult, type PartialSemanticRepairResult, type SemanticValidationResult, type SemanticViolation } from "./contract/validation.js";
import { type ArtifactDiagnosticReport } from "./diagnostics.js";
import { type CanonicalContract } from "./contract/ir.js";
import { type ValidatedRenderedIssueArtifact, type ValidatedRenderedPullRequestArtifact } from "./github/types.js";
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
export declare class ArtifactInputError extends Error {
    readonly code: ArtifactInputErrorCode;
    readonly path: string;
    constructor(code: ArtifactInputErrorCode, message: string, path?: string);
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
export declare class ArtifactPreparationError extends Error {
    readonly code: ArtifactPreparationErrorCode;
    readonly diagnostics: readonly ArtifactRoundTripDiagnostic[];
    constructor(code: ArtifactPreparationErrorCode, message: string, diagnostics?: readonly ArtifactRoundTripDiagnostic[]);
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
export type ExistingArtifactDiagnosticCode = "EXISTING_WRONG_TEMPLATE" | "EXISTING_UNPARSEABLE" | "EXISTING_EXTRA_CONTENT" | "EXISTING_UNKNOWN_CHECKLIST_ITEM" | "EXISTING_AMBIGUOUS_TEMPLATE" | "EXISTING_NON_CANONICAL" | "EXISTING_TEMPLATE_COMPILE_FAILED";
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
    getIssue(issueNumber: number): Promise<{
        readonly body: string | null;
        readonly url: string;
    }>;
}
export interface ExistingPullRequestReader {
    getPullRequest(pullRequestNumber: number): Promise<{
        readonly body: string | null;
        readonly url: string;
    }>;
}
export interface FetchedExistingArtifact {
    readonly number: number;
    readonly url: string;
    readonly result: ExistingArtifactValidationResult;
}
/** Parse the documented JSON input envelope while keeping field semantics adapter-independent. */
export declare function parseArtifactInputDocument(input: unknown): ArtifactInputDocument;
/** Adapt a parsed JSON envelope without granting it canonical status. */
export declare function adaptJsonArtifactCandidate(input: unknown): ArtifactCandidate;
/** Adapt internal structured fields to the same candidate shape as JSON. */
export declare function adaptFieldArtifactCandidate(fields: unknown, metadata?: ArtifactInputMetadata): ArtifactCandidate;
/** Alias used by command adapters that call this input the CLI field path. */
export declare const adaptCliFieldCandidate: typeof adaptFieldArtifactCandidate;
/** Generic adapter spelling for callers that already hold structured fields. */
export declare const adaptArtifactCandidate: typeof adaptFieldArtifactCandidate;
/** Adapt an existing native artifact body through the repository parser. */
export declare function adaptMarkdownArtifactCandidate(contractInput: unknown, body: string | null | undefined): ArtifactCandidateAdapterResult;
/** Existing GitHub bodies use the same native Markdown adapter by design. */
export declare function adaptExistingArtifactCandidate(contractInput: unknown, body: string | null | undefined): ArtifactCandidateAdapterResult;
/**
 * Reload a candidate against the selected canonical contract.  Complete input
 * takes the normal one-pass validator (and therefore may materialize contract
 * defaults); incomplete/invalid input uses the bounded partial contract and
 * exposes only accepted semantic values.
 */
export declare function loadCanonicalArtifact(contractInput: unknown, candidateInput: unknown): CanonicalArtifactLoadResult;
/** Explicitly named alias for callers that pass a candidate object. */
export declare const loadCanonicalCandidate: typeof loadCanonicalArtifact;
/** Load a JSON representation through the canonical contract boundary. */
export declare function loadCanonicalJsonArtifact(contractInput: unknown, input: unknown): CanonicalArtifactLoadResult;
/** Load native Markdown through the same parser and canonical contract. */
export declare function loadCanonicalMarkdownArtifact(contractInput: unknown, body: string | null | undefined): CanonicalArtifactLoadResult;
/** Existing-body spelling retained so read/repair callers share one boundary. */
export declare function loadCanonicalExistingArtifact(contractInput: unknown, body: string | null | undefined): CanonicalArtifactLoadResult;
/** Classify an artifact input envelope without applying semantic defaults. */
export declare function validatePartialArtifactInput(contractInput: unknown, input: unknown): PartialSemanticValidationResult;
/** Terminology alias for callers that treat validation as classification. */
export declare const classifyPartialArtifactInput: typeof validatePartialArtifactInput;
/** Merge only a targeted field patch into a prior stateless partial result. */
export declare function repairPartialArtifactInput(contractInput: unknown, previous: unknown, patch?: unknown): PartialSemanticRepairResult;
/** Terminology alias for callers that describe targeted repair as a merge. */
export declare const mergePartialArtifactInput: typeof repairPartialArtifactInput;
export declare function renderIssueArtifact(contractInput: unknown, input: unknown): string;
export declare function renderPullRequestArtifact(contractInput: unknown, input: unknown): string;
/** Construct the only values accepted by the GitHub mutation adapter. */
export declare function prepareIssueArtifact(contractInput: unknown, input: ArtifactInputDocument): PreparedIssueArtifact;
export declare function preparePullRequestArtifact(contractInput: unknown, input: ArtifactInputDocument): PreparedPullRequestArtifact;
export declare function parseExistingIssueArtifact(contractInput: unknown, body: string | null | undefined): ExistingArtifactParseResult;
export declare function parseExistingPullRequestArtifact(contractInput: unknown, body: string | null | undefined): ExistingArtifactParseResult;
export declare function validateExistingIssueArtifact(contractInput: unknown, body: string | null | undefined): ExistingArtifactValidationResult;
export declare function validateExistingPullRequestArtifact(contractInput: unknown, body: string | null | undefined): ExistingArtifactValidationResult;
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
export declare function projectExistingArtifact(result: ExistingArtifactValidationResult): ExistingArtifactProjection;
/** Select a uniquely parsed governed artifact, failing closed on ambiguity. */
export declare function selectExistingArtifactCandidate(candidates: readonly ExistingArtifactCandidate[]): ExistingArtifactSelection;
/** Validate the same required string metadata enforced by mutation preparation. */
export declare function validateRequiredMetadataString(value: unknown, key: string): ArtifactMetadataViolation | undefined;
export declare function validateExistingIssueFromAdapter(reader: ExistingIssueReader, contract: unknown, issueNumber: number): Promise<FetchedExistingArtifact>;
export declare function validateExistingPullRequestFromAdapter(reader: ExistingPullRequestReader, contract: unknown, pullRequestNumber: number): Promise<FetchedExistingArtifact>;
/** Escape only Markdown constructs that could change the canonical section structure. */
export declare function escapeMarkdownValue(value: string): string;
export declare function removeHtmlComments(value: string): string;
