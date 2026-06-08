import { describe, expect, it } from 'vitest';
import {
  MAX_ID_LENGTH,
  readFiniteNumberField,
  readNullableStringField,
  readObject,
  readOptionalStringField,
  readPositiveIntegerField,
  readStringField,
  readStringIdPayload,
} from './validation';

const CHANNEL = 'test:channel';

function expectInvalidPayload(callback: () => unknown): void {
  expect(callback).toThrow(`Invalid IPC payload for ${CHANNEL}`);
}

describe('IPC validation helpers', () => {
  describe('readObject', () => {
    it('accepts plain objects', () => {
      // Given: a renderer payload shaped as a plain object.
      const payload = { id: 'pty-1' };

      // When: the object is read at the IPC boundary.
      const result = readObject(payload, CHANNEL);

      // Then: the same object can be inspected by field readers.
      expect(result).toBe(payload);
    });

    it.each([
      ['null', null],
      ['array', []],
      ['string', 'value'],
      ['number', 1],
      ['function', () => undefined],
    ])('rejects %s payloads', (_label: string, payload: unknown) => {
      // Given: a malformed renderer payload that is not a plain object.

      // When / Then: the payload is rejected before field access.
      expectInvalidPayload(() => readObject(payload, CHANNEL));
    });
  });

  describe('readStringField', () => {
    it('accepts a valid required string', () => {
      // Given: an object with a required string field.
      const object = { id: 'pty-1' };

      // When: the string field is read.
      const result = readStringField(object, 'id', CHANNEL);

      // Then: the string value is returned unchanged.
      expect(result).toBe('pty-1');
    });

    it.each([
      ['missing', {}],
      ['undefined', { id: undefined }],
      ['empty', { id: '' }],
      ['wrong type', { id: 1 }],
      ['over limit', { id: 'x'.repeat(4) }],
    ])('rejects %s required strings', (_label: string, object: Record<string, unknown>) => {
      // Given: a malformed required string field.

      // When / Then: the malformed field is rejected.
      expectInvalidPayload(() => readStringField(object, 'id', CHANNEL, { maxLength: 3 }));
    });

    it('allows an empty string when explicitly configured', () => {
      // Given: an empty string field that is valid for some IPC requests.
      const object = { data: '' };

      // When: the field is read with allowEmpty enabled.
      const result = readStringField(object, 'data', CHANNEL, { allowEmpty: true });

      // Then: the empty string is preserved.
      expect(result).toBe('');
    });
  });

  describe('readOptionalStringField', () => {
    it('accepts missing and undefined optional strings', () => {
      // Given: optional fields that are absent or explicitly undefined.
      const missing: Record<string, unknown> = {};
      const undefinedValue = { id: undefined };

      // When / Then: both are treated as omitted.
      expect(readOptionalStringField(missing, 'id', CHANNEL)).toBeUndefined();
      expect(readOptionalStringField(undefinedValue, 'id', CHANNEL)).toBeUndefined();
    });

    it('validates present optional strings', () => {
      // Given: a present valid optional string field.
      const object = { id: 'pane-1' };

      // When: the field is read.
      const result = readOptionalStringField(object, 'id', CHANNEL);

      // Then: the value is returned unchanged.
      expect(result).toBe('pane-1');
    });

    it.each([
      ['empty', { id: '' }],
      ['wrong type', { id: 1 }],
      ['over limit', { id: 'xxxx' }],
    ])('rejects %s present optional strings', (_label: string, object: Record<string, unknown>) => {
      // Given: a present optional field with an invalid value.

      // When / Then: present values must still satisfy string constraints.
      expectInvalidPayload(() => readOptionalStringField(object, 'id', CHANNEL, { maxLength: 3 }));
    });
  });

  describe('readNullableStringField', () => {
    it('accepts null and valid strings', () => {
      // Given: nullable string payload fields.
      const nullObject = { id: null };
      const stringObject = { id: 'workspace-1' };

      // When / Then: null and valid string values are accepted.
      expect(readNullableStringField(nullObject, 'id', CHANNEL)).toBeNull();
      expect(readNullableStringField(stringObject, 'id', CHANNEL)).toBe('workspace-1');
    });

    it.each([
      ['missing', {}],
      ['undefined', { id: undefined }],
      ['empty', { id: '' }],
      ['wrong type', { id: 1 }],
    ])('rejects %s nullable strings', (_label: string, object: Record<string, unknown>) => {
      // Given: a nullable field with a malformed non-null value.

      // When / Then: only null or a valid string is allowed.
      expectInvalidPayload(() => readNullableStringField(object, 'id', CHANNEL));
    });
  });

  describe('readFiniteNumberField', () => {
    it('accepts finite numbers', () => {
      // Given: an object with a finite number field.
      const object = { ratio: 0.5 };

      // When: the number field is read.
      const result = readFiniteNumberField(object, 'ratio', CHANNEL);

      // Then: the number value is returned unchanged.
      expect(result).toBe(0.5);
    });

    it.each([
      ['missing', {}],
      ['string', { value: '1' }],
      ['null', { value: null }],
      ['boolean', { value: true }],
      ['array', { value: [1] }],
      ['object', { value: { inner: 1 } }],
      ['NaN', { value: Number.NaN }],
      ['Infinity', { value: Infinity }],
      ['-Infinity', { value: -Infinity }],
    ])('rejects %s numeric fields', (_label: string, object: Record<string, unknown>) => {
      // Given: a malformed numeric field.

      // When / Then: each non-finite or non-number value is rejected.
      expectInvalidPayload(() => readFiniteNumberField(object, 'value', CHANNEL));
    });

    it('rejects finite numbers outside configured bounds', () => {
      // Given: finite values outside the allowed range.
      const tooSmall = { value: 0 };
      const tooLarge = { value: 11 };

      // When / Then: configured numeric bounds are enforced.
      expectInvalidPayload(() => readFiniteNumberField(tooSmall, 'value', CHANNEL, { min: 1 }));
      expectInvalidPayload(() => readFiniteNumberField(tooLarge, 'value', CHANNEL, { max: 10 }));
    });
  });

  describe('readPositiveIntegerField', () => {
    it('accepts positive integers', () => {
      // Given: an object with a positive integer field.
      const object = { cols: 120 };

      // When: the integer field is read.
      const result = readPositiveIntegerField(object, 'cols', CHANNEL, { max: 10_000 });

      // Then: the integer value is returned unchanged.
      expect(result).toBe(120);
    });

    it.each([
      ['zero', { value: 0 }],
      ['negative', { value: -1 }],
      ['fraction', { value: 1.5 }],
      ['over maximum', { value: 101 }],
    ])('rejects %s positive integer fields', (_label: string, object: Record<string, unknown>) => {
      // Given: a malformed positive integer field.

      // When / Then: only positive integers within bounds are allowed.
      expectInvalidPayload(() => readPositiveIntegerField(object, 'value', CHANNEL, { max: 100 }));
    });
  });

  describe('readStringIdPayload', () => {
    it('reads a bounded id from a payload object', () => {
      // Given: a payload with a valid id field.
      const payload = { id: 'pty-1' };

      // When: the id payload helper is used.
      const result = readStringIdPayload(payload, 'id', CHANNEL);

      // Then: the id is returned.
      expect(result).toBe('pty-1');
    });

    it('rejects ids over the shared id length limit', () => {
      // Given: a payload with an over-limit id.
      const payload = { id: 'x'.repeat(MAX_ID_LENGTH + 1) };

      // When / Then: the id payload helper enforces the shared id limit.
      expectInvalidPayload(() => readStringIdPayload(payload, 'id', CHANNEL));
    });
  });

  it('does not echo arbitrary invalid values in error messages', () => {
    // Given: a malformed payload containing a renderer-controlled string.
    const arbitraryValue = 'renderer-controlled-secret';

    // When: validation fails.
    let error: unknown;
    try {
      readStringField({ id: arbitraryValue }, 'id', CHANNEL, { maxLength: 3 });
    } catch (caughtError: unknown) {
      error = caughtError;
    }

    // Then: the fixed error message names the channel without echoing the value.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(CHANNEL);
    expect((error as Error).message).not.toContain(arbitraryValue);
  });
});
