import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import type { AskQuestion } from "../../types";
import "./AskUserCard.css";

type AskUserCardProps = {
  questions: AskQuestion[];
  answered: boolean;
  index: number;
};

export function AskUserCard({ questions, answered, index }: AskUserCardProps) {
  const { dispatch, sendAskUserResponse } = useApp();
  const [selections, setSelections] = useState<Record<number, number>>({});

  const allAnswered = questions.every((_, qi) => selections[qi] !== undefined);

  const handleSelect = (questionIdx: number, optionIdx: number) => {
    if (answered) return;
    setSelections((prev) => ({ ...prev, [questionIdx]: optionIdx }));
  };

  const handleSubmit = () => {
    if (!allAnswered || answered) return;

    // Build answers as Record<string, string> mapping question text → selected label
    const answers: Record<string, string> = {};
    questions.forEach((q, qi) => {
      const selected = q.options[selections[qi]];
      if (selected) {
        answers[q.question] = selected.label;
      }
    });

    dispatch({ type: "MARK_ASK_ANSWERED", index });
    sendAskUserResponse(answers);
  };

  return (
    <div className={`ask-container${answered ? " answered" : ""}`}>
      {questions.map((q, qi) => (
        <div className="ask-card" key={qi}>
          {q.header && <div className="ask-header">{q.header}</div>}
          <div className="ask-question">{q.question}</div>
          <div className="ask-options">
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                className={`ask-option${selections[qi] === oi ? " selected" : ""}`}
                onClick={() => handleSelect(qi, oi)}
                disabled={answered}
              >
                <div className="opt-label">{opt.label}</div>
                {opt.description && (
                  <div className="opt-desc">{opt.description}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!answered && (
        <button
          className="ask-submit"
          disabled={!allAnswered}
          onClick={handleSubmit}
        >
          Submit
        </button>
      )}
    </div>
  );
}
