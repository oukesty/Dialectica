import { AiTask, AiTaskOutput, DiscussionProject, ProjectSummary, ProjectSummaryHistoryEntry, RoomAiAutomation, RoomAiAutomationMode, TranscriptEntry } from "@/lib/types";
import { normalizeText } from "@/lib/utils";

export const BASIC_SUMMARY_THRESHOLD_OPTIONS = [10, 20, 30, 50] as const;
export const ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 40, 50] as const;

export type NormalizedSummaryAutomationMode = "off" | "basic" | "assistive";

export interface NormalizedSummaryAutomationConfig {
  mode: NormalizedSummaryAutomationMode;
  summaryThreshold: number;
  summaryCurrentThreshold: number;
  summaryLastProcessedEntryCount: number;
}

export interface AssistiveSummaryDecision {
  shouldPersistSummary: boolean;
  nextThreshold: number;
  rationale: string;
}

export interface SummaryBatchQualityDecision {
  shouldPersistSummary: boolean;
  signalScore: number;
  informativeEntryCount: number;
  uniqueInformativeEntryCount: number;
  informativeRatio: number;
  participantCount: number;
  rationale: string;
}

export interface SummaryHistoryRetentionConfig {
  mode: "unlimited" | "capped";
  limit: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function closestThreshold(value: number | undefined, options: readonly number[], fallback: number) {
  if (!isFiniteNumber(value)) return fallback;
  return [...options].sort((left, right) => Math.abs(left - value) - Math.abs(right - value))[0] ?? fallback;
}

export function normalizeSummaryAutomationMode(mode: RoomAiAutomationMode | undefined): NormalizedSummaryAutomationMode {
  if (mode === "assistive") return "assistive";
  if (mode === "basic" || mode === "auto") return "basic";
  return "off";
}

export function normalizeSummaryThreshold(value: number | undefined, mode: NormalizedSummaryAutomationMode, fallback = 20) {
  const options = mode === "assistive" ? ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS : BASIC_SUMMARY_THRESHOLD_OPTIONS;
  return closestThreshold(value, options, closestThreshold(fallback, options, options[0] ?? fallback));
}

export function normalizeSummaryAutomationConfig(automation: RoomAiAutomation | undefined): NormalizedSummaryAutomationConfig {
  const mode = normalizeSummaryAutomationMode(automation?.mode);
  const legacyThreshold = automation?.summaryThreshold ?? automation?.autoReplyThreshold;
  const summaryThreshold = normalizeSummaryThreshold(legacyThreshold, mode === "assistive" ? "assistive" : "basic");
  const summaryCurrentThreshold = normalizeSummaryThreshold(
    automation?.summaryCurrentThreshold ?? legacyThreshold,
    mode === "assistive" ? "assistive" : "basic",
    summaryThreshold,
  );

  return {
    mode,
    summaryThreshold,
    summaryCurrentThreshold,
    summaryLastProcessedEntryCount: Math.max(0, Math.round(automation?.summaryLastProcessedEntryCount ?? 0)),
  };
}

export function isSingleUserSummaryProject(project: Pick<DiscussionProject, "scenario" | "participants">) {
  return project.scenario === "ai-dialogue" && project.participants.length <= 1;
}

export function getEffectiveSummaryAutomation(project: DiscussionProject): NormalizedSummaryAutomationConfig {
  const automation = normalizeSummaryAutomationConfig(project.room.aiAutomation);
  if (automation.mode !== "assistive" || !isSingleUserSummaryProject(project)) {
    return automation;
  }

  return {
    ...automation,
    mode: "basic",
    summaryCurrentThreshold: automation.summaryThreshold,
  };
}

export function getSummaryHistory(project: DiscussionProject) {
  return project.summary.history ?? [];
}

export function getLatestSummaryHistory(project: DiscussionProject): ProjectSummaryHistoryEntry | undefined {
  return getSummaryHistory(project).at(-1);
}

export function getSummaryProcessedEntryCount(project: DiscussionProject) {
  const normalized = getEffectiveSummaryAutomation(project);
  if (normalized.summaryLastProcessedEntryCount > 0) {
    return normalized.summaryLastProcessedEntryCount;
  }

  return getLatestSummaryHistory(project)?.throughEntryCount ?? 0;
}

export function resolveAutoTriggeredTasks(project: DiscussionProject): AiTask[] {
  const automation = getEffectiveSummaryAutomation(project);
  if (automation.mode === "off") {
    return [];
  }

  const processedEntryCount = getSummaryProcessedEntryCount(project);
  const messagesSinceSummary = Math.max(0, project.entries.length - processedEntryCount);
  const currentThreshold = automation.mode === "assistive"
    ? automation.summaryCurrentThreshold
    : automation.summaryThreshold;

  return messagesSinceSummary >= currentThreshold ? ["summarizeDiscussion"] : [];
}

export function appendSummaryHistory(
  history: ProjectSummaryHistoryEntry[] | undefined,
  entry: ProjectSummaryHistoryEntry,
  retention: SummaryHistoryRetentionConfig = { mode: "unlimited", limit: 20 },
) {
  const nextHistory = [...(history ?? []), entry];
  if (retention.mode !== "capped") {
    return nextHistory;
  }
  return nextHistory.slice(-Math.max(1, retention.limit));
}

export function getAssistiveThresholdWindow(baseThreshold: number): readonly number[] {
  const normalizedBase = normalizeSummaryThreshold(baseThreshold, "assistive");
  const baseIndex = ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS.findIndex((threshold) => threshold === normalizedBase);
  const start = Math.max(0, baseIndex - 2);
  const end = Math.min(ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS.length, baseIndex + 3);
  return ASSISTIVE_SUMMARY_THRESHOLD_OPTIONS.slice(start, end);
}

function adjustThreshold(window: readonly number[], currentThreshold: number, direction: -1 | 0 | 1) {
  const currentIndex = Math.max(0, Array.from(window).indexOf(currentThreshold));
  const nextIndex = Math.min(window.length - 1, Math.max(0, currentIndex + direction));
  return window[nextIndex] ?? currentThreshold;
}

const LOW_SIGNAL_ENTRY_PATTERNS = [
  /^(hi|hello|hey|ok|okay|yes|no|thanks|thank you|got it|noted|sure|sounds good)[.!。！\s]*$/i,
  /^(你好|您好|谢谢|好的|收到|明白|嗯|可以|行|没问题|辛苦了)[。！\s]*$/i,
  /^(はい|了解|ありがとう|こんにちは)[。！\s]*$/i,
  /^(merci|bonjour|d'accord|bien note)[.!。！\s]*$/i,
] as const;

const HIGH_VALUE_ENTRY_PATTERNS = [
  /\b(because|therefore|however|but|evidence|risk|decision|decided|action|next step|todo|blocker|issue|problem|conflict|disagree|agree because|proposal|recommend|should|must)\b/i,
  /(因为|因此|但是|不过|证据|风险|决定|决策|行动项|下一步|待办|阻塞|问题|分歧|冲突|不同意|建议|应该|必须|结论|未解决)/i,
  /(なぜなら|したがって|しかし|証拠|リスク|決定|次の一手|課題|対立|提案|未解決)/i,
  /(preuve|risque|decision|action|prochaine etape|probleme|conflit|desaccord|recommande|non resolu)/i,
  /(риск|решение|доказ|действ|следующ|проблем|конфликт|разноглас|рекоменд|нереш)/i,
] as const;

function isLowSignalEntryText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const normalized = normalizeText(trimmed);
  if (!normalized || normalized.length <= 2) return true;
  return LOW_SIGNAL_ENTRY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function looksInformativeEntry(entry: TranscriptEntry) {
  const text = entry.content.trim();
  if (isLowSignalEntryText(text)) return false;
  if (entry.highlighted) return true;
  if (entry.kind === "question" && text.length >= 12) return true;
  if (text.length >= 64) return true;
  return HIGH_VALUE_ENTRY_PATTERNS.some((pattern) => pattern.test(text));
}

function uniqueInformativeEntryCount(entries: TranscriptEntry[]) {
  return new Set(entries.map((entry) => normalizeText(entry.content)).filter(Boolean)).size;
}

function scoreSummaryOutput(output: AiTaskOutput) {
  const structuredSignals = [
    output.topic.trim().length > 0,
    output.arguments.length >= 2,
    output.evidence.length >= 1,
    output.disputes.length + output.conflicts.length >= 1,
    output.unresolvedQuestions.length >= 1,
    output.recommendations.length >= 1,
    output.conclusion.trim().length > 0,
    output.summary.trim().length >= 80,
  ];
  return structuredSignals.reduce((total, value) => total + (value ? 1 : 0), 0);
}

function isNearDuplicateSummary(output: AiTaskOutput, previousSummary?: ProjectSummary) {
  if (!previousSummary) return false;
  const current = normalizeText(output.summary);
  if (!current || current.length < 24) return false;
  const previousValues = [
    previousSummary.overview,
    previousSummary.currentConclusion,
    ...(previousSummary.history ?? []).slice(-3).map((entry) => entry.overview),
  ].map((value) => normalizeText(value)).filter((value) => value.length >= 24);
  return previousValues.some((previous) => (
    previous === current
    || (previous.length >= 40 && current.includes(previous))
    || (current.length >= 40 && previous.includes(current))
  ));
}

export function evaluateSummaryBatchQuality(args: {
  pendingEntries: TranscriptEntry[];
  output: AiTaskOutput;
  previousSummary?: ProjectSummary;
  mode: "basic" | "assistive";
}): SummaryBatchQualityDecision {
  const { pendingEntries, output, previousSummary, mode } = args;
  const informativeEntries = pendingEntries.filter(looksInformativeEntry);
  const informativeEntryCount = informativeEntries.length;
  const uniqueCount = uniqueInformativeEntryCount(informativeEntries);
  const informativeRatio = pendingEntries.length === 0 ? 0 : informativeEntryCount / pendingEntries.length;
  const participantCount = new Set(informativeEntries.map((entry) => entry.participantId).filter(Boolean)).size;
  const signalScore = scoreSummaryOutput(output);
  const duplicate = isNearDuplicateSummary(output, previousSummary);
  const hasEnoughBatchSignal = uniqueCount >= 2 || (participantCount >= 2 && informativeEntryCount >= 2);
  const hasEnoughOutputSignal = mode === "assistive" ? signalScore >= 4 : signalScore >= 3;
  const hasUsefulSummaryText = output.summary.trim().length >= 50;
  const shouldPersistSummary = hasUsefulSummaryText
    && hasEnoughOutputSignal
    && hasEnoughBatchSignal
    && !duplicate;

  return {
    shouldPersistSummary,
    signalScore,
    informativeEntryCount,
    uniqueInformativeEntryCount: uniqueCount,
    informativeRatio,
    participantCount,
    rationale: shouldPersistSummary
      ? signalScore >= 6
          ? "dense-high-value-batch"
          : "valuable-batch"
      : duplicate
        ? "duplicate-summary"
        : !hasUsefulSummaryText
          ? "thin-summary-output"
          : !hasEnoughBatchSignal
            ? "low-signal-batch"
            : "weak-structured-output",
  };
}

export function evaluateAssistiveSummaryDecision(args: {
  baseThreshold: number;
  currentThreshold: number;
  pendingEntries: TranscriptEntry[];
  output: AiTaskOutput;
  previousSummary?: ProjectSummary;
}): AssistiveSummaryDecision {
  const { baseThreshold, currentThreshold, pendingEntries, output, previousSummary } = args;
  const quality = evaluateSummaryBatchQuality({
    pendingEntries,
    output,
    previousSummary,
    mode: "assistive",
  });
  const shouldPersistSummary = quality.shouldPersistSummary
    && (quality.signalScore >= 5 || (quality.participantCount >= 2 && quality.informativeRatio >= 0.45));
  const window = getAssistiveThresholdWindow(baseThreshold);

  let direction: -1 | 0 | 1 = 0;
  if (!shouldPersistSummary || quality.informativeRatio < 0.35) {
    direction = 1;
  } else if (quality.signalScore >= 6 && quality.informativeRatio >= 0.65) {
    direction = -1;
  }

  const nextThreshold = adjustThreshold(window, normalizeSummaryThreshold(currentThreshold, "assistive", baseThreshold), direction);

  return {
    shouldPersistSummary,
    nextThreshold,
    rationale: !shouldPersistSummary
      ? quality.rationale
      : direction < 0
        ? "dense-high-value-batch"
        : direction > 0
          ? "sparser-batch"
          : "stable-batch",
  };
}
