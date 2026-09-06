export type ChallengeAccountOption = {
  readonly id: number;
  readonly playerAlias: string;
  readonly accountAlias: string;
};

function toggleAccount(
  values: readonly number[],
  accountId: number,
  checked: boolean,
): number[] {
  return checked
    ? [...values, accountId]
    : values.filter((value) => value !== accountId);
}

export function ChallengeAccountSelection(props: {
  readonly accounts: readonly ChallengeAccountOption[];
  readonly name: string;
  readonly value: readonly number[];
  readonly onChange: (accountIds: number[]) => void;
}) {
  return props.accounts.map((account) => (
    <label className="flex items-center gap-2 text-sm" key={account.id}>
      <input
        type="checkbox"
        name={props.name}
        value={account.id}
        checked={props.value.includes(account.id)}
        onChange={(event) => {
          props.onChange(
            toggleAccount(props.value, account.id, event.currentTarget.checked),
          );
        }}
      />
      {account.playerAlias} · {account.accountAlias}
    </label>
  ));
}
