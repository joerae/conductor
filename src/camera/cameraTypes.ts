import type { DynamicLevel } from "../audio/dynamicsTypes";

export interface NormalizedPoint {
  /** Normalized X coordinate [0, 1] (0 = left, 1 = right in image space). */
  x: number;
  /** Normalized Y coordinate [0, 1] (0 = top, 1 = bottom in image space). */
  y: number;
  /** Estimated relative depth. */
  z?: number;
}

export interface ConductorPoint {
  /** Normalized X coordinate [0, 1] (0 = left, 1 = right). */
  x: number;
  /** Conductor-space Y coordinate [0, 1] (0 = physically low/floor, 1 = physically high/raised). */
  y: number;
  /** Estimated relative depth. */
  z?: number;
}

export interface HandLandmark extends NormalizedPoint {
  visibility?: number;
}

export type Handedness = "left" | "right";

export type ConductingPointType = "wrist" | "indexTip" | "weightedBlend";

export interface HandSample {
  /** Timestamp in milliseconds from performance.now(). */
  timestampMs: number;
  /** Hand slot index (0 or 1). */
  handIndex: number;
  /** Handedness detected by model. */
  handedness: Handedness;
  /** Detection/tracking confidence [0, 1]. */
  confidence: number;
  /** All 21 3D landmarks for this hand. */
  landmarks: HandLandmark[];
  /** Primary conducting point in standard image space (y: 0=top, 1=bottom). */
  conductingPoint: NormalizedPoint;
  /** Primary conducting point in conductor space (y: 0=bottom, 1=top). */
  conductorPoint: ConductorPoint;
}

export interface DynamicsObservation {
  timestampMs: number;
  /** Normalized continuous dynamic value [0, 1] (0 = quietest pp, 1 = loudest fff). */
  value: number;
  /** Smoothed conductor-space Y height [0, 1]. */
  smoothedY: number;
  /** Corresponding discrete orchestral dynamic level. */
  level: DynamicLevel;
  /** Number of hands currently contributing to dynamics (0, 1, or 2). */
  handCount: number;
  confidence: number;
}

export type CameraState =
  | "idle"
  | "requesting_permission"
  | "loading_model"
  | "tracking"
  | "error"
  | "stopped";

export interface HandTelemetryDetail {
  handedness: Handedness;
  confidence: number;
  conductorPoint: ConductorPoint;
}

export interface CameraTelemetry {
  state: CameraState;
  cameraFps: number;
  inferenceFps: number;
  inferenceDurationMs: number;
  handsDetected: number;
  handDetails: HandTelemetryDetail[];
  dynamics?: DynamicsObservation;
  beatDebug?: Array<{
    handIndex: number;
    direction: "DOWN" | "UP" | "IDLE";
    currentY: number;
    currentVy: number;
    peakY: number;
    troughY: number;
    lastBeatType?: "trough" | "apex";
    lastBeatTimeMs: number;
  }>;
  lastBeat?: {
    timeMs: number;
    direction: "trough" | "apex";
    handIndex: number;
    amplitude: number;
  };
  errorMessage?: string;
}

export interface CameraConfig {
  maxHands: number;
  minHandDetectionConfidence: number;
  minHandPresenceConfidence: number;
  minTrackingConfidence: number;
  conductingPointType: ConductingPointType;
  wristWeight: number;
  mirrorPreview: boolean;
  wasmLoaderUrl: string;
  modelAssetPath: string;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  maxHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  conductingPointType: "wrist",
  wristWeight: 0.6,
  mirrorPreview: true,
  wasmLoaderUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
};

/**
 * Standard MediaPipe Hand Landmark Indices
 */
export const HAND_LANDMARK_INDICES = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_DIP: 7,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_PIP: 14,
  RING_FINGER_DIP: 15,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/**
 * Connections between hand landmarks for skeletal rendering.
 */
export const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  // Palm
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  // Palm knuckle base cross-connections
  [5, 9], [9, 13], [13, 17],
] as const;

/**
 * Computes conducting point from 21 landmarks according to configuration.
 */
export function extractConductingPoint(
  landmarks: HandLandmark[],
  type: ConductingPointType = "wrist",
  wristWeight: number = 0.6
): NormalizedPoint {
  if (!landmarks || landmarks.length < 21) {
    return { x: 0.5, y: 0.5, z: 0 };
  }

  const wrist = landmarks[HAND_LANDMARK_INDICES.WRIST] || { x: 0.5, y: 0.5, z: 0 };
  const indexTip = landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] || { x: 0.5, y: 0.5, z: 0 };

  switch (type) {
    case "indexTip":
      return { x: indexTip.x, y: indexTip.y, z: indexTip.z };
    case "weightedBlend": {
      const iw = Math.max(0, Math.min(1, 1 - wristWeight));
      const ww = Math.max(0, Math.min(1, wristWeight));
      return {
        x: wrist.x * ww + indexTip.x * iw,
        y: wrist.y * ww + indexTip.y * iw,
        z: (wrist.z ?? 0) * ww + (indexTip.z ?? 0) * iw,
      };
    }
    case "wrist":
    default:
      return { x: wrist.x, y: wrist.y, z: wrist.z };
  }
}

/**
 * Converts image-space normalized coordinate (0 = top, 1 = bottom)
 * to conductor-space coordinate (0 = bottom / floor, 1 = top / raised).
 */
export function toConductorSpace(point: NormalizedPoint): ConductorPoint {
  return {
    x: point.x,
    y: Math.max(0, Math.min(1, 1.0 - point.y)),
    z: point.z,
  };
}
