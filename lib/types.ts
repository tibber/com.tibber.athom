export interface NordpoolPriceResult {
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
