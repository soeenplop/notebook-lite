import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type AiModels,
  generateChatTitle,
  type HistoryMessage,
  streamGroundedAnswer,
} from '@notebook-lite/ai';
import type { Json } from '@notebook-lite/db';
import {
  CHAT_STREAM_ERROR_CODES,
  type ChatDataTypes,
  type Citation,
  findUncitedSentences,
  type LanguageCode,
  languageCodeSchema,
  sanitizeCitations,
} from '@notebook-lite/shared';
import {
  createUIMessageStream,
  type LanguageModelUsage,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { AI_MODELS } from '../ai/ai-models.provider.js';
import type { Db } from '../supabase/types.js';
import { retrieveContext } from './retrieval.js';

export type ChatUIMessage = UIMessage<unknown, ChatDataTypes>;

/** Earlier messages loaded as conversation context (rewrite + answer). */
const HISTORY_LIMIT = 20;

/** Everything needed to answer in a chat, loaded through the user's RLS-scoped client. */
export interface PreparedChat {
  chatId: string;
  notebookId: string;
  title: string | null;
  language: LanguageCode;
  /** Selected sources with status `ready`: id → title. */
  sources: Map<string, string>;
  /** Earlier messages, oldest first. */
  history: HistoryMessage[];
}

interface ChatRow {
  id: string;
  notebook_id: string;
  title: string | null;
  notebooks: { language: string } | null;
  chat_sources: { source_id: string; sources: { title: string; status: string } | null }[];
}

/** Snapshot of an answer as persisted: invalid markers removed, only used citations kept. */
export function finalizeAnswer(
  text: string,
  available: readonly Citation[],
): { content: string; citations: Citation[]; uncitedSentences: number } {
  const valid = new Set(available.map((citation) => citation.marker));
  const content = sanitizeCitations(text, valid).trim();
  const used = new Set(
    [...content.matchAll(/\[(\d+)\]/g)].map((match) => Number.parseInt(match[1] ?? '', 10)),
  );
  return {
    content,
    citations: available.filter((citation) => used.has(citation.marker)),
    uncitedSentences: findUncitedSentences(content).length,
  };
}

function usageJson(usage: LanguageModelUsage): Json {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
}

/**
 * Grounded chat over the selected sources: loads the chat, persists the question, retrieves
 * excerpts, streams the answer as an AI SDK UI-message stream (`data-citations` before the text)
 * and persists the answer with its citation snapshot. All database access uses the caller's
 * RLS-scoped client.
 */
@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger('ChatStream');

  constructor(@Inject(AI_MODELS) private readonly models: AiModels) {}

  /** Loads the chat (404 if not visible) and fails with 400 when no ready source is selected. */
  async prepare(db: Db, chatId: string): Promise<PreparedChat> {
    const { data, error } = await db
      .from('chats')
      .select(
        'id, notebook_id, title, notebooks(language), chat_sources(source_id, sources(title, status))',
      )
      .eq('id', chatId)
      .maybeSingle()
      .overrideTypes<ChatRow, { merge: false }>();
    if (error) throw this.dbError('load chat', error);
    if (!data) throw new NotFoundException('Chat not found');

    const language = languageCodeSchema.safeParse(data.notebooks?.language);
    if (!language.success) throw new InternalServerErrorException('Notebook language missing');

    const sources = new Map<string, string>();
    for (const row of data.chat_sources) {
      if (row.sources?.status === 'ready') sources.set(row.source_id, row.sources.title);
    }
    if (sources.size === 0) {
      throw new BadRequestException({
        error: {
          code: CHAT_STREAM_ERROR_CODES.noSources,
          message:
            data.chat_sources.length === 0
              ? 'Select at least one source for this chat.'
              : 'None of the selected sources is ready yet.',
        },
      });
    }

    const history = await db
      .from('messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (history.error) throw this.dbError('load history', history.error);

    return {
      chatId: data.id,
      notebookId: data.notebook_id,
      title: data.title,
      language: language.data,
      sources,
      history: history.data
        .toReversed()
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row) => ({ role: row.role === 'user' ? 'user' : 'assistant', content: row.content })),
    };
  }

  /** Persists the user's question; call before streaming so it survives failed answers. */
  async saveQuestion(db: Db, chat: PreparedChat, text: string): Promise<void> {
    const { error } = await db
      .from('messages')
      .insert({ chat_id: chat.chatId, role: 'user', content: text });
    if (error) throw this.dbError('save question', error);
  }

  /** The answer as a UI-message stream. Persistence happens inside, also if the client leaves. */
  stream(db: Db, chat: PreparedChat, question: string): ReadableStream {
    return createUIMessageStream<ChatUIMessage>({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' });

        const context = await retrieveContext({
          db,
          models: this.models,
          notebookId: chat.notebookId,
          language: chat.language,
          sources: chat.sources,
          history: chat.history,
          question,
        });
        writer.write({ type: 'data-citations', id: 'citations', data: context.citations });

        const result = streamGroundedAnswer({
          model: this.models.chat,
          language: chat.language,
          excerpts: context.excerpts,
          history: chat.history,
          question,
        });
        let failed = false;
        const parts = toUIMessageStream<ToolSet, ChatUIMessage>({
          stream: result.stream,
          sendStart: false,
          sendFinish: false,
          onError: (error) => {
            failed = true;
            this.logger.error(`answer failed in chat ${chat.chatId}: ${String(error)}`);
            return 'The answer could not be generated. Please try again.';
          },
        });
        // Forward sequentially, so the stream order is deterministic. Writes after a client
        // disconnect are dropped, but the loop still drains the model stream and we persist.
        for await (const part of parts) writer.write(part);
        if (failed) return;

        const answer = finalizeAnswer(await result.text, context.citations);
        if (answer.uncitedSentences > 0) {
          this.logger.warn(
            `grounding: ${answer.uncitedSentences} sentence(s) without citation in chat ${chat.chatId}`,
          );
        }
        const { error } = await db.from('messages').insert({
          chat_id: chat.chatId,
          role: 'assistant',
          content: answer.content,
          citations: answer.citations,
          model: modelId(this.models.chat),
          usage: usageJson(await result.usage),
        });
        if (error) throw this.dbError('save answer', error);

        const title = await this.updateTitle(db, chat, question, answer.content);
        if (title) writer.write({ type: 'data-chat-title', data: { title }, transient: true });
        writer.write({ type: 'finish' });
      },
      onError: (error) => {
        this.logger.error(
          `chat ${chat.chatId} failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        return 'The answer could not be generated. Please try again.';
      },
    });
  }

  /**
   * Gives an untitled chat an automatic title in the notebook language (after the first
   * exchange); otherwise touches the chat so it moves to the top of the list. Never fails the
   * answer: errors are logged.
   */
  private async updateTitle(
    db: Db,
    chat: PreparedChat,
    question: string,
    answer: string,
  ): Promise<string | null> {
    try {
      const title =
        chat.title === null
          ? await generateChatTitle({
              model: this.models.chat,
              language: chat.language,
              question,
              answer,
            })
          : null;
      // `title = title` still fires the updated_at trigger (users may only update the title).
      const { error } = await db
        .from('chats')
        .update({ title: title ?? chat.title })
        .eq('id', chat.chatId);
      if (error) throw new Error(`${error.code} ${error.message}`);
      return title;
    } catch (error) {
      this.logger.warn(`could not update chat ${chat.chatId}: ${String(error)}`);
      return null;
    }
  }

  private dbError(action: string, error: { code: string; message: string }): Error {
    this.logger.error(`${action}: ${error.code} ${error.message}`);
    return new InternalServerErrorException('Database error');
  }
}

function modelId(model: AiModels['chat']): string {
  return typeof model === 'string' ? model : model.modelId;
}
