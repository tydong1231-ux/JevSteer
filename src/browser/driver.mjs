/**
 * BrowserDriver boundary. The orchestrator owns policy, leases, the durable
 * journal and host receipts; a driver owns live browser objects and input.
 *
 * @typedef {{pageId: string, sessionId: string, tabId: string, url: string, title: string}} PageRef
 * @typedef {'predispatch_rejected'|'dispatched_ack'|'dispatched_unknown'|'observed_effect'|'independently_verified'} DispatchState
 * @typedef {{state: DispatchState, error?: string, input_mode?: string}} ActionResult
 *
 * Drivers implement ready(), createPage(), open(url, options), pages(),
 * observe(pageRef, scope?), assertTargetFresh(pageRef, action),
 * perform(pageRef, action, targetRef?, {beforeDispatch}?),
 * waitFor(pageRef, condition, budget), screenshot(pageRef, options),
 * events(pageRef, cursor), eventBody(pageRef, requestId, maxBytes), close().
 *
 * beforeDispatch MUST complete before the first possible input event. A
 * failure after that event is unknown, even if Playwright reports a timeout.
 * Only the independent verifier/host may promote an ACK to business success.
 */
export class DriverActionError extends Error {
  constructor(result) {
    super(result.error || result.state);
    this.dispatchState = result.state;
  }
}

export async function dispatchInput(prepare, beforeDispatch, send) {
  let dispatched = false;
  let prepared;
  try {
    prepared = await prepare();
    await beforeDispatch?.();
    const markDispatched = () => { dispatched = true; };
    const metadata = await send(prepared, markDispatched);
    return { state: 'dispatched_ack', ...metadata };
  } catch (error) {
    return { state: dispatched ? 'dispatched_unknown' : 'predispatch_rejected', error: String(error?.message || error) };
  } finally {
    await prepared?.dispose?.().catch(() => {});
  }
}
