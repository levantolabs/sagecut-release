# Splice

Use `splice` when a delivered video needs a change in a few seconds. You render only the changed frames. The tool puts them into the delivered file. You do not render the full video again.

## When to use it

1. The video is already delivered, and the user asks for a small change (for example one text or one transition).
2. The change is a few seconds, not the whole film.
3. You have the master file that was delivered.

Do not use it when the change moves the timing of the rest of the video. If the number of frames changes, render the full video again.

## Steps

1. Change the code or the schedule for the frames A to B only.
2. Plan the range. The tool finds the nearest range of whole groups of pictures (GOP):
   `sagecut splice plan <master.mp4> --frames A-B`
   The output gives the range `G0-G1` and the render command.
3. Render only that range:
   `npx remotion render <id> patch.mp4 --codec h264 --crf 17 --color-space bt709 --frames=G0-G1`
   Use the same settings as the master.
4. Apply the patch:
   `sagecut splice apply <master.mp4> patch.mp4 --frames G0-G1 --out <new-master.mp4>`
   The tool uses the same x264 options and the same SPS as the master. It copies the streams outside the range without re-encoding.
5. Read the proof file `<new-master>.proof.json`.
6. Run `sagecut deliver-check <new-master.mp4>`.
7. Run the sweep on the frames of the changed range if the change touches text or layout.

## Read the proof

The proof file has two checks:

| Check | Pass condition |
|---|---|
| Decoded-frame hashes outside the range | Identical to the master. |
| Packet pts, dts and duration | Identical to the master, everywhere. |

If the hashes outside the range differ, the splice moved the picture. If the packet timestamps differ, the end of the video moved. In both cases, do not deliver the file. Check that the patch has the same frame rate, size and colour settings as the master. Then try again, or render the full video.

## Rules

1. Check the result with the proof file. Do not check it by eye.
2. Keep the old master until the user accepts the new one.
3. Run the final QA on the new file (rule 6).
