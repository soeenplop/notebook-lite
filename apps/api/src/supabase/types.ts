import type { Database } from '@notebook-lite/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Supabase client typed with the generated schema. Plain type: shared with the tRPC router. */
export type Db = SupabaseClient<Database>;
