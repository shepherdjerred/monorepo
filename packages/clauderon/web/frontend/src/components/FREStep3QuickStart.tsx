import { CheckCircle2, Circle, ChevronLeft } from "lucide-react";
import { Button } from "./ui/button";

interface FREStep3QuickStartProps {
  onNext: () => void;
  onBack: () => void;
  onCreateSession: () => void;
}

const quickStartSteps = [
  {
    id: 1,
    title: "Create your first session",
    description: "Set up a development environment with your repository",
  },
  {
    id: 2,
    title: "Attach to the console",
    description: "Access your session's terminal and start coding",
  },
  {
    id: 3,
    title: "Try the chat interface",
    description: "Interact with Claude AI to get coding assistance",
  },
];

export function FREStep3QuickStart({
  onNext,
  onBack,
  onCreateSession,
}: FREStep3QuickStartProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1">
      {/* Title */}
      <h2 className="text-4xl font-black mb-4 text-center">Quick Start Guide</h2>
      <p className="text-xl text-gray-600 mb-12 text-center">
        Ready to begin? Here's your first steps:
      </p>

      {/* Checklist */}
      <div className="w-full max-w-2xl mb-12 space-y-4">
        {quickStartSteps.map((step) => (
          <div
            key={step.id}
            className="flex items-start gap-4 p-6 border-2 border-black bg-white"
          >
            <div className="flex-shrink-0 mt-1">
              <Circle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">{step.title}</h3>
              <p className="text-gray-600">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-4">
        <Button
          onClick={onBack}
          variant="outline"
          size="lg"
          className="border-2 border-black"
        >
          <ChevronLeft className="h-5 w-5 mr-1" />
          Back
        </Button>

        <Button
          onClick={onCreateSession}
          size="lg"
          className="bg-black text-white hover:bg-gray-800 text-lg px-8"
        >
          Create Your First Session
        </Button>
      </div>

      {/* Optional: Skip tutorial button */}
      <button
        onClick={onNext}
        className="mt-6 text-sm text-gray-500 hover:text-gray-700 underline"
      >
        Or view the interactive tutorial →
      </button>
    </div>
  );
}
