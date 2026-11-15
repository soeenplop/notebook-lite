import { redirectToPath } from '@/lib/redirect';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303: turn the form POST into a GET of the login page.
  return redirectToPath('/login', 303);
}
