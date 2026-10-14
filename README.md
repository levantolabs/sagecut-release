# SageCut

House-standard QA for Remotion videos, in your brand, with every frame checked by Sage.

SageCut is a Claude Code plugin. You build your video with Remotion and Claude. SageCut then:

1. measures every frame in code (text size, blank frames, frozen frames, off-brand colours, delivery spec),
2. has the Sage decision model read every frame and answer yes/no questions,
3. sends only the frames it selects to the critics,
4. opens a frame itself only when Sage and a measurement disagree.

It ships with a set of house rules (a quality floor) and reads your brand file for everything above that floor. If you have no brand, it helps you riff on a style.

SageCut does not change your render time. It makes the review step faster and cheaper.

## Install

In Claude Code, run two commands:

```
/plugin marketplace add levantolabs/sagecut-release
/plugin install sagecut@levantolabs
```

Or one command (Claude Code 2.1.275 or later):

```
/plugin install sagecut --marketplace levantolabs/sagecut-release
```

## First run

Type this in Claude Code:

```
/sagecut:start
```

You get the SageCut start screen, a short explainer and a check of your Sage key. Then: "Begin your video work now...". There is no menu and no test video.

At the start of your first video, SageCut asks for your brand (your website, a brand kit folder, five questions, or a riff on something you like). After that, the `qa` skill starts by itself when you render, review or deliver Remotion work.

## Savings after every video

At the end of every video, SageCut shows what it saved:

```
Saved on this video: about $S and T (estimate). SageCut: $X in Y (measured).
Opus critics viewing the same N frames: about $O in P (estimate at the rate measured on Levanto's reference build, Claude API list prices).
```

SageCut's side is measured: the Sage cost (text and image tokens at your plan's rate), the critics' cost and the QA time. The Opus side is an estimate: $0.101 and 8.6 s per frame viewed, the rate of the 15 Opus 5.5 critics on Levanto's reference build (1,009 frame views (358 distinct frames), $101.96, 2.41 h). `sagecut savings show` gives the totals.

## Requirements

- Claude Code.
- Node 18 or later.
- A Remotion 4 project. If you have none, SageCut can make one with `npx create-video@latest` at the start of your first video.
- A Sage API key from [levanto.ai](https://levanto.ai). Put it in your project's `.env` file as `SAGE_API_KEY=...`, or in `~/.sagecut/.env` to use one key in all your projects. Never paste it in the chat.

SageCut needs no Python, no separate ffmpeg and no OCR program. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node. It works on macOS, Linux and Windows (x64).

## Who this is for

- People who already make Remotion videos, and want a house-rules check on each render.
- People new to Remotion can start with `/sagecut:start`. SageCut can create a project at the start of the first video. You still need to know what a Remotion composition is. The schedule file describes the timing of that composition.

## Not supported in 0.3

- **Camera footage.** SageCut 0.3 is tested on motion graphics only. It is not tested on camera footage. The frozen-frame and colour checks may behave differently on camera footage.

## What is in the box

| Part | What it does |
|---|---|
| `/sagecut:start` | Start screen, short explainer and the Sage key check. |
| `qa` skill | The project and brand step before the first video, the QA workflow, the house rules and the savings line after every video. Starts on Remotion render and review work. |
| `bin/sagecut.mjs` | The tool: `doctor`, `brand`, `init`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline` (optional: a rate from your own video), `numbers`, `deliver-check`, `splice`. |

## Privacy

- Every frame of a checked video goes to the Sage API at levanto.ai for reading. Nothing else goes there. `--no-sage` runs the measurement checks with no upload.
- Your `.env` file and your Sage key never leave your machine, except as the key that authenticates your own requests to the Sage API.
- Raw API traffic is stored in `sagecut/qa/*/raw/`. SageCut adds this folder to your `.gitignore`.
- Your saved brands stay in `~/.sagecut/brands/` on your machine.

## License

MIT. Copyright (c) 2026 Levanto Labs. See [LICENSE](LICENSE).
