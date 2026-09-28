// The Vue entry: the three tools with their Views. The Views fit the whole
// picture on the screen, as a slide or a panel should be seen (ui-image's
// ImageView, which generateImage's View uses, fits a wide picture to the
// width and scrolls), with a panel's caption and choices under it.
import "../style.css";

import { defineComponent, h, markRaw, type PropType } from "vue";
import type { ToolPlugin, ToolResult } from "gui-chat-protocol/vue";
import {
  ImagePreview,
  type ImageToolData,
  type ToolResult as ImageResult,
} from "@mulmochat-plugin/ui-image";
import {
  defineStoryboardPluginCore,
  presentPanelPluginCore,
  presentSlidePluginCore,
  type CastData,
} from "../core/index";

/** What a View shows under the picture. */
interface ImageFooter {
  caption?: string;
  /** A story's choices, numbered, for the user to pick by voice. */
  choices?: string[];
}

function footer({ caption, choices }: ImageFooter) {
  const children = [];
  if (caption) {
    children.push(
      h("p", { class: "text-center text-lg text-gray-800 px-4" }, caption),
    );
  }
  if (choices?.length) {
    children.push(
      h(
        "ol",
        { class: "flex flex-wrap justify-center gap-3 px-4" },
        choices.map((choice, i) =>
          h(
            "li",
            {
              class:
                "rounded-full bg-indigo-600 text-white text-xl px-5 py-2 font-medium",
            },
            `${i + 1}. ${choice}`,
          ),
        ),
      ),
    );
  }
  return children.length
    ? h("div", { class: "flex flex-col gap-2 pb-2" }, children)
    : null;
}

/** A View that fits the whole picture, with an optional footer. */
function fittedImageView(
  name: string,
  footerOf: (data: Record<string, unknown>) => ImageFooter = () => ({}),
) {
  return markRaw(
    defineComponent({
      name,
      props: {
        selectedResult: {
          type: Object as PropType<ImageResult<ImageToolData>>,
          required: true,
        },
      },
      setup(props) {
        return () => {
          const data = props.selectedResult.data;
          if (!data?.imageData) return h("div", { class: "h-full bg-white" });
          return h(
            "div",
            { class: "h-full w-full flex flex-col bg-white p-2 gap-2" },
            [
              h(
                "div",
                { class: "flex-1 min-h-0 flex items-center justify-center" },
                [
                  h("img", {
                    src: data.imageData,
                    alt: data.prompt ?? "",
                    class: "max-w-full max-h-full object-contain",
                  }),
                ],
              ),
              footer(footerOf(data as unknown as Record<string, unknown>)),
            ],
          );
        };
      },
    }),
  );
}

/** ui-image's thumbnail of the result's picture. */
function imagePreview(name: string) {
  return markRaw(
    defineComponent({
      name,
      props: {
        result: {
          type: Object as PropType<ImageResult<ImageToolData>>,
          required: true,
        },
      },
      setup(props) {
        return () => h(ImagePreview, { result: props.result });
      },
    }),
  );
}

const CastView = markRaw(
  defineComponent({
    name: "StoryboardCastView",
    props: {
      selectedResult: {
        type: Object as PropType<ToolResult<CastData>>,
        required: true,
      },
    },
    setup(props) {
      return () => {
        const data = props.selectedResult.data;
        const characters = data?.characters ?? [];
        return h("div", { class: "h-full w-full flex flex-col bg-white p-4" }, [
          h(
            "h2",
            { class: "text-center text-xl font-semibold text-gray-800 mb-3" },
            data?.title ?? "",
          ),
          h(
            "div",
            {
              class: `flex-1 min-h-0 grid gap-3 ${characters.length > 1 ? "grid-cols-2" : "grid-cols-1"} auto-rows-fr`,
            },
            characters.map((character) =>
              h("figure", { class: "min-h-0 flex flex-col items-center" }, [
                character.imageData
                  ? h("img", {
                      src: character.imageData,
                      alt: character.name,
                      class: "flex-1 min-h-0 max-w-full object-contain",
                    })
                  : h("div", { class: "flex-1" }),
                h(
                  "figcaption",
                  { class: "text-lg text-gray-800 mt-1" },
                  character.name,
                ),
              ]),
            ),
          ),
        ]);
      };
    },
  }),
);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

type SequencePlugin = ToolPlugin<unknown, unknown, Record<string, unknown>>;

export const presentSlidePlugin: SequencePlugin = {
  ...presentSlidePluginCore,
  viewComponent: fittedImageView("PresentSlideView"),
  previewComponent: imagePreview("PresentSlidePreview"),
};

export const defineStoryboardPlugin: SequencePlugin = {
  ...defineStoryboardPluginCore,
  viewComponent: CastView,
  previewComponent: imagePreview("StoryboardCastPreview"),
};

export const presentPanelPlugin: SequencePlugin = {
  ...presentPanelPluginCore,
  viewComponent: fittedImageView("PresentPanelView", (data) => ({
    caption: typeof data.caption === "string" ? data.caption : "",
    choices: strings(data.choices),
  })),
  previewComponent: imagePreview("PresentPanelPreview"),
};

/** All three, as a host registers them. */
export const plugins: SequencePlugin[] = [
  presentSlidePlugin,
  defineStoryboardPlugin,
  presentPanelPlugin,
];

export * from "../core/index";
