// Gate thresholds. The measurement values are calibrated on test videos with planted defects. The legibility floors come

// ---- analysis size and v1 measurement ----
export const MEASURE_W = 480, MEASURE_H = 270;   // grey analysis size
export const SCAN_W = 960, SCAN_H = 540;         // colour pass: centroid and fireflies
export const INK_DELTA = 40;                     // grey levels from paper that count as ink
export const DEAD_INK_SHARE = 0.002;             // ink share below this = empty frame
export const DEAD_MIN_RUN = 6;                   // frames outside transitions
export const DEAD_MIN_RUN_TRANSITION_S = 0.33;   // a run touching a transition window may be a designed dip
export const DEAD_ESC_RUN_TRANSITION_S = 0.23;   // from this length a run in a transition is an escalation
export const DEAD_START_FLOOR = 6;
export const DEAD_INTRO_GRACE_S = 0.15;
export const V1_SPIKE_ABS = 1.5;                 // spikes that feed the Sage pop / abrupt_change questions
export const V1_SPIKE_K = 6.0;
export const V1_SPIKE_R = 4.0;
export const ENTRY_PAD = 3;
export const V1_SPIKE_CAP = 20;
export const SETTLED_MAX = 0.6;
export const SHEET_MAX = 12;
export const CROP_W = 960;
export const SCALE_MARGIN = 0.3;
export const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2, review: 2.6, info: 3 };

export const FROZEN_FLANK = 8, FROZEN_MOVING = 0.1, FROZEN_JUMP = 3.0;
export const FROZEN_CONTINUOUS = 0.95;
export const SPIKE_ABS = 0.10, SPIKE_STRONG = 0.6, SPIKE_INK = 0.05, SPIKE_K = 8.0, SPIKE_ISO = 10.0;
export const SPIKE_BASE_FLOOR = 0.02, SPIKE_CAP = 12, GLITCH_RETURN = 0.35;
export const CUT_PAD = 1;
export const SAME_MOTION = 0.8, SAME_MIN_BLOCKS = 20;
export const CENT_ABS = 8.0, CENT_K = 8.0, CENT_MASS_PCT = 2.5, CENT_MIN_PX = 260;
export const SAT_MIN = 0.5, VAL_MIN = 0.4;
export const DIP_FRAC = 0.25, DIP_BLANK = 0.2, DIP_ESC = 6, DIP_FIND = 14;
export const CELL_COLS = 8, CELL_ROWS = 6, CELL_ABS = 20.0, CELL_K = 8.0, CELL_ISO = 10.0, CELL_STAB = 0.3;
export const CELL_IMAGE_SHARE = 0.5, CELL_CUT_AFTER = 4, CADENCE_MIN = 3;
export const LUMA_ABS = 1.2, LUMA_K = 8.0, BLACK_LUMA = 4.0, BLACK_NEIGHBOUR = 20.0;
export const FF_DELTA = 44, FF_FLAT = 24, FF_ABS = 40, FF_K = 5.0, FF_MAX_RUN = 8;
export const SEAM_RATIO = 2.5;

// ---- frame checks ----
export const EDGE_STRONG = 60, EDGE_STRUCT = 18, EDGE_MIN_PX = 25, EDGE_STRUCT_LEN = 150, EDGE_BLOCK = 4;
export const FLAT_RANGE = 10, TEX_RANGE = 24, FLAT_MIN_AREA = 0.02, COLOUR_DE = 6.0;
export const MASK_PAD = 12, MASK_INK_MIN = 40;

// ---- text (OCR) checks ----
export const OCR_NEAR = 0.75;                    // similarity of a near-miss word
export const HOUSE_FLOORS = { headline: 60, body: 40, caption: 30, url: 26 };
export const FLOOR_REF_W = 1080;
export const OCR_TO_TYPE = 0.7;
export const FLOOR_TOLERANCE = 0.9;
export const DEFAULT_TEST_WIDTH = 350;
