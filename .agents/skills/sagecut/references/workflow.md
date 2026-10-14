# SageCut QA

SageCut gives a Remotion video three things: the house rules (a quality floor), your brand in every frame, and a fast and cheap QA. Code measures every frame. Sage reads every frame. The critics look only at the frames that SageCut selects. Claude opens a frame only when Sage and a measurement do not agree.

## How to run the tool

1. Run the tool only as `node "<skill-directory>/scripts/sagecut.mjs" <command>`. Never use `npx` for the tool.
2. Below, `sagecut` means that full command.
3. Exit code 0 means pass. Exit code 1 means findings. Exit code 2 means an error. The message on stderr has the fix.
4. Details are in the `references/` folder of this skill. Read a file only when you need it.

| File | Use it for |
|---|---|
| `references/house-rules.md` | Floors, review method, build checklist. Read it before you build. |
| `references/brand-format.md` | Each field of `brand.yaml`, with an example. |
| `references/schedule-format.md` | Each field of `schedule.json`, with an example. |
| `references/question-bank.md` | The kinds of Sage questions and their controls. |
| `references/cost-claims.md` | How to write QA cost and time. |
| `references/splice.md` | A small change to a delivered video. |
| `references/troubleshooting.md` | Doctor failures, API errors, empty answers. |

## First use

If `sagecut onboard status --json` shows `onboarded: false`, read and follow `references/setup.md` first. It shows the start screen and checks the key. Then continue here.

## Before the first video

Do these steps once per project, before the first render. The setup flow does not do them.

### Project

1. If the folder is not a Remotion project (`sagecut onboard status --json` shows `isRemotionProject: false`), ask the user: make a new Remotion project here, or use an existing project folder (the user gives the path). For a new project, ask for a folder name. Then run `npx create-video@latest --yes --blank <folder>`. Then move into the new project folder and run `npm install` if `node_modules` is missing.
2. Run `sagecut init`. It keeps all existing files. It prints a note about `tsconfig.json`. Set `"resolveJsonModule": true` in `compilerOptions` of `tsconfig.json`. Then the composition can import `sagecut/schedule.json`.

### Brand

Do this only if `sagecut/brand.yaml` does not exist.

1. If the user has a saved brand, run `sagecut brand list`. Offer `sagecut brand use <NAME>`.
2. Else ask: "Which brand is this video for?" Give four options.

| Option | What you do |
|---|---|
| From my website | Ask for the URL. Before you run it, say: "This reads the page's HTML and CSS only. It does not read styles built by JavaScript, and it gives no video format." Then run `sagecut brand from-url <URL>`. Show the coverage line. |
| From a brand kit folder | Ask for the folder path. Run `sagecut brand from-folder <PATH>`. |
| Answer 5 questions | Ask for colours, font, logo, motion style and format. Write `sagecut/brand.draft.yaml` yourself. |
| No brand: riff on something | Do the riff steps below. |

Reuse the brand information and approvals already supplied for this project.

#### Riff steps

1. Ask the user for something to riff on: a brand they like, a film, a game, a decade, a place or a mood.
2. Make 3 style directions. Each has a palette in hex values (background, text, primary, one or two accents), a font pair with an open licence (for example the SIL Open Font License), a motion style (`restrained` or `energetic`) and one line of description.
3. Ask the user to pick one. Write it to `sagecut/brand.draft.yaml` with the name `riff-<idea>` (lower case, hyphens), `source.kind: riff` and no logo.
4. A riff takes the mood of the idea only. Never copy another company's logo, name or exact palette. Use fonts with an open licence only.

The field list and a full example are in `references/brand-format.md`. Read it before you write a draft.

#### Approve and save

1. Show the result before you save it: the colours as hex values, the fonts, the logo file and the motion style.
2. Ask the user to approve it or to change it. Change it until the user approves.
3. Run `sagecut brand set sagecut/brand.draft.yaml`. This writes `sagecut/brand.yaml`, `src/brand.ts` and the font files, and saves the brand in `~/.sagecut/brands/`.
4. `src/brand.ts` imports `@remotion/fonts`. If the project does not have it, run `npx remotion add @remotion/fonts`.

## The workflow

Do these steps in order.

1. **Doctor.** Run `sagecut doctor`. If the Sage key is missing, tell the user to put `SAGE_API_KEY` in `.env`. Never ask for the key in the chat. If the project or the brand file is missing, do "Before the first video".
2. **Init and schedule.** Run `sagecut init`. Write the timing in `sagecut/schedule.json`. Set a `role` on each text element. Declare each designed cut, flash or glitch in the schedule. Set `"resolveJsonModule": true` in `tsconfig.json`, then import the schedule in the composition. If the video has no sound on purpose, set `audio: none` in `sagecut/sagecut.yaml`. Run `sagecut check-schedule`. Fix each error before you render.
3. **Render.** Run `npx remotion render <id> out/<name>.mp4 --codec h264 --crf 17 --color-space bt709`.
4. **Gate.** Run `sagecut gate out/<name>.mp4`. Note the run folder. It has `findings.json`, `summary.md`, `contact.png` and `critic-frames/`.
5. **Findings.** For each finding, do these steps:
   1. Measure the frame (the finding gives the measurement).
   2. Ask Sage with `sagecut ask`. A control runs in the same batch.
   3. If Sage and the measurement agree, accept the result.
   4. If they do not agree, open the frame yourself. Record the open in `opened.json` (see "Opening a frame").
6. **Critics.** Start the critics on the frames that `gate` selected (see "Critics"). Do not let them open other frames.
7. **Fix.** Fix the defects. Render again. Run `gate` again. After 3 rounds, stop and report what is still open.
8. **Deliver check.** Run `sagecut deliver-check out/<name>.mp4 --fix`. If it writes `out/<name>-delivery.mp4`, that is the final file. Else the final file is `out/<name>.mp4`.
9. **Final QA.** On the final file (the exact file that you deliver), run `gate`, then `sweep`, then `triage`:
   1. `sagecut gate <final file>`
   2. `sagecut sweep <final file>`
   3. `sagecut triage <sweep-run-dir> --video <final file>`

   The sweep replaces the critics' frame-by-frame review. It is not an added step.
10. **Numbers.** Run `sagecut numbers --runs <gate-run> <sweep-run> --critics-marker <marker>`. Every on-screen number about the QA comes from `sagecut/qa/numbers.json`. Before this step, write each frame that you opened yourself into `opened.json` in the gate run folder, as `{"images": [<frame numbers>]}`. The card counts only that file. No baseline is needed: the card estimates the Opus critics' side at the reference rate (see `references/cost-claims.md`).
11. **Report.** Show the user before and after pictures. Write a short report: the defects that QA found, the corrections, the measured QA time and cost, and the number of frames that Claude opened. Read `references/cost-claims.md` before you write cost or time.
12. **Savings.** At the end of every video, show the "Saved on this video" line that `sagecut numbers` printed. Copy it as it is. Do not change a number, and do not drop the word "estimate".

## The 9 rules

1. Sage and measurement do the visual QA. Claude opens a frame only when they do not agree. Claude records each open.
2. Each Sage question runs with a control in the same batch. If the control fails, the "no" answers to that question are not reliable.
3. Make the controls from the user's own frames. Move text across the edge, use a black frame, or repeat a frame. Add a ghost copy of the text, or use colours outside the brand.
4. Do not trust one Sage answer from one run. A measurement decides each open item.
5. On-screen numbers come from `numbers.json`. Do not type them. Placeholders stay until the final QA. `deliver-check` stops if it finds a placeholder.
6. Run the final QA on the exact file that you deliver. If a frame changes, measure again.
7. For cost claims, use API list prices and measured usage. Read the cache rate from the session files. Do not guess it. Do not put numbers from two different videos together. Report image views and different images as two numbers. Do not claim a saving against a cost that nobody measured.
8. Sage reads legibility at the test width. OCR reads at full resolution.
9. For a small change to a delivered video, render only the changed frames. Put them into the video file with `splice`. Check the result with the proof file.

## Opening a frame

Open a frame only when Sage and a measurement disagree. Examples: Sage says "no overlap" and the measurement shows a collision, or the reverse.

1. Before you open the frame, add an entry to `opened.json` in the run folder. If the file does not exist, make it with an empty list.
2. The entry has these fields: `frame`, `time_s`, `question`, `sage_answer`, `measurement`, `reason`.
3. Open the frame. Then add `finding` (what you saw) to the entry.
4. The number of entries is the "frames that Claude opened" in the report.

Never open a frame for comfort. Never open a frame that Sage and the measurement agree on.

## Critics

Use three independent critics for full QA: craft, clarity, and freshness. Use Claude Code sub-agents when available and permitted by the task, following the user’s model preference. If independent critics cannot run, report that full QA and critic cost accounting are incomplete; do not invent their reviews or token usage.

1. Put this line as the first line of each prompt: `SAGECUT-CRITIC-<run-id>`. The `<run-id>` is the name of the gate run folder. The tool uses this line to sum the critics' token usage.
2. Give each critic only these inputs:
   - the files in `critic-frames/` and `contact.png` of the gate run
   - `sagecut/brand.yaml`
   - `references/house-rules.md` (the rubric)
   - the exact file name and what changed since the last round
3. Tell each critic not to open any other frame and not to read the other critics' reviews.
4. Each critic's lens:

| Critic | Lens |
|---|---|
| Craft | Edit quality, typography, spacing, motion, colour use, brand fit. |
| Clarity | Can a viewer read and understand each beat at the test width in one pass? Is the message clear? |
| Freshness | One question only: is the idea stale or over-explained? Would a stranger share it? |

5. The craft and clarity critics each give a score from 1 to 10. Each fix they ask for gives a timestamp. Each claim gives a measurement or a named frame.
6. The render passes at 8 or more from both the craft critic and the clarity critic. Stop after 3 rounds.
7. The freshness critic gives a verdict (fresh, tired or over-explained) and one reason. A "tired" verdict goes to the user in the report. It does not start a new round alone.
8. Never approve your own hero element. A critic reviews it.

Show this text if the user asks what the critics see:

> The critics do not scroll through the whole video. SageCut measures every frame and Sage reads every frame first. The critics then look at the frames that SageCut picked, plus one contact sheet.

## Brand and house rules

1. The house rules are the floor: legibility sizes, the delivery spec and frame quality. A brand cannot go below the floor.
2. The brand decides everything above the floor: colours, fonts, motion style and tone.
3. Build with `src/brand.ts`. It imports `@remotion/fonts`. If the project does not have it, run `npx remotion add @remotion/fonts`. Do not guess colours or fonts. Do not hard-code a colour.
4. If a brand choice breaks a floor, report it with the measurement. The user decides.
5. Effects in `motion.designed` (flash, hard cut, glitch) are part of the design. Do not report them as defects.

## Delivery

1. Run `sagecut deliver-check` before the final QA. With `--fix`, it writes `<name>-delivery.mp4` when the colour range needs a correction. Deliver that file if it is written.
2. Run the final QA (step 9) on the file that you deliver.
3. If the user asks for a small change to a delivered video, read `references/splice.md`.

## Limits in 0.3

- **Motion graphics only.** SageCut 0.3 is tested on motion graphics only. It is not tested on camera footage. The frozen-frame and colour checks may behave differently on camera footage. Do not promise results on camera footage.
