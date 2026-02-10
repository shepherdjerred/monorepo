import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getAllCandidates(): string[] {
	const styleCardsDir = join(__dirname, "../persona/style-cards");
	const files = readdirSync(styleCardsDir);

	return files
		.filter((f) => f.endsWith("_style.json"))
		.map((f) => f.replace("_style.json", ""));
}

export function selectRandomCandidates(min = 3, max = 5): string[] {
	const allCandidates = getAllCandidates();
	const count = Math.floor(Math.random() * (max - min + 1)) + min;

	// Shuffle and select
	const shuffled = [...allCandidates].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, count);
}

export function createElectionAnswers(
	candidates: string[],
): { text: string }[] {
	return candidates.map((name) => ({
		text: name.charAt(0).toUpperCase() + name.slice(1),
	}));
}
