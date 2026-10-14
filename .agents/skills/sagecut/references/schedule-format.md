# Schedule format

`sagecut/schedule.json` is the one source of timing. The composition imports it. SageCut checks the render against it. Thus, the video and the QA always use the same timing.

Run `sagecut init` to make a skeleton. Run `sagecut check-schedule` after each edit.

## Required fields

| Field | Meaning |
|---|---|
| `film` | The name of the film. |
| `fps` | Frames per second. |
| `frames` | The number of frames (`durationInFrames`). |
| `width`, `height` | The size in pixels. |
| `safe_margin_px` | The margin that text must stay inside. |
| `beats` | A list of beats. |
| `transitions` | A list of transitions. It can be empty. |

## Beat

| Field | Meaning |
|---|---|
| `id` | Unique name. Required. |
| `start`, `end` | First and last frame. Required. `start` is not after `end`. `end` is not after `frames`. |
| `hold` | Optional. A frame, or `[first, last]`. A frame means "from this frame to `end`". It declares an on-purpose still. |
| `order` | Optional. A number for sorting. |
| `elements` | A list of elements. |

## Element

| Field | Meaning |
|---|---|
| `id` | Unique name. Required. |
| `in` | First frame that the element shows. Required. It is inside the beat. |
| `out` | Last frame. Optional. The default is the end of the beat. It is not before `in`. |
| `text` | The text that shows on screen. OCR compares the render with it. The brand copy rules check it. |
| `literal` | Optional. Mark text that OCR must match as written. |
| `role` | `headline`, `body`, `caption` or `url`. It sets the legibility floor for the element. Without a role, the tool uses `url` for web addresses and `caption` for other text. Set a role on each text element. |

An element shows only between `in` and `out`. In Remotion, `<Scheduled id="...">` does this.

## Transition

`{ "from": "<beat id>", "to": "<beat id>", "frames": [first, last] }`

The `frames` pair is the first and last frame of the transition. The QA checks that no frame in it is blank.

## Optional top-level fields

| Field | Meaning |
|---|---|
| `cuts` | Frames where a hard cut is on purpose. The QA skips findings within 2 frames of a cut. |
| `effects` | A list of `{ "kind": "flash" or "glitch", "frames": [first, last] }`. It declares designed flashes and glitches. The QA skips findings inside these frames. |
| `image_regions` | Areas with footage or photos, as boxes. OCR and text checks skip them. |
| `static_holds` | Frame ranges where a frozen image is on purpose. |
| `allow_edge_contact` | `true` (all four sides), `false` or absent (none), or a list such as `["left", "bottom"]`. Use it when an object touches the edge on purpose. Other values are a schedule error. |
| `seams`, `masks`, `decorative`, `interim_cuts` | Extra declarations for advanced use. The tool accepts them. |
| `palette` | Older field. `brand.yaml` takes priority. |

## Tolerance

Triage uses the schedule windows with a tolerance of 15 frames. A flag inside a window (plus or minus 15 frames) of an element, a transition or a hold has an explanation. A flag outside all windows stays on the list for a targeted Sage question.

## Full example

A 10-second video at 30 fps with three beats.

```json
{
  "film": "launch-teaser",
  "fps": 30,
  "frames": 300,
  "width": 1920,
  "height": 1080,
  "safe_margin_px": 96,
  "beats": [
    {
      "id": "hook",
      "start": 0,
      "end": 89,
      "elements": [
        { "id": "hook-headline", "in": 6, "out": 84, "text": "Ship the video, not the retakes" }
      ]
    },
    {
      "id": "proof",
      "start": 90,
      "end": 209,
      "elements": [
        { "id": "proof-number", "in": 100, "out": 200, "text": "Every frame checked" },
        { "id": "proof-caption", "in": 120, "out": 200, "text": "Measured, then read by Sage" }
      ]
    },
    {
      "id": "end",
      "start": 210,
      "end": 299,
      "hold": [240, 299],
      "elements": [
        { "id": "end-url", "in": 216, "text": "example.com" }
      ]
    }
  ],
  "transitions": [
    { "from": "hook", "to": "proof", "frames": [84, 96] },
    { "from": "proof", "to": "end", "frames": [204, 216] }
  ],
  "cuts": [],
  "image_regions": [],
  "static_holds": [[240, 299]]
}
```

## Designed effects

The brand `motion.designed` list does not suppress a finding by itself. The schedule must declare the frames.

| Effect | The QA skips findings in these frames |
|---|---|
| `hard_cut` | 2 frames before and after each `cuts` entry and each transition boundary |
| `flash` | only the frames of a `{ "kind": "flash", "frames": [a, b] }` entry in `effects` |
| `glitch` | only the frames of a `{ "kind": "glitch", "frames": [a, b] }` entry in `effects` |

A transition window alone does not cover a flash or a glitch. Declare each one in `effects`.

## Project settings that touch the schedule

These keys are in `sagecut/sagecut.yaml`:

| Key | Meaning |
|---|---|
| `audio` | `auto` (default), `required` or `none`. With `auto`, a missing audio stream is a warning. Set `none` for a video that is silent by design. |
| `test_width` | Overrides the test width of the brand format. |
| `workers` | Parallel Sage requests. |
| `question_bank` | A project question file. |
| `composition` | The Remotion composition id. |

## Using the schedule in Remotion

1. `init` adds `src/sagecut/useSchedule.ts` with `useBeat(id)` and `<Scheduled id="...">`.
2. Set `"resolveJsonModule": true` in `compilerOptions` of `tsconfig.json`. `init` prints this note. Then the composition can import `sagecut/schedule.json`.
3. `Root.tsx` reads `fps`, `frames`, `width` and `height` from the schedule.
4. Do not type frame numbers in the composition. Read them from the schedule.
5. On-screen numbers about the QA stay as placeholders until `sagecut/qa/numbers.json` exists.
