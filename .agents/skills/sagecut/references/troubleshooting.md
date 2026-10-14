# Troubleshooting

For full review, start with `sagecut doctor`. For local measurements only, skip the Sage checks and use `gate --no-sage`. It checks each item below and prints the fix for each failure.

## Doctor failures

| Failure | Cause | Fix |
|---|---|---|
| Node version | Node is older than 18. | Install Node 18 or later from nodejs.org. Restart Claude Code. |
| ffmpeg or ffprobe not found | The project has no Remotion 4 install, or `node_modules` is missing. | Run `npm install` in the project. Check that `@remotion/compositor` for your platform is in `node_modules`. |
| No Sage key | `SAGE_API_KEY` is not in `.env`. | Make a key at levanto.ai. Put `SAGE_API_KEY=...` in the `.env` file in the project root, or in `~/.sagecut/.env` for all projects. A key in the project wins. Do not paste the key in the chat. |
| Sage server not ready | `GET /ready` failed. | Check the network and any proxy. Try again in a minute. See "Sage API errors". |
| OCR not ready | The OCR language data is missing or blocked. | See "OCR missing". |
| No brand file | `sagecut/brand.yaml` does not exist. | Follow the brand section in `references/workflow.md`, or run `sagecut brand use <NAME>`. |
| No schedule | `sagecut/schedule.json` does not exist. | Run `sagecut init`. |
| Not a Remotion project | No `remotion` in `package.json`. | Run the tool from the project folder, or use `--root <dir>`. To make a project, run `npx create-video@latest`. |

## Sage API errors

| Code | Meaning | Fix |
|---|---|---|
| 401 | The key is wrong, expired or missing. | Check `SAGE_API_KEY` in `.env`. Check that the line has no quotes, spaces or line breaks in the key. Make a new key at levanto.ai if needed. |
| 413 | The request is too large. | Use fewer images in one request, or a smaller width. Run the command again with `--workers 1`. |
| 429 | Too many requests. | Wait, then run the command again. Lower `workers` in `sagecut/sagecut.yaml` (for example to 2). Check your plan limits at levanto.ai. |
| 504 | The server timed out. | Run the command again. If it keeps failing, lower `workers` and try again later. |

The tool retries some of these errors by itself. If a command stops with an error, the one-line message on stderr has the fix.

## Null or empty answers

Sage can return no answer (null) for a frame.

1. Do not treat null as "no defect".
2. Run the question again for those frames. Use `sagecut ask`.
3. If it is still null, check the image: it can be empty, too small or corrupt.
4. If the control gives null, the run is unreliable. A measurement decides.
5. Do not trust one answer from one run. A measurement decides each open item.

## OCR missing

OCR uses tesseract.js with language data included in `runtime/assets/`. It needs no network.

1. Run `sagecut doctor`. Read the OCR line.
2. If the data file is missing, the skill install is incomplete. Reinstall with `npx skills add levantolabs/sagecut-release --skill sagecut -a claude-code` in the original installation scope (add `-g` for a global install).
3. Security software can remove or block files. Inspect its report and the affected file before deciding how to restore the installation.
4. Without OCR, the text-height and text-match checks do not run. Report this to the user. Do not call the QA complete.

## Other problems

| Problem | Fix |
|---|---|
| Warning about a missing audio stream | Set `audio: none` in `sagecut/sagecut.yaml` if the video is silent on purpose. Set `audio: required` if sound is a must. |
| The composition cannot import `sagecut/schedule.json` | Set `"resolveJsonModule": true` in `compilerOptions` of `tsconfig.json`. |
| `src/brand.ts` cannot find `@remotion/fonts` | Run `npx remotion add @remotion/fonts`. |
| The gate costs too much, or Sage is not reachable | Use `sagecut gate <video> --no-sage` for measurements only, `--no-ocr` to skip OCR, or `--max-billed N` to cap the Sage input tokens. The QA is then not complete. Say so in the report. |
| A designed flash or cut shows as a finding | Declare it in `cuts` or `effects` in `schedule.json`. The brand alone does not suppress it. |

## Render problems

| Problem | Fix |
|---|---|
| Black frames in imported footage | You trimmed past the end of the clip, or you used a wrong prop. Use `trimBefore` only. |
| Fonts look wrong | Use local font files in `public/fonts/`. A headless render cannot load web fonts. |
| An element is missing from frame 0 | Put the reveal in its own local `<Sequence>`. |
| Colour looks washed out | The render is full range. Render with `--color-space bt709`, or run `deliver-check --fix`. |
| The render is slow or stuck | Another render may use the same machine. Add `--timeout 120000 --concurrency 4` to your own render. Do not stop processes that you did not start. |

## Windows notes

1. SageCut works on Windows x64. It does not work on Windows on ARM, because Remotion supports only x64 on Windows.
2. Claude Code runs shell commands in Git Bash or in PowerShell. Both work with the commands in these skills.
3. Replace `<skill-directory>` with the actual installed skill directory. Keep the quotes around the tool path.
4. If the path of the project has spaces, quote it in `--root`.
5. Do not use `npx` to run the tool. Use `node "<skill-directory>/scripts/sagecut.mjs"`.
6. No Python, ffmpeg or OCR program is needed.

## macOS and Linux notes

1. Linux needs the system libraries that Remotion needs for its headless browser. Install them if the render fails on start. See the Remotion documentation for the list.
2. On macOS, allow the terminal to access the project folder if a command cannot read files.

## Still stuck

1. Run `sagecut doctor --json` and read the failing items.
2. Read the one-line error on stderr. It has the fix.
3. Tell the user what failed, what you tried, and what they can do.
