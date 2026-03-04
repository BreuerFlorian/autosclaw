import React from "react";
import { useApp } from "../../context/AppContext";
import { fmtNum, fmtCost } from "../../utils";
import "./TokenBar.css";

export function TokenBar() {
  const { state } = useApp();
  const agent = state.agents.find((a) => a.id === state.currentAgentId);

  if (!agent) return null;

  return (
    <div className="token-bar">
      <div className="token-card input">
        <span className="label">Input</span>
        <span className="value">{fmtNum(agent.inputTokens)}</span>
      </div>
      <div className="token-card output">
        <span className="label">Output</span>
        <span className="value">{fmtNum(agent.outputTokens)}</span>
      </div>
      <div className="token-card cache-read">
        <span className="label">Cache Read</span>
        <span className="value">{fmtNum(agent.cacheReadInputTokens)}</span>
      </div>
      <div className="token-card cache-write">
        <span className="label">Cache Write</span>
        <span className="value">{fmtNum(agent.cacheCreationInputTokens)}</span>
      </div>
      <div className="token-card cost">
        <span className="label">Cost</span>
        <span className="value">{fmtCost(agent.costUSD)}</span>
      </div>
    </div>
  );
}
