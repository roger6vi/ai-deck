export function buildPlugin(
  pluginDirectory?: string,
  build?: (outputDirectory: string) => Promise<void>,
): Promise<void>;
