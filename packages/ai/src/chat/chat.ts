import { type LanguageCode, sanitizeCitations } from '@notebook-lite/shared';
import { generateText, type LanguageModel, streamText } from 'ai';
import { countTokens } from '../tokens.js';
import {
  chatTitleInstructions,
  chatTitlePrompt,
  groundedAnswerInstructions,
  type PromptExcerpt,
  queryRewriteInstructions,
  queryRewritePrompt,
} from './prompts.js';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Messages of the conversation used to rewrite a follow-up (most recent last). */
export const QUERY_REWRITE_HISTORY_MESSAGES = 6;
/** Characters per history message passed to the rewrite (long answers are cut). */
const QUERY_REWRITE_MESSAGE_CHARS = 1500;
/** Upper bound for a rewritten query; longer output falls back to the question. */
const QUERY_MAX_CHARS = 500;

export interface RewriteQueryOptions {
  model: LanguageModel;
  /** The notebook language: the query is written in it so full-text search matches. */
  language: LanguageCode;
  /** Earlier messages of the chat, oldest first (without the new question). */
  history: readonly HistoryMessage[];
  question: string;
  abortSignal?: AbortSignal;
}

/**
 * Condenses a follow-up question and the recent conversation into a standalone search query in
 * the notebook language. The first question of a chat skips the LLM call: it is searched as is
 * (cross-language matches rely on the vector search).
 */
export async function rewriteQuery(options: RewriteQueryOptions): Promise<string> {
  const { model, language, history, question, abortSignal } = options;
  if (history.length === 0) return question;

  const recent = history.slice(-QUERY_REWRITE_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, QUERY_REWRITE_MESSAGE_CHARS),
  }));
  const { text } = await generateText({
    model,
    instructions: queryRewriteInstructions(language),
    prompt: queryRewritePrompt(recent, question),
    maxRetries: 2,
    ...(abortSignal ? { abortSignal } : {}),
  });
  const query = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'„“]|["'“”]$/g, '');
  return query && query.length <= QUERY_MAX_CHARS ? query : question;
}

/** A retrieved chunk in rank order (shape of a `match_chunks` row). */
export interface RankedChunk {
  id: string;
  source_id: string;
  content: string;
  page_start: number | null;
  heading_path: string[] | null;
  token_count: number | null;
}

export interface ContextChunk<T extends RankedChunk = RankedChunk> {
  /** Citation marker, 1-based, in rank order. */
  marker: number;
  chunk: T;
}

/** Token budget for the excerpts in one answer prompt. */
export const CONTEXT_MAX_TOKENS = 8000;

/**
 * Takes chunks in rank order until the token budget is used up and numbers them [1]..[n].
 * The best chunk is always kept, even when it alone exceeds the budget.
 */
export function selectContext<T extends RankedChunk>(
  chunks: readonly T[],
  maxTokens = CONTEXT_MAX_TOKENS,
): ContextChunk<T>[] {
  const selected: ContextChunk<T>[] = [];
  let used = 0;
  for (const chunk of chunks) {
    const tokens = chunk.token_count ?? countTokens(chunk.content);
    if (selected.length > 0 && used + tokens > maxTokens) break;
    used += tokens;
    selected.push({ marker: selected.length + 1, chunk });
  }
  return selected;
}

export interface ChatTitleOptions {
  model: LanguageModel;
  /** The notebook language: the title is written in it. */
  language: LanguageCode;
  question: string;
  answer: string;
  abortSignal?: AbortSignal;
}

/** Longest automatic title (the column allows 200 characters). */
export const CHAT_TITLE_MAX_CHARS = 80;

/** Generates a short chat title in the notebook language from the first exchange. */
export async function generateChatTitle(options: ChatTitleOptions): Promise<string | null> {
  const { text } = await generateText({
    model: options.model,
    instructions: chatTitleInstructions(options.language),
    prompt: chatTitlePrompt(options.question.slice(0, 2000), options.answer.slice(0, 2000)),
    maxRetries: 2,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });
  return cleanTitle(text);
}

/** Normalizes model output to a single-line title, or null if nothing usable is left. */
export function cleanTitle(text: string): string | null {
  const title = (text.split('\n').find((line) => line.trim()) ?? '')
    .replace(/^(title|titel)\s*:\s*/i, '')
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/^[\s"'„“”*#]+|[\s"'“”*.!?:;]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!title) return null;
  if (title.length <= CHAT_TITLE_MAX_CHARS) return title;
  const cut = title.slice(0, CHAT_TITLE_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Earlier messages passed to the answer model as conversation context. */
export const ANSWER_HISTORY_MESSAGES = 10;

export interface GroundedAnswerOptions {
  model: LanguageModel;
  /** The notebook language: the answer is written in it. */
  language: LanguageCode;
  /** Numbered excerpts (see {@link selectContext}); markers in the answer refer to them. */
  excerpts: readonly PromptExcerpt[];
  /** Earlier messages of the chat, oldest first (without the new question). */
  history: readonly HistoryMessage[];
  question: string;
  abortSignal?: AbortSignal;
}

/**
 * Streams an answer grounded in the excerpts. Citation markers of earlier answers are removed
 * from the history: they referred to other excerpts and would mislead the model.
 */
export function streamGroundedAnswer(options: GroundedAnswerOptions) {
  const history = options.history.slice(-ANSWER_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: sanitizeCitations(message.content, NO_MARKERS),
  }));
  return streamText({
    model: options.model,
    instructions: groundedAnswerInstructions(options.language, options.excerpts),
    messages: [...history, { role: 'user' as const, content: options.question }],
    maxRetries: 2,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });
}

const NO_MARKERS: ReadonlySet<number> = new Set();
