import { expect, it } from 'vitest';
import { createWebHttp } from './http';
it('restricts origins and does not forward credentials through redirects or browser cookies', async () => {
  let called = false;
  const http = createWebHttp(['https://forge.example'], async (_input, options) => {
    called = true;
    expect(options?.credentials).toBe('omit');
    expect(options?.redirect).toBe('error');
    expect(options?.referrerPolicy).toBe('no-referrer');
    return new Response('synthetic response');
  });
  expect(
    (await http.request('https://forge.example/api', { method: 'GET', headers: {} })).status,
  ).toBe(200);
  expect(called).toBe(true);
  called = false;
  await expect(
    http.request('https://other.example/api', { method: 'GET', headers: {} }),
  ).rejects.toThrow('not configured');
  await expect(
    http.request('http://forge.example/api', { method: 'GET', headers: {} }),
  ).rejects.toThrow('not configured');
  await expect(
    http.request('https://user:secret@forge.example/api', { method: 'GET', headers: {} }),
  ).rejects.toThrow('not configured');
  expect(called).toBe(false);
  expect(() => createWebHttp(['https://forge.example/path'])).toThrow();
});
