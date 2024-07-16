import { EPiece } from '@/utils/consts';

export const DEBUG_BOARD_CORD = false;

export const A_D = 1000; // ANIMATION DURATION in ms
export const C_S = 4; // CELL SIZE
export const B_D = 8; // BOARD DIM
export const CU_S = C_S * B_D; // CUBE SIZE
export const Z_GS = 0.1; // Z GAP SCALER FOR PATH POINTS (ANIMATION)

export const TARGETED_PIECES = [EPiece.KING, EPiece.PRINCE];

export const sampleConfig = `
--------
-NPPPPN-
-PTRBTP-
-PCKSOP-
-POXQCP-
-PTBRTP-
-NPPPPN-
--------

--------
-nppppn-
-ptrbtp-
-pcksop-
-poxqcp-
-ptbrtp-
-nppppn-
--------
		`;
