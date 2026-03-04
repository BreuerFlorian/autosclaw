import { useApp } from "../../context/AppContext";
import { fmtCompact } from "../../utils";
import "./TokenSummary.css";

export default function TokenSummary() {
  const { state } = useApp();
  const { agents } = state;

  const inputTokens = agents.reduce((sum, a) => sum + a.inputTokens, 0);
  const outputTokens = agents.reduce((sum, a) => sum + a.outputTokens, 0);
  const cacheRead = agents.reduce((sum, a) => sum + a.cacheReadInputTokens, 0);
  const cacheWrite = agents.reduce(
    (sum, a) => sum + a.cacheCreationInputTokens,
    0
  );

  return (
    <div className="dash-section">
      <h3>Token Usage</h3>
      <div className="dash-tokens">
        <div className="dash-token-card">
          <span className="dash-token-label">Input Tokens</span>
          <span className="dash-token-value input">{fmtCompact(inputTokens)}</span>
        </div>
        <div className="dash-token-card">
          <span className="dash-token-label">Output Tokens</span>
          <span className="dash-token-value output">{fmtCompact(outputTokens)}</span>
        </div>
        <div className="dash-token-card">
          <span className="dash-token-label">Cache Read</span>
          <span className="dash-token-value cache">{fmtCompact(cacheRead)}</span>
        </div>
        <div className="dash-token-card">
          <span className="dash-token-label">Cache Write</span>
          <span className="dash-token-value cache">{fmtCompact(cacheWrite)}</span>
        </div>
      </div>
    </div>
  );
}
