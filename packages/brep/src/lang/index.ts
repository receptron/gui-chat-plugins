import { createUseT } from "gui-chat-protocol/vue";
import type { Messages } from "./messages";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;

/** The messages for the host's locale, English where there is no translation.
 *  The plugin carries its own: it reads the locale off the injected runtime. */
export const useT = createUseT(MESSAGES);

export type { Messages };
