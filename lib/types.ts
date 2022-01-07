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
