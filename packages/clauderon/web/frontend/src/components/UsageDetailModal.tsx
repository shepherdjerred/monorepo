import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import type { SessionUsageDetailDto } from '@sjer/clauderon-client';

interface UsageDetailModalProps {
  sessionId: string;
  sessionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageDetailModal({
  sessionId,
  sessionName,
  open,
  onOpenChange,
}: UsageDetailModalProps) {
  const [detail, setDetail] = useState<SessionUsageDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open && sessionId) {
      fetchUsageDetail();
    }
  }, [open, sessionId]);

  const fetchUsageDetail = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/usage`);
      if (response.ok) {
        const data = await response.json();
        if (data.type === 'SessionUsageDetail') {
          setDetail(data.payload);
        }
      }
    } catch (error) {
      console.error('Failed to fetch usage details:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTurnExpanded = (turnNumber: number) => {
    const newExpanded = new Set(expandedTurns);
    if (newExpanded.has(turnNumber)) {
      newExpanded.delete(turnNumber);
    } else {
      newExpanded.add(turnNumber);
    }
    setExpandedTurns(newExpanded);
  };

  if (!detail) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token Usage - {sessionName}</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-muted-foreground">
            {loading ? 'Loading usage data...' : 'No usage data available'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const models = Object.values(detail.models_used ?? {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Token Usage - {sessionName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Section */}
          <div className="border rounded-lg p-4 bg-muted/50">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Cost</div>
                <div className="text-2xl font-bold">
                  {`$${detail.total_cost_usd.toFixed(4)}`}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Turns</div>
                <div className="text-2xl font-bold">{detail.turns.length}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Input Tokens</div>
                <div className="text-lg font-mono">{detail.total_input_tokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Output Tokens</div>
                <div className="text-lg font-mono">
                  {detail.total_output_tokens.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Model Breakdown */}
          {models.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Model Breakdown</h3>
              <div className="space-y-2">
                {models.map((model: any) => (
                  <div key={model.model} className="flex justify-between items-center p-3 border rounded">
                    <div>
                      <div className="font-mono text-sm">{model.model}</div>
                      <div className="text-xs text-muted-foreground">
                        {model.turn_count} turn{model.turn_count !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{`$${model.cost_usd.toFixed(4)}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {(model.input_tokens + model.output_tokens).toLocaleString()} tokens
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Turn-by-Turn */}
          {detail.turns.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Turn Details</h3>
              <div className="space-y-1 border rounded-lg divide-y max-h-64 overflow-y-auto">
                {detail.turns.map((turn: any) => (
                  <div key={turn.turn_number}>
                    <button
                      onClick={() => toggleTurnExpanded(turn.turn_number)}
                      className="w-full flex justify-between items-center p-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div>
                        <div className="font-mono text-sm">Turn {turn.turn_number}</div>
                        <div className="text-xs text-muted-foreground">{turn.model}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{`$${turn.cost_usd.toFixed(6)}`}</div>
                        <div className="text-xs text-muted-foreground">
                          {turn.input_tokens}+{turn.output_tokens}
                        </div>
                      </div>
                    </button>
                    {expandedTurns.has(turn.turn_number) && (
                      <div className="px-3 pb-3 text-xs space-y-1 bg-muted/30">
                        <div>Input: {turn.input_tokens.toLocaleString()} tokens</div>
                        <div>Output: {turn.output_tokens.toLocaleString()} tokens</div>
                        {turn.cache_creation_tokens > 0 && (
                          <div>Cache Creation: {turn.cache_creation_tokens.toLocaleString()}</div>
                        )}
                        {turn.cache_read_tokens > 0 && (
                          <div>Cache Read: {turn.cache_read_tokens.toLocaleString()}</div>
                        )}
                        <div>Time: {new Date(turn.timestamp).toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
