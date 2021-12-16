export interface NordpoolPriceResult {
  data: {
    Rows?: {
      IsExtraRow: boolean;
      StartTime: string;
      EndTime: string;
      Columns: {
        Name: string;
        Value: string;
      }[];
    }[];
  };
}
