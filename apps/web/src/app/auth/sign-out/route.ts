import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303: turn the form POST into a GET of the login page.
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
