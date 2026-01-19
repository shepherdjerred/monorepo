import { Button } from "./ui/button";

interface FREStep1WelcomeProps {
  onNext: () => void;
}

export function FREStep1Welcome({ onNext }: FREStep1WelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center">
      {/* Logo/Title */}
      <div className="mb-8">
        <h1 className="text-6xl font-black mb-4">CLAUDERON</h1>
        <p className="text-2xl font-bold text-blue-600">
          Development environments, on demand
        </p>
      </div>

      {/* Description */}
      <div className="max-w-2xl mb-12 space-y-4 text-lg">
        <p>
          Clauderon creates isolated development environments powered by Claude
          AI. Work with your code in containerized sessions with intelligent
          assistance.
        </p>
        <p>
          Each session includes a full terminal, file system, and AI assistant
          to help you build, debug, and deploy your applications.
        </p>
      </div>

      {/* CTA Button */}
      <Button
        onClick={onNext}
        size="lg"
        className="text-lg px-8 py-6 bg-black text-white hover:bg-gray-800"
      >
        Get Started →
      </Button>
    </div>
  );
}
