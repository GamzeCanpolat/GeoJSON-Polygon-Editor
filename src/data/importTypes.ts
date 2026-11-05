export type ImportFormat = 'geojson' | 'excel';
export type ImportKind = 'coordinates' | 'wkt' | 'geojson' | 'polyline';
export interface SpreadsheetMapping { sheet:string; kind:ImportKind; longitude:number; latitude:number; geometry:number }
export interface SpreadsheetInfo extends SpreadsheetMapping {
  sheets:string[];
  columns:{index:number;name:string}[];
  headerRow:number;
  rowCount:number;
}
export interface ImportIssue {row:number;message:string}
export interface ImportWorkerReply {id:number;info?:SpreadsheetInfo;blob?:Blob;count?:number;skippedRows?:number;issues?:ImportIssue[];error?:string;progress?:import('../domain/contracts').ImportProgress}
export const MAX_EXCEL_BYTES=25*1024*1024;
