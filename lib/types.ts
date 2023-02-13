export interface NordPoolPriceResult {
  Rows?: {
    IsExtraRow: boolean;
    StartTime: string;
    EndTime: string;
    Columns: {
      Name: string;
      Value: string;
    }[];
  }[];
}

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type TimeString = `${Digit}${Digit}:${Digit}${Digit}`;
