# Changelog

## Unreleased

- Added a standalone `sagecut` skill for the skills CLI, with the release runtime, OCR assets, templates, and QA references included.
- Added `npm run package:skill`; `npm run build` now refreshes that package too.
- Marked the plugin's `start` and `qa` components internal to normal skills CLI discovery.

## 0.3.0

First public release.

- `/sagecut:start`: the start screen, a short explainer and the Sage key check. Then you begin your video work.
- The `qa` skill: the project and brand step before the first video (website, brand kit folder, five questions, or a riff on something you like), the QA workflow with the house rules, three critics on the frames that SageCut selects, and a savings line at the end of every video.
- The `sagecut` tool for Node 18 or later on macOS, Linux and Windows x64: `doctor`, `init`, `brand`, `check-schedule`, `gate`, `sweep`, `triage`, `ask`, `baseline`, `numbers`, `deliver-check`, `splice`. It uses the ffmpeg that Remotion 4 includes, and OCR runs in Node.
- Tested on motion graphics only.
