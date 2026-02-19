import { Login } from "#src/stories/login.tsx";

export function LoginPage({
  handleLogin,
}: {
  handleLogin: (token: string) => void;
}) {
  return <Login handleLogin={handleLogin} />;
}
