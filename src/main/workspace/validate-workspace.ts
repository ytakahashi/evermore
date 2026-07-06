import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from '../../shared/pane-layout-constants';
import type { Pane, PaneLayout, Tab, Workspace } from '../../shared/types';
import {
  MAX_COMMAND_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PATH_LENGTH,
  assertIpcPayloadValid,
  readBooleanField,
  readFiniteNumberField,
  readNullableStringField,
  readObject,
  readOptionalStringField,
  readStringField,
} from '../ipc/validation';

export const MAX_WORKSPACE_TABS = 100;
export const MAX_WORKSPACE_PANES = 256;
export const MAX_LAYOUT_DEPTH = 32;

interface LayoutReadResult {
  layout: PaneLayout;
  paneIds: Set<string>;
}

function readArrayField(
  object: Record<string, unknown>,
  key: string,
  channel: string,
  minLength: number,
  maxLength: number,
): unknown[] {
  const value = object[key];
  assertIpcPayloadValid(
    channel,
    Object.hasOwn(object, key) &&
      Array.isArray(value) &&
      value.length >= minLength &&
      value.length <= maxLength,
  );
  return value;
}

function readNameField(object: Record<string, unknown>, key: string, channel: string): string {
  const name = readStringField(object, key, channel, { maxLength: MAX_NAME_LENGTH });
  assertIpcPayloadValid(channel, name.trim().length > 0);
  return name;
}

function readPane(value: unknown, channel: string): Pane {
  const object = readObject(value, channel);
  const ptyId = readOptionalStringField(object, 'ptyId', channel, { maxLength: MAX_ID_LENGTH });
  const initialCommand = readOptionalStringField(object, 'initialCommand', channel, {
    maxLength: MAX_COMMAND_LENGTH,
  });

  return {
    id: readStringField(object, 'id', channel, { maxLength: MAX_ID_LENGTH }),
    cwd: readStringField(object, 'cwd', channel, {
      allowEmpty: true,
      maxLength: MAX_PATH_LENGTH,
    }),
    ...(ptyId !== undefined ? { ptyId } : {}),
    ...(initialCommand !== undefined ? { initialCommand } : {}),
  };
}

function readLayout(
  value: unknown,
  channel: string,
  depth: number,
  workspacePaneIds: Set<string>,
  usedPaneIds: Set<string>,
): LayoutReadResult {
  assertIpcPayloadValid(channel, depth <= MAX_LAYOUT_DEPTH);
  const object = readObject(value, channel);
  const type = readStringField(object, 'type', channel);

  if (type === 'leaf') {
    const paneId = readStringField(object, 'paneId', channel, { maxLength: MAX_ID_LENGTH });
    assertIpcPayloadValid(channel, workspacePaneIds.has(paneId) && !usedPaneIds.has(paneId));
    usedPaneIds.add(paneId);
    return {
      layout: { type: 'leaf', paneId },
      paneIds: new Set([paneId]),
    };
  }

  assertIpcPayloadValid(channel, type === 'split');
  const directionValue = readStringField(object, 'direction', channel);
  assertIpcPayloadValid(channel, directionValue === 'horizontal' || directionValue === 'vertical');
  const direction: 'horizontal' | 'vertical' =
    directionValue === 'horizontal' ? 'horizontal' : 'vertical';
  const ratio = readFiniteNumberField(object, 'ratio', channel, {
    min: MIN_SPLIT_RATIO,
    max: MAX_SPLIT_RATIO,
  });
  const children = readArrayField(object, 'children', channel, 2, 2);
  const first = readLayout(children[0], channel, depth + 1, workspacePaneIds, usedPaneIds);
  const second = readLayout(children[1], channel, depth + 1, workspacePaneIds, usedPaneIds);

  return {
    layout: {
      type: 'split',
      direction,
      ratio,
      children: [first.layout, second.layout],
    },
    paneIds: new Set([...first.paneIds, ...second.paneIds]),
  };
}

function readTab(
  value: unknown,
  channel: string,
  workspacePaneIds: Set<string>,
  usedPaneIds: Set<string>,
): Tab {
  const object = readObject(value, channel);
  const layoutResult = readLayout(object['layout'], channel, 0, workspacePaneIds, usedPaneIds);
  const activePaneId = readNullableStringField(object, 'activePaneId', channel, {
    maxLength: MAX_ID_LENGTH,
  });
  assertIpcPayloadValid(channel, activePaneId === null || layoutResult.paneIds.has(activePaneId));

  return {
    id: readStringField(object, 'id', channel, { maxLength: MAX_ID_LENGTH }),
    name: readNameField(object, 'name', channel),
    isCustomName: readBooleanField(object, 'isCustomName', channel),
    layout: layoutResult.layout,
    activePaneId,
  };
}

/**
 * Reads and validates a renderer-sent workspace update, returning only known fields.
 */
export function readWorkspace(value: unknown, channel: string): Workspace {
  const object = readObject(value, channel);
  const paneValues = readArrayField(object, 'panes', channel, 1, MAX_WORKSPACE_PANES);
  const panes = paneValues.map((pane) => readPane(pane, channel));
  const paneIds = new Set(panes.map((pane) => pane.id));
  assertIpcPayloadValid(channel, paneIds.size === panes.length);

  const usedPaneIds = new Set<string>();
  const tabValues = readArrayField(object, 'tabs', channel, 1, MAX_WORKSPACE_TABS);
  const tabs = tabValues.map((tab) => readTab(tab, channel, paneIds, usedPaneIds));
  const tabIds = new Set(tabs.map((tab) => tab.id));
  assertIpcPayloadValid(channel, tabIds.size === tabs.length);
  assertIpcPayloadValid(channel, usedPaneIds.size === paneIds.size);

  const activeTabId = readNullableStringField(object, 'activeTabId', channel, {
    maxLength: MAX_ID_LENGTH,
  });
  assertIpcPayloadValid(channel, activeTabId === null || tabIds.has(activeTabId));

  return {
    id: readStringField(object, 'id', channel, { maxLength: MAX_ID_LENGTH }),
    name: readNameField(object, 'name', channel),
    rootPath: readStringField(object, 'rootPath', channel, {
      allowEmpty: true,
      maxLength: MAX_PATH_LENGTH,
    }),
    tabs,
    panes,
    activeTabId,
    createdAt: readFiniteNumberField(object, 'createdAt', channel, { min: 0 }),
    updatedAt: readFiniteNumberField(object, 'updatedAt', channel, { min: 0 }),
  };
}
