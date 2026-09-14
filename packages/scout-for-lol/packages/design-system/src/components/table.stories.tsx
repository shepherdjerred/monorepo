import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";

const meta = {
  title: "Components/Table",
  component: Table,
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Champion</TableHead>
          <TableHead scope="col">Games</TableHead>
          <TableHead scope="col">Win rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Ahri</TableCell>
          <TableCell>42</TableCell>
          <TableCell>57%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Syndra</TableCell>
          <TableCell>28</TableCell>
          <TableCell>61%</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Orianna</TableCell>
          <TableCell>19</TableCell>
          <TableCell>47%</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const WithCaption: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Table>
      <caption style={{ textAlign: "left", paddingBottom: "0.5rem" }}>
        Ranked solo queue ladder for the Rift Wardens guild
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Summoner</TableHead>
          <TableHead scope="col">Rank</TableHead>
          <TableHead scope="col">LP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Perma Flash#EUW</TableCell>
          <TableCell>Diamond III</TableCell>
          <TableCell>64</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Bel&apos;Veth Enjoyer#NA1</TableCell>
          <TableCell>Emerald II</TableCell>
          <TableCell>47</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Wardstone Andy#NA1</TableCell>
          <TableCell>Platinum IV</TableCell>
          <TableCell>12</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const MatchHistory: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Result</TableHead>
          <TableHead scope="col">Champion</TableHead>
          <TableHead scope="col">KDA</TableHead>
          <TableHead scope="col">CS</TableHead>
          <TableHead scope="col">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <Badge>Victory</Badge>
          </TableCell>
          <TableCell>Ahri</TableCell>
          <TableCell>11 / 3 / 14</TableCell>
          <TableCell>241</TableCell>
          <TableCell>32:14</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Badge variant="destructive">Defeat</Badge>
          </TableCell>
          <TableCell>Syndra</TableCell>
          <TableCell>4 / 8 / 6</TableCell>
          <TableCell>198</TableCell>
          <TableCell>27:41</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Badge>Victory</Badge>
          </TableCell>
          <TableCell>Orianna</TableCell>
          <TableCell>7 / 2 / 19</TableCell>
          <TableCell>263</TableCell>
          <TableCell>35:02</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const RowHeaders: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Objective</TableHead>
          <TableHead scope="col">Blue team</TableHead>
          <TableHead scope="col">Red team</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableHead scope="row">Dragons</TableHead>
          <TableCell>4</TableCell>
          <TableCell>1</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row">Barons</TableHead>
          <TableCell>2</TableCell>
          <TableCell>0</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row">Turrets</TableHead>
          <TableCell>9</TableCell>
          <TableCell>3</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const Empty: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Summoner</TableHead>
          <TableHead scope="col">Rank</TableHead>
          <TableHead scope="col">LP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={3}>
            No tracked summoners yet. Use /scout track to add one.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const Scrollable: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ maxWidth: "28rem" }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Match</TableHead>
            <TableHead scope="col">Queue</TableHead>
            <TableHead scope="col">Champion</TableHead>
            <TableHead scope="col">KDA</TableHead>
            <TableHead scope="col">Damage</TableHead>
            <TableHead scope="col">Vision</TableHead>
            <TableHead scope="col">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>NA1_5210448831</TableCell>
            <TableCell>Ranked Solo</TableCell>
            <TableCell>Ahri</TableCell>
            <TableCell>11 / 3 / 14</TableCell>
            <TableCell>28,412</TableCell>
            <TableCell>34</TableCell>
            <TableCell>32:14</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>NA1_5210412774</TableCell>
            <TableCell>Ranked Flex</TableCell>
            <TableCell>Thresh</TableCell>
            <TableCell>1 / 6 / 22</TableCell>
            <TableCell>9,145</TableCell>
            <TableCell>71</TableCell>
            <TableCell>29:55</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};
