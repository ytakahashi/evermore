/**
 * Environment variable that turns a missing e2e host dependency into a failure instead of a skip.
 * CI sets it on runners known to provide every dependency (macOS ships zsh and jq), so a runner
 * image change cannot silently turn the e2e tier into a no-op.
 */
export const REQUIRE_E2E_ENV = 'EVERMORE_REQUIRE_E2E';

/**
 * Resolves whether an e2e host dependency is usable, for use with `skipIf(!available)`.
 *
 * @param name - Human-readable dependency name used in the failure message.
 * @param available - Result of probing the host for the dependency.
 * @returns `available` unchanged when the dependency is present or not required.
 * @throws Error when the dependency is missing and {@link REQUIRE_E2E_ENV} is `1`.
 */
export function resolveHostDependency(name: string, available: boolean): boolean {
  if (!available && process.env[REQUIRE_E2E_ENV] === '1') {
    throw new Error(`${REQUIRE_E2E_ENV}=1 but the e2e host dependency "${name}" is unavailable.`);
  }
  return available;
}
