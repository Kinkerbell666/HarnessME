interface TextChunk {
  content: string;
  index: number;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 50;

export const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".toml",
  ".ts", ".js", ".py", ".go", ".rs",
  ".html", ".xml", ".css",
  ".sh", ".sql", ".env", ".cfg", ".ini", ".log",
]);

/**
 * Check if a filename has an allowed extension for KB ingestion.
 */
export function isAllowedFile(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return false;
  return ALLOWED_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

/**
 * Split text into overlapping chunks with newline-aware boundaries.
 *
 * Strategy: try to break at a newline if one exists after 50% of the chunk.
 * Otherwise, break at chunk size. Adjacent chunks share `overlap` characters.
 */
export function chunkText(
  text: string,
  opts?: { chunkSize?: number; overlap?: number },
): TextChunk[] {
  const chunkSize = opts?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = opts?.overlap ?? DEFAULT_OVERLAP;

  if (text.length <= chunkSize) {
    return [{ content: text, index: 0 }];
  }

  const chunks: TextChunk[] = [];
  let offset = 0;
  let index = 0;

  while (offset < text.length) {
    let end = Math.min(offset + chunkSize, text.length);

    // If not at the end, try to break at a newline after 50% of the chunk
    if (end < text.length) {
      const halfPoint = offset + Math.floor(chunkSize / 2);
      const segment = text.slice(halfPoint, end);
      const newlineIdx = segment.lastIndexOf("\n");
      if (newlineIdx !== -1) {
        end = halfPoint + newlineIdx + 1; // include the newline
      }
    }

    chunks.push({ content: text.slice(offset, end), index });
    index++;
    // This chunk already holds the tail; another pass would only emit
    // slivers of it.
    if (end === text.length) break;

    // Advance by (chunk length - overlap), but at least 1 character
    const advance = Math.max(end - offset - overlap, 1);
    offset += advance;
  }

  return chunks;
}
