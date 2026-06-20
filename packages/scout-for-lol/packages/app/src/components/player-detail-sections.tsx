import { Button } from "#src/components/ui/button.tsx";
import { DiscordUser } from "#src/components/discord-user.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

type DiscordName = { username: string; displayName: string } | null;

type AccountRow = {
  id: number;
  alias: string;
  puuid: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  lastMatchTime: Date | string | null;
  lastCheckedAt: Date | string | null;
};

function formatDate(value: Date | string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

export function PlayerAccountsTable(props: {
  accounts: AccountRow[];
  deletePending: boolean;
  onEdit: (account: AccountRow) => void;
  onDelete: (account: AccountRow) => void;
}) {
  if (props.accounts.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No accounts.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Alias</TableHead>
          <TableHead>Riot ID</TableHead>
          <TableHead>Region</TableHead>
          <TableHead>PUUID</TableHead>
          <TableHead>Last match</TableHead>
          <TableHead>Last checked</TableHead>
          <TableHead className="w-1" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell className="font-medium">{account.alias}</TableCell>
            <TableCell>
              {account.riotGameName === null ? (
                <span className="text-muted-foreground">Not resolved</span>
              ) : (
                <span className="font-medium">
                  {account.riotGameName}
                  <span className="text-muted-foreground">
                    #{account.riotTagLine}
                  </span>
                </span>
              )}
            </TableCell>
            <TableCell>{account.region}</TableCell>
            <TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground">
              {account.puuid}
            </TableCell>
            <TableCell>{formatDate(account.lastMatchTime)}</TableCell>
            <TableCell>{formatDate(account.lastCheckedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    props.onEdit(account);
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={
                    account.riotGameName === null || props.deletePending
                  }
                  title={
                    account.riotGameName === null
                      ? "Riot ID not resolved yet — reload to enable delete"
                      : undefined
                  }
                  onClick={() => {
                    props.onDelete(account);
                  }}
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Section(props: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{props.title}</h3>
        {props.action}
      </div>
      <div className="rounded-md border border-border">{props.children}</div>
    </section>
  );
}

export function CompetitionSection(props: {
  title: string;
  rows: {
    id: number;
    status: string;
    invitedBy: string | null;
    invitedByUser: DiscordName;
    invitedAt: Date | string | null;
    joinedAt: Date | string | null;
    leftAt: Date | string | null;
    competition: {
      id: number;
      title: string;
      visibility: string;
      isCancelled: boolean;
      startDate: Date | string | null;
      endDate: Date | string | null;
    };
  }[];
}) {
  return (
    <Section title={props.title}>
      {props.rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">None.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competition</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Invite</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((participant) => (
              <TableRow key={participant.id}>
                <TableCell className="font-medium">
                  {participant.competition.title}
                  {participant.competition.isCancelled ? " (cancelled)" : ""}
                </TableCell>
                <TableCell>{participant.status}</TableCell>
                <TableCell>{participant.competition.visibility}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(participant.competition.startDate)} to{" "}
                  {formatDate(participant.competition.endDate)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <DiscordUser
                    id={participant.invitedBy}
                    name={participant.invitedByUser}
                  />{" "}
                  / {formatDate(participant.invitedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
