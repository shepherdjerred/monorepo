import { Login } from "../stories/login";

export function LoginPage({
  handleLogin,
}: {
  handleLogin: (token: string) => void;
}) {
  return <Login handleLogin={handleLogin} />;
}
