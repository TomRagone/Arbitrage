export interface CompactCandle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export type ValueExpr =
  | { readonly type: 'const'; readonly value: number }
  | { readonly type: 'feature'; readonly name: string }
  | { readonly type: 'price'; readonly field: 'open' | 'high' | 'low' | 'close' };

export type BoolExpr =
  | { readonly type: 'gt'; readonly left: ValueExpr; readonly right: ValueExpr }
  | { readonly type: 'lt'; readonly left: ValueExpr; readonly right: ValueExpr }
  | { readonly type: 'and'; readonly left: BoolExpr; readonly right: BoolExpr }
  | { readonly type: 'or'; readonly left: BoolExpr; readonly right: BoolExpr };

export interface StrategyDSL {
  readonly entry: BoolExpr;
  readonly exit: BoolExpr;
  readonly side: 'LONG' | 'SHORT';
}

export interface RawTrade {
  readonly id: string;
  readonly signalTime: number;   // bar t whose close produced the signal
  readonly entryTime: number;    // execution bar (t+1)
  readonly exitTime: number;
  readonly entryPrice: number;   // open[t+1]
  readonly exitPrice: number;    // open[exitSignal+1]
  readonly side: 'LONG' | 'SHORT';
  readonly rawReturnLog: number; // signed log return, frictionless
}
