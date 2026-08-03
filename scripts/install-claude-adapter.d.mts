export const CLAUDE_HOOK_EVENTS: readonly string[];

export interface InstallClaudeAdapterOptions {
  readonly pluginRoot?: string;
  readonly settingsPath?: string;
  readonly nodeBinary?: string;
}

export function installClaudeAdapter(options?: InstallClaudeAdapterOptions): string;
