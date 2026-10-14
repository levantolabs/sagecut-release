# Question bank

Sage answers yes/no questions about images. SageCut asks a fixed set of questions in `gate`, `sweep` and `triage`. You can also ask your own with `sagecut ask`.

## What a good question looks like

1. It asks about one defect or one prepared picture.
2. A "yes" answer means the defect is present.
3. It uses plain words about what a viewer sees.
4. It has a control: a frame with a known defect. Sage must find the defect in the control.

## Kinds of questions

| Kind | What it finds |
|---|---|
| Text cut at an edge | Text that crosses the frame edge or the safe margin. |
| Text overlap | Two text elements, or text and an image, that collide. |
| Ghost or double text | A faint second copy of text from a bad fade or transition. |
| Empty frame | A frame with almost no content in the middle of a beat or a transition. |
| Legibility at the test width | Text that a viewer cannot read when the frame is small. |
| Off-brand look | Colours or style that do not fit the brand words. |
| Stretched or broken element | A logo or shape with the wrong ratio, or a clipped shape. |
| Unexpected artefact | Black bars, flicker, compression blocks, missing images. |

The `sweep` command asks 4 questions on every frame at 960 px. Inside text windows, it also asks the legibility question at the test width.

## The default files

The plugin includes two question files in `assets/bank/`.

| File | Used by | Contents |
|---|---|---|
| `gate-default.yaml` | `gate` | 8 questions about one prepared picture each: `staging_order`, `dead_frame`, `pop`, `abrupt_change`, `overlap`, `legible_feed`, `text_integrity` and `hierarchy`. Each has a kind, a picture type, the answer that fails, and a severity. The picture is a frame, a phone-size frame, a contact sheet of a beat, or a difference image of two frames. A null answer, or a scale answer near the pass line, goes to escalation. |
| `sweep-default.json` | `sweep`, `triage` | Four problem questions (`cut`, `over`, `overlap`, `glitch`), one legibility question, a pass threshold, and the targeted triage questions with their width and control. |

Use `sagecut gate <video> --bank FILE` to run a different gate question file. Use `question_bank` in `sagecut/sagecut.yaml` for a project default.

## Controls

A control runs in the same batch as its question. If Sage does not find the defect in the control, the "no" answers to that question are not reliable. The tool marks the run as unreliable. Then a measurement must decide.

| Control | How the tool makes it from your own frames |
|---|---|
| `cut` | Moves the text across the edge of a frame. |
| `black` | A black frame. |
| `frozen` | Repeats a frame. |
| `ghost` | Adds a faint second copy of the text. |
| `offbrand` | Changes colours to ones outside the brand palette. |
| `none` | No control. Use only for a check that cannot fail in a useful way. |

The tool picks a default control from the question. Use `--control` to choose another.

## Ask your own question

```
sagecut ask --images "sagecut/qa/<run>/img/*.png" --question "Is any text cut off by the edge of the frame?" --width 350 --control cut
```

- `--width` sets the width at which Sage reads the frame. For legibility, use the test width of the brand.
- The tool prints a table of results. Every answer is logged in `sagecut/metrics/sage.jsonl`.
- A question about a defect that does not exist in your frames still needs a control. Without it, a row of "no" answers proves nothing.

## Rules

1. Do not trust one Sage answer from one run. A measurement decides each open item.
2. Put a project question set in the file that `question_bank` names in `sagecut/sagecut.yaml`. This is optional.
3. Keep questions general. Do not name objects that only one video has.
4. A "yes" without a measurement goes to the list of items to check. It is not yet a finding.
5. Sage reads legibility at the test width. OCR reads at full resolution.
