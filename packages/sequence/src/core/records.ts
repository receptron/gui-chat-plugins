// The slideshow and storyboard records: artifacts/slideshows/<id>.json and
// artifacts/storyboards/<id>.json, with their pictures' paths in
// artifacts/images/, so a slideshow or a story outlives the session and can
// become a movie (MulmoChat's makeMovie reads them).
//
// Read once, then kept in memory, per host workspace (FileOps). Changes to a
// record are made one at a time, from loading it to writing it: two steps
// drawn at once would otherwise each write their own copy, and the later
// write could drop the other's entry.
import {
  createSerialLock,
  type FileOps,
  type SerialLock,
} from "gui-chat-protocol";
import { SEQUENCE_ID, type Slideshow, type Storyboard } from "./definitions";

export const SLIDESHOWS_DIR = "slideshows";
export const STORYBOARDS_DIR = "storyboards";

type SequenceRecord = Slideshow | Storyboard;

// Keyed by the host's FileOps, or by NO_FILES for a host that gives the
// tools no files: its records are kept in memory only, so a story still goes
// on (the results say they weren't saved).
const NO_FILES = {};
type Store = FileOps | typeof NO_FILES;

const caches = new WeakMap<Store, Map<string, SequenceRecord>>();
const locks = new WeakMap<Store, Map<string, SerialLock>>();

function cacheOf(files: Store): Map<string, SequenceRecord> {
  let cache = caches.get(files);
  if (!cache) caches.set(files, (cache = new Map()));
  return cache;
}

function lockOf(files: Store, file: string): SerialLock {
  let byFile = locks.get(files);
  if (!byFile) locks.set(files, (byFile = new Map()));
  let lock = byFile.get(file);
  if (!lock) byFile.set(file, (lock = createSerialLock()));
  return lock;
}

const recordFile = (dir: string, id: string) => `${dir}/${id}.json`;

async function readRecord<T extends SequenceRecord>(
  files: FileOps | undefined,
  file: string,
): Promise<T | null> {
  const cache = cacheOf(files ?? NO_FILES);
  const cached = cache.get(file);
  // The caller asked for the directory the record was saved in.
  if (cached) return cached as T;
  if (!files) return null;
  try {
    const saved = JSON.parse(await files.read(file)) as T;
    cache.set(file, saved);
    return saved;
  } catch {
    return null;
  }
}

/** A saved slideshow or storyboard, or null. `id` is checked first, so a
 *  model-written ID can't name another file. */
export async function loadRecord<T extends SequenceRecord>(
  files: FileOps | undefined,
  dir: string,
  id: string,
): Promise<T | null> {
  if (!SEQUENCE_ID.test(id)) return null;
  return readRecord<T>(files, recordFile(dir, id));
}

/**
 * Change a record (null when there is none yet) and save it. Resolves to
 * whether it was saved: one that wasn't (no files, or the write failed)
 * still works while the host runs, and the result says so, as for a picture
 * that wasn't saved.
 */
export async function updateRecord<T extends SequenceRecord>(
  files: FileOps | undefined,
  dir: string,
  id: string,
  change: (record: T | null) => T,
): Promise<boolean> {
  const file = recordFile(dir, id);
  const store = files ?? NO_FILES;
  return lockOf(
    store,
    file,
  )(async () => {
    const record = change(await readRecord<T>(files, file));
    cacheOf(store).set(file, record);
    if (!files) return false;
    try {
      await files.write(file, JSON.stringify(record, null, 2));
      return true;
    } catch (error) {
      console.warn("[sequence] could not save", file, error);
      return false;
    }
  });
}

export const NOT_SAVED = (what: string): string =>
  `the ${what} could not be saved, so it lasts only until the app or server restarts`;
