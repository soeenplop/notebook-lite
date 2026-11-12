import { expect, test } from '@playwright/test';

// Smoke tests for the signed-out experience. The authenticated journey
// (create notebook → upload → ask → citation) is added once those features exist.

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Sign in to Notebook Lite')).toBeVisible();
});

test('the requested page is kept as next parameter', async ({ page }) => {
  await page.goto('/notebooks/demo?tab=chat');
  await expect(page).toHaveURL('/login?next=%2Fnotebooks%2Fdemo%3Ftab%3Dchat');
});

test('the email step needs an address before continuing', async ({ page }) => {
  await page.goto('/login');
  const submit = page.getByRole('button', { name: 'Continue' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Email').fill('someone@example.com');
  await expect(submit).toBeEnabled();
});

test('an invalid sign-in link shows an error on the login page', async ({ page }) => {
  await page.goto('/auth/callback?code=invalid&next=//evil.example');
  await expect(page).toHaveURL('/login?error=link');
  await expect(page.getByRole('alert').filter({ hasText: 'invalid or has expired' })).toBeVisible();
});

test('unknown public routes render the not-found page', async ({ page }) => {
  const response = await page.goto('/auth/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('responses carry the security headers', async ({ request }) => {
  const response = await request.get('/login');
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-powered-by']).toBeUndefined();
});
