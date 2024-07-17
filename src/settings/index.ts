import { EColor, EPiece } from '@/utils/consts';
import { vec } from '@/utils/funcs';

export const DEBUG_BOARD_CORD = false;

export const A_D = 1000; // ANIMATION DURATION in ms
export const C_S = 4; // CELL SIZE
export const B_D = 8; // BOARD DIM
export const CU_S = C_S * B_D; // CUBE SIZE
export const Z_GS = 0.1; // Z GAP SCALER FOR PATH POINTS (ANIMATION)

export const TARGETED_PIECES = [EPiece.KING, EPiece.PRINCE];

export const STANDARD_CONFIG = `
--------
--------
--------
--------
--------
--------
--------
N-------

--------
-nppppn-
-ptrbtp-
-pcksop-
-poxqcp-
-ptbrtp-
-nppppn-
--------
		`;

// RUBRIKS MODES
// export const SIDES_COLOR = [
// 	EColor.WHITE,
// 	EColor.RED,
// 	EColor.BLUE,
// 	EColor.BLACK,
// 	EColor.YELLOW,
// 	EColor.GREEN,
// ];

export const SIDES_COLOR = [
	EColor.WHITE,
	EColor.WHITE,
	EColor.BLACK,
	EColor.BLACK,
	EColor.WHITE,
	EColor.BLACK,
];

export const INITAL_CAM_CORD = vec(1.5 * CU_S, 1.5 * CU_S, 1.5 * CU_S);
