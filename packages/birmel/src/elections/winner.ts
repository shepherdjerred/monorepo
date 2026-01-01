export type ElectionResults = {
	winner: string | null;
	isTie: boolean;
	tiedCandidates: string[];
	voteCounts: Record<string, number>;
	totalVotes: number;
};

export function determineWinner(
	answers: { text: string; voteCount: number }[],
): ElectionResults {
	const voteCounts: Record<string, number> = {};
	let totalVotes = 0;
	let maxVotes = 0;

	// Count votes
	for (const answer of answers) {
		const persona = answer.text.toLowerCase();
		voteCounts[persona] = answer.voteCount;
		totalVotes += answer.voteCount;
		if (answer.voteCount > maxVotes) {
			maxVotes = answer.voteCount;
		}
	}

	// Handle no votes
	if (totalVotes === 0) {
		return {
			winner: "jerred",
			isTie: false,
			tiedCandidates: [],
			voteCounts,
			totalVotes: 0,
		};
	}

	// Find tied candidates
	const tiedCandidates = Object.entries(voteCounts)
		.filter(([_, votes]) => votes === maxVotes)
		.map(([persona, _]) => persona);

	if (tiedCandidates.length > 1) {
		// Select a random winner from tied candidates
		const randomIndex = Math.floor(Math.random() * tiedCandidates.length);
		const randomWinner = tiedCandidates[randomIndex] ?? tiedCandidates[0] ?? "jerred";
		return {
			winner: randomWinner,
			isTie: true,
			tiedCandidates,
			voteCounts,
			totalVotes,
		};
	}

	return {
		winner: tiedCandidates[0] ?? "jerred",
		isTie: false,
		tiedCandidates: [],
		voteCounts,
		totalVotes,
	};
}

export function generateNickname(personaName: string): string {
	const capitalized =
		personaName.charAt(0).toUpperCase() + personaName.slice(1);
	return "B" + capitalized.slice(1);
}
