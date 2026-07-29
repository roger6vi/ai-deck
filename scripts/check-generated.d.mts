export const GENERATED_OUTPUTS: readonly string[];

export interface GeneratedStatusClassification {
  isAcceptable: boolean;
  driftedOutputs: string[];
}

export function classifyGeneratedStatus(status: readonly string[]): GeneratedStatusClassification;
export function assertGeneratedState(status: readonly string[]): void;
export function assertGeneratedArtifacts(projectRoot?: string): Promise<void>;
