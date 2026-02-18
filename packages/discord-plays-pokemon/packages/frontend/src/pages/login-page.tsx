import { Login } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Login";

export function LoginPage({
  handleLogin,
}: {
  handleLogin: (token: string) => void;
}) {
  return <Login handleLogin={handleLogin} />;
}
