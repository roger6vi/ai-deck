export interface PackPluginOptions {
  readonly source?: string;
  readonly stage?: string;
  readonly archive?: string;
  readonly pack?: (stage: string) => Promise<void>;
  readonly validate?: () => Promise<void>;
  readonly remove?: (path: string, options: { readonly force: true; readonly recursive?: true }) => Promise<void> | void;
}

export function packPlugin(options?: PackPluginOptions): Promise<void>;
export function runStreamDeckPack(stage: string, command?: string): Promise<void>;
