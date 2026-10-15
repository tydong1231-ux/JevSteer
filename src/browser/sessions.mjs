import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// A profile/endpoint has one durable namespace. Physical CDP target IDs are
// stable while a Page survives a process reconnect; they are never inferred
// from URL or tab order. Recreated Pages get new IDs, with a session-wide
// unresolved-action fence in the journal.
export function sessionIdentity({ sessionId, userDataDir, cdpEndpoint } = {}) {
  if (sessionId) return String(sessionId);
  const source = cdpEndpoint ? `cdp:${cdpEndpoint}` : userDataDir ? `profile:${resolve(userDataDir)}` : null;
  return source ? createHash('sha256').update(source).digest('hex').slice(0, 24) : randomUUID();
}

export async function physicalPageId(context, page) {
  const cdp = await context.newCDPSession(page);
  try { return (await cdp.send('Target.getTargetInfo')).targetInfo.targetId; }
  finally { await cdp.detach(); }
}
