interface ProfileFileHandle {
  close(): Promise<void>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  stat(): Promise<{ isFile(): boolean; isSymbolicLink?(): boolean; size: number }>;
}

interface ProfileFileOperations {
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean; size: number }>;
  open(path: string, flags: number): Promise<ProfileFileHandle>;
}

export function validateProfileFile(
  path: string,
  operations?: ProfileFileOperations,
): Promise<void>;
