# House rules

The house rules are a floor. The brand decides everything above the floor. If a brand choice breaks a floor, report it with the measurement. The user decides.

## 1. Rules that SageCut measures

| House rule | SageCut check |
|---|---|
| Legibility floors at 1080 px wide: headline 60 px, body 40 px, captions 30 px, URLs and legal text 26 px. Scale the floors with the width of the video. | OCR measures the text height. |
| Each placement has a test width: 350 px by default, 210 px for 9:16 in a feed, 375 px for 1:1 in a feed. | Sage reads the frame at the test width. |
| No blank frame inside a transition. | The ink-coverage check on every frame. |
| No black opening. No frozen frame longer than 1.5 s, unless the schedule declares the hold. | Measured on every frame. |
| Elements that move together use one source of timing. | `schedule.json`. |
| On-screen text and numbers match the source. | OCR compares the text with the schedule. |
| Delivery spec: H.264 at CRF 16-18, limited colour range, -14 LUFS, true peak -1 dBTP or lower, faststart, and room tone instead of digital silence. | `deliver-check`. |
| Check the delivered file, not the render output. | `deliver-check` runs on the final file. |

### Legibility floors

| Role | Hard floor at 1080 px wide | Recommended |
|---|---|---|
| Hook or headline | 60 px | 80-100 px |
| Body or priority copy | 40 px | 48-60 px |
| Captions and labels | 30 px | 40 px or more |
| URLs, legal text, credits | 26 px | 30 px or more |

- The minimum anywhere on screen is 26 px at 1080 px wide. Justify any text below 30 px.
- For other widths, scale the floors in proportion to the width.
- Measure the text height with OCR at full resolution. Read legibility with Sage at the test width.
- A brand can set larger sizes in `type`. It cannot set smaller sizes.
- Full pretty-printed JSON or terminal output cannot be legible on a phone. Cut it to one panel with two or three rows. Do not shrink it.

### Test widths

| Placement | Test width |
|---|---|
| Default or unknown | 350 px |
| 1:1 in a feed | 375 px |
| 9:16 in a feed (a tall video shown small) | 210 px |

Test the narrowest width that your placement allows, not the widest. The brand `format` sets the test width. `test_width` in `sagecut/sagecut.yaml` overrides it.

### Frame quality

- A transition never has a blank frame. Two opacity ramps that look like they overlap in code can leave an empty frame. Only a per-frame measurement shows it.
- The video does not open on black. Show something strong from frame 1. A black card is a short pattern break (1.5-2 s), never the opener. Use at most one in the first 10 seconds.
- No frozen frame is longer than 1.5 s. If a hold is on purpose, declare it in `schedule.json` (`hold` or `static_holds`).
- Digital silence is not silence. A track at minus infinity can read as a broken file. Keep a room-tone floor near -47 dBFS and duck to it, never to nothing.

### Delivery spec

1. Render with `--codec h264` and CRF 16-18 for masters.
2. Render with `--color-space bt709`. This gives limited range (`yuv420p`, tag `tv`). A render that is full range (`yuvj420p`, tag `pc`) needs the post-pass: `deliver-check --fix` does it. Do not squeeze a limited-range file a second time.
3. Master the audio to -14 LUFS with a true peak of -1 dBTP or lower. Aim near -2 dBTP before AAC encoding, because AAC raises the peaks.
4. Use `+faststart`.
5. Never ship a silent audio track by accident. Use room tone.
6. Check the delivered file, not the file in `out/`. Extract a frame from the file that you send.

## 2. Review method

1. A render passes the gate before the user sees it. The goal is 2 feedback rounds with the user, not 12.
2. Two critics with opposite views do the review: craft and clarity. They work independently. Neither critic sees the other critic's review.
3. Each critic gives a score from 1 to 10. The render passes at 8 or more from both critics. Stop after 3 rounds.
4. Each fix gives its timestamp. Each claim gives a measurement.
5. A third critic asks one question: is the idea stale or over-explained? A rules gate cannot see this.
6. Never approve your own hero element.
7. The critics use these house rules and `brand.yaml` as their rubric.
8. The critics look at the contact sheet and the frames that `gate` selects. This is the step that SageCut makes faster and cheaper.

### Rules for every dispatch to a critic

- Name the exact file and say what changed since the last round. Critics must check the new build, not an old one.
- Ask for measured evidence (pixel samples, ink coverage, text height), not opinion alone.
- If the concept depends on a measurable property (for example "nothing moves" or "in sync"), measure it. Do not judge it by eye.
- A passing score is not the same as a good video. The freshness critic exists for this reason.

## 3. Remotion build checklist

- Use `<OffthreadVideo>` for imported footage. Use `trimBefore`, and never use it together with `startFrom`.
- Composition IDs use only letters, digits and hyphens. No underscores.
- Use local font files in `public/fonts/`. A headless render cannot load web fonts.
- Put `<AbsoluteFill>` around positioned children. A plain `div` can collapse to 0 px.
- Make particle arrays when the module loads. Do not use `useMemo` for them.
- Crop the SVG `viewBox` to the content before you set its size.
- Put each reveal in its own local `<Sequence>`. Without it, the global frame shows the element fully formed from frame 0.
- Do not use masks on raster images in headless renders. Paint solid cover shapes instead.
- Take brand colours and fonts from `src/brand.ts`. Do not guess them.
- Build interface elements in code. Never stretch a logo.
- Get a reference video before the build, if the user has one. Extract its pacing, type and palette frame by frame.
- Get the brand files before you start. A brand that arrives in the middle of a build costs a rebuild.
- Take timing from `sagecut/schedule.json`. Elements that move together must use one source of timing, not parallel curves.
- Build exactly the content that the user asked for. Do not add lines or features.

## 4. Checks before you show a render

1. Run `check-schedule`, then render, then `gate`.
2. View every imported image or video file before you use it. File names can be wrong.
3. Read the contact sheet: nothing cropped at the edges, no unintended overlap, every element has a reason.
4. Read the frames at the test width, not at desktop width.
5. Numbers on screen match the numbers in the copy and in `numbers.json`.
6. Check the file that you deliver, not an older render.
