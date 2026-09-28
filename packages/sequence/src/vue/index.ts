// The Vue entry: the three tools with their Views. The Views fit the whole
// picture on the screen, as a slide or a panel should be seen (ui-image's
// ImageView, which generateImage's View uses, fits a wide picture to the
// width and scrolls), with a panel's caption and choices under it. An HTML
// slide is fitted the same way, as a sandboxed page.
import "../style.css";

import {
  defineComponent,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  type PropType,
} from "vue";
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
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  slideHtmlDocument,
  type CastData,
  type SlideData,
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

/** An HTML slide: its page at 1280x720, scaled to fit the View. The iframe
 *  is sandbox="allow-scripts" without allow-same-origin: the page is
 *  model-written, so it gets an opaque origin, and its own CSP
 *  (slideHtmlDocument) stops it sending anything out. */
const HtmlSlide = defineComponent({
  name: "HtmlSlide",
  props: { html: { type: String, required: true } },
  setup(props) {
    const box = ref<HTMLElement | null>(null);
    const scale = ref(0);
    let observer: ResizeObserver | undefined;
    const fit = () => {
      const el = box.value;
      if (!el) return;
      scale.value = Math.min(
        el.clientWidth / SLIDE_WIDTH,
        el.clientHeight / SLIDE_HEIGHT,
      );
    };
    onMounted(() => {
      fit();
      observer = new ResizeObserver(fit);
      if (box.value) observer.observe(box.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    return () =>
      h(
        "div",
        {
          ref: box,
          class: "flex-1 min-h-0 w-full relative overflow-hidden",
        },
        // Not before it is sized: the slide's animations start when it loads.
        scale.value > 0
          ? [
              h("iframe", {
                srcdoc: slideHtmlDocument(props.html),
                sandbox: "allow-scripts",
                title: "slide",
                width: SLIDE_WIDTH,
                height: SLIDE_HEIGHT,
                class: "absolute border-0 bg-white shadow",
                style: {
                  left: "50%",
                  top: "50%",
                  transform: `translate(-50%, -50%) scale(${scale.value})`,
                },
              }),
            ]
          : [],
      );
  },
});

const ImageSlideView = fittedImageView("PresentSlideImageView");

const PresentSlideView = markRaw(
  defineComponent({
    name: "PresentSlideView",
    props: {
      selectedResult: {
        type: Object as PropType<ToolResult<SlideData>>,
        required: true,
      },
    },
    setup(props) {
      return () => {
        const html = props.selectedResult.data?.html;
        if (!html) {
          return h(ImageSlideView, {
            selectedResult:
              props.selectedResult as unknown as ImageResult<ImageToolData>,
          });
        }
        // Keyed by the result, so another slide is a new page and its
        // animations play again.
        return h(
          "div",
          { class: "h-full w-full flex flex-col bg-slate-100 p-2" },
          [
            h(HtmlSlide, {
              key: props.selectedResult.uuid ?? html,
              html,
            }),
          ],
        );
      };
    },
  }),
);

const PresentSlidePreview = markRaw(
  defineComponent({
    name: "PresentSlidePreview",
    props: {
      result: {
        type: Object as PropType<ToolResult<SlideData>>,
        required: true,
      },
    },
    setup(props) {
      return () => {
        const data = props.result.data;
        if (!data?.html) {
          return h(ImagePreview, {
            result: props.result as unknown as ImageResult<ImageToolData>,
          });
        }
        return h(
          "div",
          {
            class:
              "aspect-video w-full rounded bg-gradient-to-br from-indigo-600 to-sky-500 text-white flex flex-col items-center justify-center p-2 text-center",
          },
          [
            h(
              "div",
              { class: "text-xs opacity-80" },
              `Slide ${data.slide} of ${data.totalSlides}`,
            ),
            h(
              "div",
              { class: "text-sm font-semibold leading-tight line-clamp-2" },
              data.title || props.result.title || "",
            ),
          ],
        );
      };
    },
  }),
);

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
  viewComponent: PresentSlideView,
  previewComponent: PresentSlidePreview,
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
