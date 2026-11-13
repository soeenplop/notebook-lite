import type { PodcastExcerpt } from '@notebook-lite/ai';
import type { Db } from '../supabase/types.js';
import { toTrpcError } from '../trpc/db-errors.js';

/** Chunks sampled for topic suggestions across all selected sources. */
export const SAMPLE_CHUNKS = 16;
/** Token budget of the sample (chunks are ~800 tokens). */
export const SAMPLE_TOKEN_BUDGET = 14_000;
/** Leading chunks of a source always included (they usually state what it is about). */
const LEADING_CHUNKS = 2;

/**
 * Ordinals to sample from a source with `count` chunks: the first chunks, then chunks evenly
 * spread over the rest, so the sample covers the whole document.
 */
export function sampleOrdinals(count: number, take: number): number[] {
  if (count <= 0 || take <= 0) return [];
  if (count <= take) return Array.from({ length: count }, (_, i) => i);
  const leading = Math.min(LEADING_CHUNKS, take);
  const picks = Array.from({ length: leading }, (_, i) => i);
  const rest = take - leading;
  const span = count - leading;
  for (let i = 0; i < rest; i++) {
    picks.push(leading + Math.floor(((i + 0.5) * span) / rest));
  }
  return [...new Set(picks)].toSorted((a, b) => a - b);
}

/**
 * Picks representative excerpts from the given sources (RLS-scoped): the first chunks of each
 * source plus an even spread over the rest, within {@link SAMPLE_TOKEN_BUDGET}.
 */
export async function sampleExcerpts(
  db: Db,
  notebookId: string,
  sources: readonly { id: string; title: string }[],
): Promise<PodcastExcerpt[]> {
  const perSource = Math.max(1, Math.floor(SAMPLE_CHUNKS / sources.length));
  const titles = new Map(sources.map((source) => [source.id, source.title]));
  const sourceIds = sources.map((source) => source.id);

  let rows: { source_id: string; ordinal: number; content: string; token_count: number }[];
  if (perSource === 1) {
    // Many sources: the opening chunk of each.
    const { data, error } = await db
      .from('source_chunks')
      .select('source_id, ordinal, content, token_count')
      .eq('notebook_id', notebookId)
      .in('source_id', sourceIds)
      .eq('ordinal', 0);
    if (error) throw toTrpcError(error);
    rows = data;
  } else {
    const lastOrdinals = await Promise.all(
      sourceIds.map(async (sourceId) => {
        const { data, error } = await db
          .from('source_chunks')
          .select('ordinal')
          .eq('notebook_id', notebookId)
          .eq('source_id', sourceId)
          .order('ordinal', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw toTrpcError(error);
        return data ? data.ordinal : -1;
      }),
    );
    const perSourceRows = await Promise.all(
      sourceIds.map(async (sourceId, index) => {
        const ordinals = sampleOrdinals((lastOrdinals[index] ?? -1) + 1, perSource);
        if (ordinals.length === 0) return [];
        const { data, error } = await db
          .from('source_chunks')
          .select('source_id, ordinal, content, token_count')
          .eq('notebook_id', notebookId)
          .eq('source_id', sourceId)
          .in('ordinal', ordinals)
          .order('ordinal', { ascending: true });
        if (error) throw toTrpcError(error);
        return data;
      }),
    );
    rows = perSourceRows.flat();
  }

  const order = new Map(sourceIds.map((id, index) => [id, index]));
  const sorted = rows.toSorted(
    (a, b) =>
      (order.get(a.source_id) ?? 0) - (order.get(b.source_id) ?? 0) || a.ordinal - b.ordinal,
  );
  const excerpts: PodcastExcerpt[] = [];
  let tokens = 0;
  for (const row of sorted) {
    if (excerpts.length > 0 && tokens + row.token_count > SAMPLE_TOKEN_BUDGET) break;
    tokens += row.token_count;
    excerpts.push({ sourceTitle: titles.get(row.source_id) ?? 'Source', content: row.content });
  }
  return excerpts;
}
