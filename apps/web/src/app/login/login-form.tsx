'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

const CODE_LENGTH = 6;

type Step = { kind: 'email' } | { kind: 'code'; email: string };

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendEmail(event?: FormEvent) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    const { error: otpError } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
    });
    setPending(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setCode('');
    setStep({ kind: 'code', email: email.trim() });
  }

  async function verifyCode(token: string) {
    if (step.kind !== 'code') return;
    setPending(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.verifyOtp({
      email: step.email,
      token,
      type: 'email',
    });
    if (verifyError) {
      setPending(false);
      setError(verifyError.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (step.kind === 'email') {
    return (
      <Card className="w-full max-w-sm">
        <form onSubmit={(event) => void sendEmail(event)}>
          <CardHeader>
            <CardTitle>Sign in to Notebook Lite</CardTitle>
            <CardDescription>We'll email you a sign-in link. No password needed.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 py-6">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending || !email}>
              {pending ? 'Sending…' : 'Continue'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent an email to <span className="font-medium text-foreground">{step.email}</span>.
          Click the link in it, or enter the {CODE_LENGTH}-digit code if it contains one.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 py-6">
        <Label htmlFor="code">Code</Label>
        <InputOTP
          id="code"
          maxLength={CODE_LENGTH}
          value={code}
          onChange={setCode}
          onComplete={(token: string) => void verifyCode(token)}
          disabled={pending}
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot key={index} index={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setStep({ kind: 'email' })} disabled={pending}>
          Use another email
        </Button>
        <Button variant="outline" onClick={() => void sendEmail()} disabled={pending}>
          Resend
        </Button>
      </CardFooter>
    </Card>
  );
}
