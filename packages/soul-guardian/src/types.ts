export interface SoulGuardianTarget {
  readonly path: string;
}

export interface SoulGuardianConfig {
  readonly workspacePath: string;
  readonly targets: readonly SoulGuardianTarget[];
  readonly schedule: string;
  readonly timezone?: string;
  readonly channelId?: string;
}

export type SoulGuardianStatus = "ok" | "drift" | "missing" | "unapproved";

export interface SoulGuardianItem {
  readonly path: string;
  readonly status: SoulGuardianStatus;
  readonly approvedSha256?: string;
  readonly currentSha256?: string;
  readonly changedLines?: number;
}

export interface SoulGuardianApproveResult {
  readonly approved: readonly { readonly path: string; readonly sha256: string }[];
  readonly skipped: readonly string[];
}

export interface SoulGuardianCheckResult {
  readonly ok: boolean;
  readonly items: readonly SoulGuardianItem[];
  readonly fingerprint: string;
}
