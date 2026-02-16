/**
 * Match filter controls
 */
type MatchFiltersProps = {
  filterQueueType: string;
  filterLane: string;
  filterPlayer: string;
  filterChampion: string;
  filterOutcome: string;
  onQueueTypeChange: (value: string) => void;
  onLaneChange: (value: string) => void;
  onPlayerChange: (value: string) => void;
  onChampionChange: (value: string) => void;
  onOutcomeChange: (value: string) => void;
};

export function MatchFilters({
  filterQueueType,
  filterLane,
  filterPlayer,
  filterChampion,
  filterOutcome,
  onQueueTypeChange,
  onLaneChange,
  onPlayerChange,
  onChampionChange,
  onOutcomeChange,
}: MatchFiltersProps) {
  return (
    <div className="space-y-3 mb-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="queue-type"
            className="block text-sm font-medium text-surface-700 mb-1"
          >
            Queue Type
          </label>
          <select
            id="queue-type"
            value={filterQueueType}
            onChange={(e) => {
              onQueueTypeChange(e.target.value);
            }}
            className="w-full px-2 py-1.5 text-sm bg-white text-surface-900 border border-surface-300 rounded"
          >
            <option value="all">All</option>
            <option value="solo">Ranked Solo</option>
            <option value="flex">Ranked Flex</option>
            <option value="arena">Arena</option>
            <option value="aram">ARAM</option>
            <option value="quickplay">Quickplay</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="lane"
            className="block text-sm font-medium text-surface-700 mb-1"
          >
            Lane
          </label>
          <select
            id="lane"
            value={filterLane}
            onChange={(e) => {
              onLaneChange(e.target.value);
            }}
            className="w-full px-2 py-1.5 text-sm bg-white text-surface-900 border border-surface-300 rounded"
          >
            <option value="all">All</option>
            <option value="top">Top</option>
            <option value="jungle">Jungle</option>
            <option value="middle">Mid</option>
            <option value="adc">ADC</option>
            <option value="support">Support</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="outcome"
            className="block text-sm font-medium text-surface-700 mb-1"
          >
            Outcome
          </label>
          <select
            id="outcome"
            value={filterOutcome}
            onChange={(e) => {
              onOutcomeChange(e.target.value);
            }}
            className="w-full px-2 py-1.5 text-sm bg-white text-surface-900 border border-surface-300 rounded"
          >
            <option value="all">All</option>
            <option value="victory">Victory</option>
            <option value="defeat">Defeat</option>
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="player-game-name"
          className="block text-sm font-medium text-surface-700 mb-1"
        >
          Player (Game Name)
        </label>
        <input
          id="player-game-name"
          type="text"
          placeholder="Fuzzy search player names..."
          value={filterPlayer}
          onChange={(e) => {
            onPlayerChange(e.target.value);
          }}
          className="w-full px-2 py-1.5 text-sm bg-white text-surface-900 border border-surface-300 rounded"
        />
      </div>

      <div>
        <label
          htmlFor="champion"
          className="block text-sm font-medium text-surface-700 mb-1"
        >
          Champion
        </label>
        <input
          id="champion"
          type="text"
          placeholder="Fuzzy search champions..."
          value={filterChampion}
          onChange={(e) => {
            onChampionChange(e.target.value);
          }}
          className="w-full px-2 py-1.5 text-sm bg-white text-surface-900 border border-surface-300 rounded"
        />
      </div>
    </div>
  );
}
