export const MAX_ID_LENGTH = 256;
export const MAX_ALIAS_LENGTH = 512;
export const MAX_PATH_LENGTH = 4_096;
export const MAX_NAME_LENGTH = 256;
export const MAX_COMMAND_LENGTH = 16_384;
export const MAX_PTY_WRITE_LENGTH = 1_048_576;
export const MAX_PTY_DIMENSION = 10_000;

interface StringOptions {
  allowEmpty?: boolean;
  maxLength?: number;
}

interface NumberOptions {
  max?: number;
  min?: number;
}

function invalidPayload(channel: string): Error {
  return new Error(`Invalid IPC payload for ${channel}`);
}

/**
 * Rejects a renderer-sent IPC payload when a schema or cross-field invariant is not satisfied.
 */
export function assertIpcPayloadValid(channel: string, valid: boolean): asserts valid {
  if (!valid) {
    throw invalidPayload(channel);
  }
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  // Settings updates intentionally use a more forgiving reader because that path preserves legacy
  // normalization semantics. This shared IPC reader is stricter for capability-bearing handlers.
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function validateString(value: unknown, channel: string, options: StringOptions = {}): string {
  if (typeof value !== 'string') {
    throw invalidPayload(channel);
  }

  if (!options.allowEmpty && value.length === 0) {
    throw invalidPayload(channel);
  }

  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw invalidPayload(channel);
  }

  return value;
}

/**
 * Reads a renderer-sent IPC payload as a plain object before handler code inspects its fields.
 *
 * This boundary helper intentionally accepts only object literals and null-prototype dictionaries.
 * Do not use it for settings updates without revisiting that handler's forgiving normalization
 * behavior: `settings.ts` currently treats any non-null, non-array object as an update container and
 * lets `SettingsStore` ignore malformed sections.
 *
 * The returned value is the same reference as the input. Handlers must rebuild outgoing manager
 * inputs from individually validated fields rather than forwarding this object, so that unknown
 * renderer keys never reach managers or persistence.
 */
export function readObject(payload: unknown, channel: string): Record<string, unknown> {
  if (!isStrictPlainObject(payload)) {
    throw invalidPayload(channel);
  }

  return payload;
}

/**
 * Reads a required string field from a validated IPC payload object.
 */
export function readStringField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  options: StringOptions = {},
): string {
  if (!Object.hasOwn(object, key)) {
    throw invalidPayload(channel);
  }

  return validateString(object[key], channel, options);
}

/**
 * Reads an optional string field from a validated IPC payload object.
 */
export function readOptionalStringField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  options: StringOptions = {},
): string | undefined {
  if (!Object.hasOwn(object, key) || object[key] === undefined) {
    return undefined;
  }

  return validateString(object[key], channel, options);
}

/**
 * Reads a nullable string field from a validated IPC payload object.
 */
export function readNullableStringField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  options: StringOptions = {},
): string | null {
  if (!Object.hasOwn(object, key)) {
    throw invalidPayload(channel);
  }

  const value = object[key];
  if (value === null) {
    return null;
  }

  return validateString(value, channel, options);
}

/**
 * Reads a finite numeric field from a validated IPC payload object.
 */
export function readFiniteNumberField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  options: NumberOptions = {},
): number {
  if (!Object.hasOwn(object, key)) {
    throw invalidPayload(channel);
  }

  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidPayload(channel);
  }

  if (options.min !== undefined && value < options.min) {
    throw invalidPayload(channel);
  }

  if (options.max !== undefined && value > options.max) {
    throw invalidPayload(channel);
  }

  return value;
}

/**
 * Reads a positive integer field from a validated IPC payload object.
 */
export function readPositiveIntegerField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  options: NumberOptions = {},
): number {
  const value = readFiniteNumberField(object, key, channel, options);
  if (!Number.isInteger(value) || value <= 0) {
    throw invalidPayload(channel);
  }

  return value;
}

/**
 * Reads a single string id from a renderer-sent IPC payload object.
 */
export function readStringIdPayload(payload: unknown, key: string, channel: string): string {
  const object = readObject(payload, channel);
  return readStringField(object, key, channel, { maxLength: MAX_ID_LENGTH });
}

/**
 * Reads a bounded SSH alias from a renderer-sent IPC payload object.
 */
export function readAliasPayload(payload: unknown, channel: string): string {
  const object = readObject(payload, channel);
  return readStringField(object, 'alias', channel, { maxLength: MAX_ALIAS_LENGTH });
}
