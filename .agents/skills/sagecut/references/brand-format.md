# Brand file format

Each project has one brand file: `sagecut/brand.yaml`. The build and the QA both read it. `sagecut brand set` checks it and writes `src/brand.ts` and the font files.

## Fields

| Field | Contents |
|---|---|
| `name` | The brand name. A riff uses `riff-<idea>`. Required. |
| `colors.background` | Background colour, `#RRGGBB`. Required. |
| `colors.text` | Text colour, `#RRGGBB`. Required. |
| `colors.primary` | Primary colour, `#RRGGBB`. Required. |
| `colors.accent` | List of accent colours, `#RRGGBB`. |
| `colors.allowed` | List of other allowed colours, `#RRGGBB`. The QA reports colours outside the full palette. |
| `fonts.heading` | `family` (required), `file`, `weights`. |
| `fonts.body` | `family`, `file`, `weights`. |
| `fonts.mono` | `family`, `file`, `weights`. |
| `logo.files` | List of logo files. SVG is best. A riff has no logo. |
| `logo.min_px` | Smallest allowed logo width. |
| `logo.clear_space` | Free space around the logo. |
| `type.headline_px`, `type.body_px`, `type.caption_px` | Text sizes at 1080 px wide. They can be larger than the house floors. Never smaller. |
| `motion.style` | `restrained` or `energetic`. |
| `motion.designed` | List of effects that are part of the design: `flash`, `hard_cut`, `glitch`. The brand alone suppresses nothing. The QA skips a finding only inside frames that the schedule declares (see below). |
| `copy.case` | Capitalisation rule, for example `sentence`, `title` or `upper`. |
| `copy.avoid` | List of words to avoid. |
| `copy.grammar` | Grammar style, for example `proper` or `casual`. |
| `format` | `16:9`, `9:16` or `1:1`. It sets the test width (350, 210 and 375 px). |
| `source.kind` | `website`, `folder`, `questions` or `riff`. |
| `source.ref` | The URL, the folder path or the idea. |

All hex values use six digits with a leading `#`. A value such as `#fff` is not valid.

## Full example

```yaml
name: acme-labs
colors:
  background: "#0B0D12"
  text: "#F4F1EA"
  primary: "#3D5AFE"
  accent:
    - "#FFB020"
    - "#7CE0C3"
  allowed:
    - "#1A1E29"
fonts:
  heading:
    family: Inter
    file: public/fonts/Inter-Bold.woff2
    weights: [600, 700]
  body:
    family: Inter
    file: public/fonts/Inter-Regular.woff2
    weights: [400, 500]
  mono:
    family: JetBrains Mono
    file: public/fonts/JetBrainsMono-Regular.woff2
    weights: [400]
logo:
  files:
    - sagecut/brand-assets/logo.svg
  min_px: 120
  clear_space: 24
type:
  headline_px: 88
  body_px: 48
  caption_px: 34
motion:
  style: restrained
  designed: [hard_cut]
copy:
  case: sentence
  avoid: [revolutionary, game-changing]
  grammar: proper
format: "16:9"
source:
  kind: website
  ref: https://example.com
```

## Designed effects

`motion.designed` says which effects the brand allows. The schedule says where they happen. The QA skips a finding only inside frames that `schedule.json` declares. A designed hard cut covers 2 frames before and after each `cuts` entry and each transition boundary. A designed flash or glitch covers only the frames of its entry in `effects`. Declare each designed cut, flash and glitch in the schedule. See `schedule-format.md`.

## Fonts in the build

`src/brand.ts` imports `@remotion/fonts`. After `sagecut brand set`, if the project does not have it, run `npx remotion add @remotion/fonts`.

## Order of authority

1. The house rules are the floor: legibility sizes, the delivery spec and frame quality. A brand cannot go below the floor.
2. The brand decides everything above the floor: colours, fonts, motion style and tone.
3. If a brand choice breaks a floor, the QA reports it with the measurement. An example is a thin brand font at a small size. The user then decides.

## How the build uses the brand

1. `sagecut brand set` writes `src/brand.ts` from `brand.yaml`.
2. Each composition imports its colours and fonts from `src/brand.ts`. No colour is hard-coded.
3. The fonts go into `public/fonts/`. A headless render cannot load web fonts.

## How the QA uses the brand

| Test | Method |
|---|---|
| Colours outside the brand palette in text and interface areas | Measurement on every frame. |
| A stretched logo | The shape of the rendered logo is compared with the source file. |
| Copy rules | A text check on the schedule before the render. No Sage cost. |
| Effects that are part of the design | `motion.designed` and the frames in the schedule together. The QA skips a finding only inside declared frames. |
| On brand or off brand | A Sage question with the style words of the brand. The control is a frame with colours outside the brand. |
| The critics | They use `brand.yaml` as their rubric, with the house rules. |

## Ways to make a brand

| Source | Command | Notes |
|---|---|---|
| Website | `sagecut brand from-url <URL>` | Writes `sagecut/brand.draft.yaml` and downloads the logo files. It is a draft only. Show it to the user. |
| Brand kit folder | `sagecut brand from-folder <PATH>` | Reads logo, font, guide and token files that it can parse. It is a draft only. |
| Five questions | Claude writes the draft | Ask for colours, font, logo, motion style and format. |
| Riff | Claude writes the draft | See the riff rules below. |
| Saved brand | `sagecut brand use <NAME>` | Loads a brand from `~/.sagecut/brands/`. |

After the user approves a draft, run `sagecut brand set sagecut/brand.draft.yaml`. The user must have the right to use the brand files for the website and folder choices. Ask for this before you save.

## Riff rules

A riff is a new style from an idea of the user: a brand, a film, a game, a decade, a place or a mood.

1. Make 3 directions. Each has a palette, a font pair, a motion style and one line.
2. Show the 3 directions with AskUserQuestion. Put the hex values, the fonts and the motion style in the preview.
3. A riff takes the mood of its idea. It does not copy the logo, the name or the exact palette of another company.
4. Riff fonts have an open licence, for example the SIL Open Font License. `brand set` puts the font files in `public/fonts/`.
5. A riff has no logo. Use type and shape for identity.
6. Use the name `riff-<idea>`, in lower case, with hyphens. Set `source.kind: riff` and put the idea in `source.ref`.
7. Check contrast: text on background must be easy to read at the test width. Choose a text colour with strong contrast to the background.
8. Show the result as hex values, fonts and motion style before you save it.

### Riff example

```yaml
name: riff-90s-arcade
colors:
  background: "#120B24"
  text: "#FFF7E0"
  primary: "#FF3D81"
  accent:
    - "#27F0E0"
    - "#FFD23F"
fonts:
  heading:
    family: Press Start 2P
    weights: [400]
  body:
    family: Space Grotesk
    weights: [400, 600]
type:
  headline_px: 72
  body_px: 44
  caption_px: 32
motion:
  style: energetic
  designed: [flash, glitch]
copy:
  case: upper
  avoid: []
  grammar: casual
format: "9:16"
source:
  kind: riff
  ref: 90s arcade
```

Note: a pixel font at a small size can break the legibility floors. Keep it for the headline and use a plain font for the body.
