import { vec } from '@/utils/funcs';

export const C_S = 4; // CELL SIZE
export const B_D = 8; // BOARD DIM
export const CU_S = C_S * B_D; // CUBE SIZE
export const Z_GS = 0.1; // Z GAP SCALER FOR PATH POINTS (ANIMATION)

export const INITAL_CAM_CORD = vec(1.2 * CU_S, 1.2 * CU_S, 1.2 * CU_S);
