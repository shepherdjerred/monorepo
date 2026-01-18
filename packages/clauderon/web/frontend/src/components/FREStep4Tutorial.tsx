import { ChevronLeft, PlayCircle } from "lucide-react";
import { Button } from "./ui/button";

interface FREStep4TutorialProps {
  onComplete: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function FREStep4Tutorial({
  onComplete,
  onBack,
  onSkip,
}: FREStep4TutorialProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1">
      {/* Title */}
      <h2 className="text-4xl font-black mb-4 text-center">
        Interactive Tutorial
      </h2>
      <p className="text-xl text-gray-600 mb-12 text-center max-w-2xl">
        Take a guided tour through creating and managing your first session, or
        skip ahead to start exploring on your own.
      </p>

      {/* Tutorial preview card */}
      <div className="w-full max-w-3xl mb-12">
        <div className="border-4 border-black p-12 bg-gradient-to-br from-blue-50 to-white shadow-brutal">
          <div className="flex flex-col items-center text-center">
            <div className="mb-8 p-6 border-2 border-black bg-white rounded-full">
              <PlayCircle className="w-16 h-16" />
            </div>
            <h3 className="text-2xl font-bold mb-4">
              Learn by Doing
            </h3>
            <p className="text-lg text-gray-600 mb-8">
              Follow along as we walk you through:
            </p>
            <ul className="text-left space-y-3 text-lg max-w-md">
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">1.</span>
                <span>Filling in the create session form</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">2.</span>
                <span>Choosing the right backend and agent</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">3.</span>
                <span>Attaching to your session console</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">4.</span>
                <span>Using AI assistance effectively</span>
              </li>
            </ul>
          </div>
        </div>
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
          onClick={onSkip}
          variant="outline"
          size="lg"
          className="border-2 border-black"
        >
          Skip to Dashboard
        </Button>

        <Button
          onClick={onComplete}
          size="lg"
          className="bg-black text-white hover:bg-gray-800 text-lg px-8"
        >
          <PlayCircle className="h-5 w-5 mr-2" />
          Start Tutorial
        </Button>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        Tutorial takes approximately 2-3 minutes
      </p>
    </div>
  );
}
