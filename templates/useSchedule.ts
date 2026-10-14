// Written by SageCut (sagecut init). The single source of timing: sagecut/schedule.json.
// Your composition and SageCut read the same file, so the video and the QA never disagree.
// Needs "resolveJsonModule": true in tsconfig.json.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import schedule from '../../sagecut/schedule.json';

export type ScheduleElement = { id: string; in: number; out?: number; text?: string; literal?: boolean };
export type ScheduleBeat = { id: string; start: number; end: number; hold?: number | [number, number]; elements?: ScheduleElement[]; order?: number };
export type Schedule = {
  film: string; fps: number; frames: number; width: number; height: number; safe_margin_px: number;
  beats: ScheduleBeat[]; transitions: { from: string; to: string; frames: [number, number] }[];
};

export const SCHEDULE = schedule as unknown as Schedule;

const findBeat = (id: string): ScheduleBeat => {
  const beat = SCHEDULE.beats.find((b) => b.id === id);
  if (!beat) throw new Error(`SageCut: no beat "${id}" in sagecut/schedule.json`);
  return beat;
};

// Timing of one beat: { start, end, frame (global), local (frames since the beat started), active, progress (0 to 1) }
export function useBeat(id: string) {
  const frame = useCurrentFrame();
  const beat = findBeat(id);
  const length = Math.max(1, beat.end - beat.start);
  return {
    beat, start: beat.start, end: beat.end, frame, local: frame - beat.start,
    active: frame >= beat.start && frame <= beat.end,
    progress: Math.min(1, Math.max(0, (frame - beat.start) / length)),
  };
}

// Renders its children only between the in frame and the out frame of the element with this id.
// out defaults to the end of the beat that holds the element.
export const Scheduled: React.FC<{ id: string; children?: React.ReactNode }> = ({ id, children }) => {
  const frame = useCurrentFrame();
  for (const beat of SCHEDULE.beats) {
    const el = (beat.elements || []).find((e) => e.id === id);
    if (el) {
      const out = el.out ?? beat.end;
      return frame >= el.in && frame <= out ? React.createElement(React.Fragment, null, children) : null;
    }
  }
  throw new Error(`SageCut: no element "${id}" in sagecut/schedule.json`);
};

// The text that the schedule declares for an element (so the copy lives in one place).
export const scheduledText = (id: string): string => {
  for (const beat of SCHEDULE.beats) {
    const el = (beat.elements || []).find((e) => e.id === id);
    if (el) return el.text ?? '';
  }
  throw new Error(`SageCut: no element "${id}" in sagecut/schedule.json`);
};
