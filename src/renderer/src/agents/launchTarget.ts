/** Home remains distinct from a project opened at the home directory. */
export type LaunchTarget = { kind: 'home' } | { kind: 'project'; rootPath: string };
