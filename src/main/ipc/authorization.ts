/**
 * Rejects a well-formed IPC request that asks for a capability the renderer is not allowed to use.
 */
export function assertIpcRequestAllowed(channel: string, allowed: boolean): void {
  if (!allowed) {
    throw new Error(`IPC request is not allowed for ${channel}`);
  }
}
