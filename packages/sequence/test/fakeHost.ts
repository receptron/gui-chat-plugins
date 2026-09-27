// A host for the tests: files in memory, and an image backend that "draws"
// by naming a saved picture, and records what it was asked for.
import type { FileOps, ToolResult } from "gui-chat-protocol";
import type { SequenceContext } from "../src/core/host";

export function memoryFiles(): FileOps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const missing = (rel: string) => new Error(`no such file: ${rel}`);
  return {
    files,
    async read(rel) {
      const content = files.get(rel);
      if (content === undefined) throw missing(rel);
      return content;
    },
    async readBytes(rel) {
      const content = files.get(rel);
      if (content === undefined) throw missing(rel);
      return new TextEncoder().encode(content);
    },
    async write(rel, content) {
      files.set(
        rel,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content),
      );
    },
    async readDir(rel) {
      return [...files.keys()].filter((k) => k.startsWith(`${rel}/`));
    },
    async stat(rel) {
      return { mtimeMs: 0, size: files.get(rel)?.length ?? 0 };
    },
    async exists(rel) {
      return files.has(rel);
    },
    async unlink(rel) {
      files.delete(rel);
    },
  };
}

export interface DrawCall {
  prompt: string;
  references: string[];
}

export function fakeHost(
  options: { editImages?: boolean; fail?: () => boolean } = {},
) {
  const artifacts = memoryFiles();
  const calls: DrawCall[] = [];
  let count = 0;
  const draw = async (
    prompt: string,
    references: string[],
  ): Promise<ToolResult> => {
    calls.push({ prompt, references });
    if (options.fail?.())
      return { message: "image generation failed: refused" };
    const rel = `images/2026/09/picture${++count}.png`;
    await artifacts.write(rel, "png");
    const imagePath = `artifacts/${rel}`;
    return {
      message: `image generation succeeded; saved to ${imagePath}`,
      data: { imageData: `data:image/png;base64,${count}`, imagePath, prompt },
    };
  };
  const context = (extra: Partial<SequenceContext> = {}): SequenceContext => ({
    app: {
      getConfig: () => undefined,
      setConfig: () => undefined,
      generateImage: (prompt: string) => draw(prompt, []),
      ...(options.editImages !== false && {
        editImages: (prompt: string, paths: string[]) => draw(prompt, paths),
      }),
    },
    files: { artifacts },
    ...extra,
  });
  return { artifacts, calls, context };
}

/** A JSON record saved by the tools. */
export const record = (
  artifacts: ReturnType<typeof memoryFiles>,
  file: string,
): Record<string, unknown> => JSON.parse(artifacts.files.get(file) ?? "null");
