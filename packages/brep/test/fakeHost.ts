// A host for the tests: files in memory, kept as the bytes that were written,
// so a binary STL comes back as it went in.
import type { FileOps } from "gui-chat-protocol";
import type { BrepExecuteContext } from "../src/core/plugin";

export function memoryFiles(): FileOps & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const get = (rel: string): Uint8Array => {
    const content = files.get(rel);
    if (content === undefined) throw new Error(`no such file: ${rel}`);
    return content;
  };
  return {
    files,
    read: async (rel) => new TextDecoder().decode(get(rel)),
    readBytes: async (rel) => get(rel),
    async write(rel, content) {
      files.set(
        rel,
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      );
    },
    readDir: async (rel) =>
      [...files.keys()].filter((key) => key.startsWith(`${rel}/`)),
    stat: async (rel) => ({ mtimeMs: 0, size: get(rel).length }),
    exists: async (rel) => files.has(rel),
    async unlink(rel) {
      files.delete(rel);
    },
  };
}

export function fakeHost() {
  const artifacts = memoryFiles();
  const context: BrepExecuteContext = { files: { artifacts } };
  return { artifacts, context };
}
