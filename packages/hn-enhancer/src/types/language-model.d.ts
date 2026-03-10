type LanguageModelSession = {
  prompt: (text: string) => Promise<string>;
  promptStreaming: (text: string) => ReadableStream<string>;
  destroy: () => void;
}

type LanguageModelCreateOptions = {
  expectedOutputLanguages?: string[];
  initialPrompts?: { role: string; content: string }[];
}

type LanguageModelAPI = {
  create: (options?: LanguageModelCreateOptions) => Promise<LanguageModelSession>;
}

 
type LanguageModelGlobal = {
  LanguageModel?: LanguageModelAPI;
};

declare const LanguageModel: LanguageModelAPI | undefined;
