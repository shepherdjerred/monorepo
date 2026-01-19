import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { FREStep1Welcome } from "./FREStep1Welcome";
import { FREStep2Features } from "./FREStep2Features";
import { FREStep3QuickStart } from "./FREStep3QuickStart";
import { FREStep4Tutorial } from "./FREStep4Tutorial";

interface FirstRunModalProps {
  show: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onCreateSession?: () => void;
}

export function FirstRunModal({
  show,
  onComplete,
  onSkip,
  onCreateSession,
}: FirstRunModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;

  if (!show) {
    return null;
  }

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    onSkip();
  };

  const handleCreateSession = () => {
    onComplete();
    onCreateSession?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-4xl mx-4 bg-white border-4 border-black shadow-brutal">
        {/* Skip button in top-right */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-4 right-4 z-10"
          onClick={handleSkip}
        >
          <X className="h-4 w-4 mr-1" />
          Skip
        </Button>

        {/* Step content */}
        <div className="p-8 min-h-[500px] flex flex-col">
          {currentStep === 1 && <FREStep1Welcome onNext={handleNext} />}
          {currentStep === 2 && (
            <FREStep2Features onNext={handleNext} onBack={handleBack} />
          )}
          {currentStep === 3 && (
            <FREStep3QuickStart
              onNext={handleNext}
              onBack={handleBack}
              onCreateSession={handleCreateSession}
            />
          )}
          {currentStep === 4 && (
            <FREStep4Tutorial
              onComplete={onComplete}
              onBack={handleBack}
              onSkip={handleSkip}
            />
          )}
        </div>

        {/* Step indicator */}
        <div className="flex justify-center gap-2 pb-6">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full border-2 border-black ${
                i + 1 === currentStep ? "bg-black" : "bg-white"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
