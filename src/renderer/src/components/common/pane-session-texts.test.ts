import { describe, expect, it } from 'vite-plus/test';
import type { PaneRuntimeInfo } from '../../../../shared/types';
import { getPaneSessionTexts } from './pane-session-texts';

function info(overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return {
    ptyId: 'pty-1',
    processActivity: 'running',
    foregroundSession: { kind: 'other' },
    integration: {
      shell: false,
      protocols: [],
      lastSequenceAt: 0,
      stale: false,
    },
    observedAt: 1000,
    ...overrides,
  };
}

describe('getPaneSessionTexts', () => {
  it('returns nothing when the pane has no info', () => {
    // Given / When / Then: a pane without runtime info renders neither row.
    expect(getPaneSessionTexts(undefined)).toEqual({});
  });

  it('returns both rows when the title and prompt differ', () => {
    // Given: a session whose title summarizes it and whose prompt is the latest turn.
    const paneInfo = info({ sessionTitle: 'Fix lint config', userPrompt: 'Now run the tests' });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: both are rendered.
    expect(texts).toEqual({ sessionTitle: 'Fix lint config', userPrompt: 'Now run the tests' });
  });

  it('returns only the row that is present', () => {
    // Given / When / Then: a missing field leaves its row out without affecting the other one.
    expect(getPaneSessionTexts(info({ userPrompt: 'Fix the tests' }))).toEqual({
      sessionTitle: undefined,
      userPrompt: 'Fix the tests',
    });
    expect(getPaneSessionTexts(info({ sessionTitle: 'Fix the tests' }))).toEqual({
      sessionTitle: 'Fix the tests',
      userPrompt: undefined,
    });
  });

  it('drops the prompt when it repeats the title', () => {
    // Given: a provisional title copied from the first message of the session.
    const paneInfo = info({ sessionTitle: 'Fix the tests', userPrompt: 'Fix the tests' });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: only the title row is rendered.
    expect(texts).toEqual({ sessionTitle: 'Fix the tests' });
  });

  it('treats a prompt that differs from the title only in whitespace as a repeat', () => {
    // Given: a multi-line prompt and its title flattened to one line.
    const paneInfo = info({
      sessionTitle: 'Fix three things: 1. lint 2. tests',
      userPrompt: '  Fix three things:\n1. lint\n2.  tests\n',
    });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: only the title row is rendered.
    expect(texts).toEqual({ sessionTitle: 'Fix three things: 1. lint 2. tests' });
  });

  it('drops a long prompt when the title is its truncated start', () => {
    // Given: a first message longer than the provisional title limit, which Codex cuts at 59
    // characters and ends with `…`.
    const prompt =
      'Reorganize the lint rules so the config stops fighting Prettier and the CI job passes again';
    const paneInfo = info({
      sessionTitle: 'Reorganize the lint rules so the config stops fighting…',
      userPrompt: prompt,
    });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: only the title row is rendered.
    expect(texts).toEqual({
      sessionTitle: 'Reorganize the lint rules so the config stops fighting…',
    });
  });

  it('drops the prompt when the title is its plain-text rendering', () => {
    // Given: a markdown message whose provisional title lost the syntax and line breaks.
    const paneInfo = info({
      sessionTitle: 'Fix pnpm test failures in parser.ts',
      userPrompt: 'Fix `pnpm test` failures in **parser.ts**',
    });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: only the title row is rendered.
    expect(texts).toEqual({ sessionTitle: 'Fix pnpm test failures in parser.ts' });
  });

  it('keeps the prompt when an untruncated title is only its start', () => {
    // Given: a generated title that happens to match the beginning of the prompt.
    const paneInfo = info({
      sessionTitle: 'Fix the tests',
      userPrompt: 'Fix the tests in the parser module',
    });

    // When: the rows are resolved.
    const texts = getPaneSessionTexts(paneInfo);

    // Then: without a truncation marker the title is not treated as a cut prompt.
    expect(texts.userPrompt).toBe('Fix the tests in the parser module');
  });

  it('keeps the prompt when a truncated title does not match its start', () => {
    // Given: a cut title from a different message than the latest prompt.
    const paneInfo = info({
      sessionTitle: 'Reorganize the lint rules so the config stops fighting…',
      userPrompt: 'Now run the tests',
    });

    // When / Then: both rows are rendered.
    expect(getPaneSessionTexts(paneInfo).userPrompt).toBe('Now run the tests');
  });

  it('keeps the prompt when the title has no letters or digits to compare', () => {
    // Given: a title made only of punctuation, which would match any prompt as an empty prefix.
    const paneInfo = info({ sessionTitle: '…', userPrompt: 'Fix the tests' });

    // When / Then: both rows are rendered.
    expect(getPaneSessionTexts(paneInfo).userPrompt).toBe('Fix the tests');
  });
});
