import { TRPCError } from '@trpc/server';
import type { Db } from '../supabase/types.js';

/**
 * Storage cleanup through the caller's RLS-scoped client: Storage policies only let users list
 * and delete objects under their own `{user_id}/` folder. Plain functions (no Nest), used by the
 * tRPC routers.
 */

const PAGE_SIZE = 1000;
/** Storage's `remove` accepts at most 1000 paths per request. */
const REMOVE_BATCH = 1000;

/** All object paths below `folder` (recursively). Folders are entries without an id. */
export async function listObjectPaths(db: Db, bucket: string, folder: string): Promise<string[]> {
  const paths: string[] = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop() ?? '';
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // Paging is inherently sequential.
      // oxlint-disable-next-line no-await-in-loop
      const { data, error } = await db.storage
        .from(bucket)
        .list(current, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw storageError(error);
      for (const entry of data) {
        const path = `${current}/${entry.name}`;
        if (entry.id === null) pending.push(path);
        else paths.push(path);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  return paths;
}

/** Deletes every object below `folder` in `bucket`. Returns the number of deleted objects. */
export async function removeStorageFolder(db: Db, bucket: string, folder: string): Promise<number> {
  const paths = await listObjectPaths(db, bucket, folder);
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    // oxlint-disable-next-line no-await-in-loop
    const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw storageError(error);
  }
  return paths.length;
}

function storageError(cause: Error): TRPCError {
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Storage error', cause });
}
