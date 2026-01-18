import { useState } from "react";
import {
  Container,
  Bot,
  Server,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";

interface FREStep2FeaturesProps {
  onNext: () => void;
  onBack: () => void;
}

const features = [
  {
    icon: Container,
    title: "Sessions",
    description:
      "Isolated development environments with full terminal access and file system. Create, manage, and switch between multiple sessions effortlessly.",
  },
  {
    icon: Bot,
    title: "Agents",
    description:
      "Claude AI integration with multiple agent types. Choose from standard, advanced, or specialized agents to assist with your development tasks.",
  },
  {
    icon: Server,
    title: "Backends",
    description:
      "Support for Docker, Kubernetes, and native containers. Deploy your sessions on the infrastructure that works best for your workflow.",
  },
  {
    icon: Activity,
    title: "Real-time",
    description:
      "Live console access and real-time updates. See your code changes and terminal output instantly, with WebSocket-powered synchronization.",
  },
];

export function FREStep2Features({ onNext, onBack }: FREStep2FeaturesProps) {
  const [currentFeature, setCurrentFeature] = useState(0);

  const handlePrevious = () => {
    if (currentFeature > 0) {
      setCurrentFeature(currentFeature - 1);
    }
  };

  const handleNextFeature = () => {
    if (currentFeature < features.length - 1) {
      setCurrentFeature(currentFeature + 1);
    } else {
      onNext();
    }
  };

  const feature = features[currentFeature];
  const Icon = feature.icon;

  return (
    <div className="flex flex-col items-center justify-center flex-1">
      {/* Title */}
      <h2 className="text-4xl font-black mb-12 text-center">Key Features</h2>

      {/* Feature card */}
      <div className="w-full max-w-xl mb-12">
        <div className="border-4 border-black p-8 bg-white shadow-brutal">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 p-4 border-2 border-black">
              <Icon className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-bold mb-4">{feature.title}</h3>
            <p className="text-lg leading-relaxed">{feature.description}</p>
          </div>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-4 items-center">
        <Button
          onClick={onBack}
          variant="outline"
          size="lg"
          className="border-2 border-black"
        >
          <ChevronLeft className="h-5 w-5 mr-1" />
          Back
        </Button>

        <div className="flex gap-2">
          {features.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full border border-black ${
                i === currentFeature ? "bg-black" : "bg-white"
              }`}
            />
          ))}
        </div>

        <Button
          onClick={handlePrevious}
          variant="outline"
          size="lg"
          disabled={currentFeature === 0}
          className="border-2 border-black disabled:opacity-50"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <Button
          onClick={handleNextFeature}
          size="lg"
          className="bg-black text-white hover:bg-gray-800"
        >
          {currentFeature < features.length - 1 ? (
            <>
              Next
              <ChevronRight className="h-5 w-5 ml-1" />
            </>
          ) : (
            <>
              Continue
              <ChevronRight className="h-5 w-5 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
