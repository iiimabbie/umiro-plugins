import { IntentAnalyzerFailure } from "./contract.js";

export async function readBoundedBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const abortReason = () => signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
    try { void response.body?.cancel().catch(() => undefined); } catch { /* response cleanup is best effort */ }
    throw new IntentAnalyzerFailure("response_too_large", "analyzer response exceeds the configured byte limit");
  }
  if (!response.body) throw new IntentAnalyzerFailure("protocol_error", "analyzer response has no body");
  if (signal?.aborted) {
    try { void response.body.cancel().catch(() => undefined); } catch { /* response cleanup is best effort */ }
    throw abortReason();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject: ((reason: unknown) => void) | undefined;
  const abortPromise = signal ? new Promise<never>((_resolve, reject) => { abortReject = reject; }) : undefined;
  const onAbort = () => {
    const reason = abortReason();
    abortReject?.(reason);
    try { void reader.cancel(reason).catch(() => undefined); } catch { /* reader cleanup is best effort */ }
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const next = abortPromise ? await Promise.race([reader.read(), abortPromise]) : await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        try { void reader.cancel().catch(() => undefined); } catch { /* reader cleanup is best effort */ }
        throw new IntentAnalyzerFailure("response_too_large", "analyzer response exceeds the configured byte limit");
      }
      chunks.push(next.value);
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (signal?.aborted) { try { void reader.cancel(abortReason()).catch(() => undefined); } catch { /* reader cleanup is best effort */ } }
    try { reader.releaseLock(); } catch { /* a stream may already have released the lock */ }
  }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
