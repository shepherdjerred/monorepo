import type { Message } from "../lib/claudeParser";
import { HelpCircle, Check } from "lucide-react";

type QuestionViewProps = {
  message: Message;
};

export function QuestionView({ message }: QuestionViewProps) {
  // Find the AskUserQuestion tool use
  const questionTool = message.toolUses?.find(tool => tool.name === "AskUserQuestion");

  if (!questionTool || !questionTool.input) {
    return null;
  }

  const questions = questionTool.input.questions as Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return null;
  }

  return (
    <div className="border-4 border-accent bg-accent/5 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b-2 border-accent/30">
        <div className="w-8 h-8 border-2 border-accent bg-accent text-white flex items-center justify-center">
          <HelpCircle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold font-mono uppercase text-lg tracking-wide">Question{questions.length > 1 ? "s" : ""}</h3>
          <p className="text-xs font-mono text-muted-foreground">
            Claude Code is asking for your input
          </p>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6">
        {questions.map((q, idx) => (
          <div key={idx} className="space-y-3">
            {/* Question header */}
            <div className="flex items-baseline gap-3">
              <span className="px-2 py-1 bg-accent text-white text-xs font-bold font-mono">
                {q.header}
              </span>
              <p className="font-semibold text-base">{q.question}</p>
            </div>

            {/* Options */}
            <div className="space-y-2 pl-4">
              {q.options.map((option, optIdx) => (
                <div
                  key={optIdx}
                  className="border-2 border-border p-3 bg-background hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-4 h-4 mt-0.5 border-2 border-border flex-shrink-0 flex items-center justify-center">
                      {q.multiSelect && <Check className="w-3 h-3 text-transparent" />}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-sm">{option.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{option.description}</div>
                    </div>
                  </div>
                </div>
              ))}
              {/* Other option */}
              <div className="border-2 border-border p-3 bg-background hover:border-accent/50 transition-colors">
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 mt-0.5 border-2 border-border flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold text-sm">Other</div>
                    <div className="text-xs text-muted-foreground mt-1">Provide custom input</div>
                  </div>
                </div>
              </div>
            </div>

            {q.multiSelect && (
              <p className="text-xs font-mono text-muted-foreground italic pl-4">
                * Multiple selections allowed
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Note */}
      <div className="border-t-2 border-accent/30 pt-3">
        <p className="text-xs font-mono text-muted-foreground">
          📝 This question was presented in the active Claude Code session. Check the terminal for response status.
        </p>
      </div>
    </div>
  );
}

/**
 * Check if a message contains a question (AskUserQuestion tool use)
 */
export function isQuestion(message: Message): boolean {
  return message.toolUses?.some(tool => tool.name === "AskUserQuestion") ?? false;
}
