export interface InstallOpenCodeAdapterOptions {
  readonly source?: string;
  readonly targetDirectory?: string;
}

export function installOpenCodeAdapter(options?: InstallOpenCodeAdapterOptions): string;
